/**
 * Service d'upload/download de médias via Supabase Storage
 * Remplace Firebase Storage MediaUploadService.
 *
 * Modèle de transit :
 *  - L'expéditeur upload dans le bucket "temp-media"
 *  - L'URL signée (storageUrl) est stockée dans le message
 *  - Le destinataire télécharge localement PUIS confirme la réception
 *  - La suppression de Storage n'a lieu QU'APRÈS confirmation du cache local
 */
import { supabase } from './config';
import * as FileSystem from 'expo-file-system';
import { v4 as uuidv4 } from 'uuid';

const MEDIA_CACHE_DIR = `${FileSystem.documentDirectory}media_cache/`;
const TEMP_MEDIA_BUCKET = 'temp-media';

async function ensureCacheDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MEDIA_CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MEDIA_CACHE_DIR, { intermediates: true });
  }
}

/**
 * Upload un fichier local vers Supabase Storage (bucket temp-media/).
 * Retourne l'URL signée de téléchargement.
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

  const arrayBuffer = await blob.arrayBuffer();
  const { error } = await supabase.storage
    .from(TEMP_MEDIA_BUCKET)
    .upload(filename, arrayBuffer, { contentType, upsert: false });

  if (error) {
    throw new Error(
      `Envoi refusé par Supabase Storage : ${error.message}. ` +
      `Vérifiez que le bucket "${TEMP_MEDIA_BUCKET}" existe et que les politiques RLS sont configurées.`
    );
  }

  // Créer une URL signée valide 7 jours (le temps que le destinataire télécharge)
  const { data: signedData, error: signedError } = await supabase.storage
    .from(TEMP_MEDIA_BUCKET)
    .createSignedUrl(filename, 7 * 24 * 60 * 60);

  if (signedError || !signedData?.signedUrl) {
    throw new Error(`Impossible de générer l'URL de téléchargement : ${signedError?.message}`);
  }

  return signedData.signedUrl;
}

/**
 * Télécharge un média depuis Supabase Storage vers le cache local.
 * Idempotent : si le fichier est déjà en cache, retourne le chemin existant.
 */
export async function downloadAndCacheMedia(
  storageUrl: string,
  messageId: string,
  ext: string,
): Promise<string> {
  await ensureCacheDir();
  const localPath = `${MEDIA_CACHE_DIR}${messageId}.${ext}`;

  const info = await FileSystem.getInfoAsync(localPath);
  if (info.exists) return localPath;

  const result = await FileSystem.downloadAsync(storageUrl, localPath);
  if (result.status !== 200) throw new Error(`Téléchargement échoué: HTTP ${result.status}`);

  const finalInfo = await FileSystem.getInfoAsync(localPath);
  if (!finalInfo.exists) throw new Error('Fichier introuvable après téléchargement.');

  return localPath;
}

/**
 * Supprime un fichier du relay Supabase Storage.
 * À appeler UNIQUEMENT après avoir confirmé que le cache local est valide.
 */
export async function deleteMediaFromStorage(storageUrl: string): Promise<void> {
  try {
    // Extraire le nom du fichier depuis l'URL signée Supabase
    const url = new URL(storageUrl);
    const pathMatch = url.pathname.match(/\/object\/sign\/[^/]+\/(.+)$/);
    if (!pathMatch) return;
    const filename = decodeURIComponent(pathMatch[1].split('?')[0]);
    await supabase.storage.from(TEMP_MEDIA_BUCKET).remove([filename]);
  } catch {
    // Silencieux : déjà supprimé ou URL invalide
  }
}
