/**
 * Service upload d'avatar
 * Upload vers Firebase Storage (plan Spark gratuit : 5 GB).
 * L'avatar est public et persistant sur le serveur.
 *
 * Règles Firebase Storage requises (à configurer dans la console Firebase) :
 *   match /avatars/{userId} {
 *     allow read: if true;
 *     allow write: if request.auth != null && request.auth.uid == userId;
 *   }
 */
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './config';

/**
 * Upload une image locale vers Firebase Storage et retourne l'URL publique.
 * @param userId  L'UID de l'utilisateur (détermine le chemin de stockage)
 * @param localUri  L'URI locale de l'image (file:// ou content://)
 */
export async function uploadAvatar(userId: string, localUri: string): Promise<string> {
  // Convertir l'URI locale en Blob (polyfillé par Expo)
  const response = await fetch(localUri);
  const blob = await response.blob();

  const storageRef = ref(storage, `avatars/${userId}.jpg`);
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
  return await getDownloadURL(storageRef);
}
