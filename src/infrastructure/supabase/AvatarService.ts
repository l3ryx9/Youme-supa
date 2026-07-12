/**
 * Service upload d'avatar via Supabase Storage
 * Remplace Firebase Storage AvatarService.
 * Les avatars sont stockés dans le bucket "avatars" (public).
 */
import { supabase } from './config';

const AVATAR_BUCKET = 'avatars';

/**
 * Upload une image locale vers Supabase Storage et retourne l'URL publique.
 */
export async function uploadAvatar(userId: string, localUri: string): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();

  const filename = `${userId}.jpg`;

  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(filename, arrayBuffer, {
      contentType: 'image/jpeg',
      upsert: true, // Remplace l'avatar existant
    });

  if (error) throw new Error(`Erreur upload avatar : ${error.message}`);

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(filename);
  // Ajouter un timestamp pour contourner le cache
  return `${data.publicUrl}?t=${Date.now()}`;
}
