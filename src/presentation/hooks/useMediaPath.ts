/**
 * Hook useMediaPath — migré vers Supabase
 * Résout le chemin local effectif d'un média de message.
 */
import { useState, useEffect } from 'react';
import * as FileSystem from 'expo-file-system';
import { downloadAndCacheMedia } from '@infrastructure/supabase/MediaUploadService';
import { messageRepository } from '@infrastructure/supabase/MessageRepository';

interface UseMediaPathParams {
  localPath?: string;
  storageUrl?: string;
  messageId: string;
  ext: string;
  conversationId?: string;
  isReceiver?: boolean;
}

interface UseMediaPathResult {
  effectivePath: string | null;
  isDownloading: boolean;
  unavailable: boolean;
}

export function useMediaPath({
  localPath,
  storageUrl,
  messageId,
  ext,
  conversationId,
  isReceiver = false,
}: UseMediaPathParams): UseMediaPathResult {
  const [effectivePath, setEffectivePath] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      if (localPath) {
        const info = await FileSystem.getInfoAsync(localPath);
        if (info.exists) {
          if (!cancelled) setEffectivePath(localPath);
          return;
        }
      }

      const cachePath = `${FileSystem.documentDirectory}media_cache/${messageId}.${ext}`;
      const cached = await FileSystem.getInfoAsync(cachePath);
      if (cached.exists) {
        if (!cancelled) setEffectivePath(cachePath);
        if (isReceiver && storageUrl && conversationId) {
          messageRepository.ackMediaReceived(conversationId, messageId, storageUrl).catch(() => {});
        }
        return;
      }

      if (storageUrl) {
        if (!cancelled) setIsDownloading(true);
        try {
          const path = await downloadAndCacheMedia(storageUrl, messageId, ext);
          if (!cancelled) setEffectivePath(path);

          if (isReceiver && conversationId) {
            messageRepository
              .ackMediaReceived(conversationId, messageId, storageUrl)
              .catch(() => {});
          }
        } catch {
          if (!cancelled) setUnavailable(true);
        } finally {
          if (!cancelled) setIsDownloading(false);
        }
        return;
      }

      if (!cancelled) setUnavailable(true);
    }

    resolve();
    return () => { cancelled = true; };
  }, [localPath, storageUrl, messageId, ext, conversationId, isReceiver]);

  return { effectivePath, isDownloading, unavailable };
}
