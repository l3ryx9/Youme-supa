/**
 * Service d'upload/download de médias via Firebase Storage
 *
 * Modèle de transit :
 *  - L'expéditeur upload dans temp_media/{uuid}.{ext}
 *  - L'URL de téléchargement (storageUrl) est stockée dans le message Firestore
 *  - Le destinataire télécharge localement PUIS confirme la réception
 *  - La suppression de Storage n'a lieu QU'APRÈS confirmation du cache local
 *  - Firebase Storage ne sert que de relay — les médias n'y restent pas
 *  - Les avatars (avatars/{userId}.jpg) ne passent PAS par ce service
 */
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import * as FileSystem from 'expo-file-system';
import { v4 as uuidv4 } from 'uuid';
import { storage } from './config';

/** Répertoire local de cache partagé entre expéditeur et destinataire */
const MEDIA_CACHE_DIR = `${FileSystem.documentDirectory}media_cache/`;

async function ensureCacheDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MEDIA_CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MEDIA_CACHE_DIR, { intermediates: true });
  }
}

/**
 * Extrait le chemin Firebase Storage depuis une URL de téléchargement.
 * Format : https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?...
 */
function storagePathFromUrl(storageUrl: string): string {
  const url = new URL(storageUrl);
  const match = url.pathname.match(/\/o\/(.+)$/);
  if (!match) throw new Error(`URL Storage invalide: ${storageUrl}`);
  return decodeURIComponent(match[1]);
}

/**
 * Upload un fichier local vers Firebase Storage (temp_media/).
 * Retourne l'URL publique de téléchargement (storageUrl).
 */
export async function uploadMedia(localUri: string, ext: string): Promise<string> {
  const filename = `${uuidv4()}.${ext}`;
  const response = await fetch(localUri);
  const blob = await response.blob();

  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4a: 'audio/m4a',
    wav: 'audio/wav',
    aac: 'audio/aac',
  };
  const contentType = mimeMap[ext.toLowerCase()] ?? 'application/octet-stream';

  const storageRef = ref(storage, `temp_media/${filename}`);
  try {
    await uploadBytes(storageRef, blob, { contentType });
  } catch (error: any) {
    // FIX : storage/unauthorized se produit quand les règles Firebase Storage
    // n'ont pas été déployées (le projet reste sur "tout refuser" par défaut).
    // On remonte un message clair au lieu de laisser échouer silencieusement.
    if (error?.code === 'storage/unauthorized') {
      throw new Error(
        "Envoi refusé par Firebase Storage : les règles de sécurité (storage.rules) ne sont pas déployées sur le projet. Publiez-les depuis la console Firebase (Storage → Règles)."
      );
    }
    throw error;
  }
  return await getDownloadURL(storageRef);
}

/**
 * Télécharge un média depuis Firebase Storage vers le cache local.
 * - Idempotent : si le fichier est déjà en cache, retourne le chemin existant.
 * - NE supprime PAS de Storage : c'est `deleteMediaFromStorage` qui s'en charge
 *   après confirmation que le cache est valide.
 *
 * @param storageUrl  URL de téléchargement Firebase Storage
 * @param messageId   Identifiant du message (sert de nom de fichier stable)
 * @param ext         Extension du fichier (jpg, m4a, mp4…)
 * @returns           Chemin local du fichier en cache
 */
export async function downloadAndCacheMedia(
  storageUrl: string,
  messageId: string,
  ext: string,
): Promise<string> {
  await ensureCacheDir();
  const localPath = `${MEDIA_CACHE_DIR}${messageId}.${ext}`;

  // Déjà téléchargé ?
  const info = await FileSystem.getInfoAsync(localPath);
  if (info.exists) return localPath;

  // Téléchargement
  const result = await FileSystem.downloadAsync(storageUrl, localPath);
  if (result.status !== 200) throw new Error(`Téléchargement échoué: HTTP ${result.status}`);

  // Vérifier que le fichier est bien présent après téléchargement
  const finalInfo = await FileSystem.getInfoAsync(localPath);
  if (!finalInfo.exists) throw new Error('Fichier introuvable après téléchargement.');

  return localPath;
}

/**
 * Supprime un fichier du relay Firebase Storage.
 * À appeler UNIQUEMENT après avoir confirmé que le cache local est valide.
 * Silencieux si le fichier n'existe plus (déjà supprimé par l'autre appareil).
 */
export async function deleteMediaFromStorage(storageUrl: string): Promise<void> {
  try {
    const path = storagePathFromUrl(storageUrl);
    const storageRef = ref(storage, path);
    await deleteObject(storageRef);
  } catch {
    // Silencieux : déjà supprimé ou URL invalide
  }
}
