/**
 * Chargeur de tokenizer local — @xenova/transformers
 *
 * Charge un tokenizer HuggingFace "fast" (tokenizer.json) depuis un dossier
 * local (téléchargé au préalable par ModelDownloadManager), sans aucun accès
 * réseau. @xenova/transformers n'est utilisé ici QUE pour la tokenisation
 * (pur JS) — l'inférence du modèle passe par onnxruntime-react-native.
 */
import { AutoTokenizer, env, type PreTrainedTokenizer } from '@xenova/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.useFSCache = false;

const cache = new Map<string, Promise<PreTrainedTokenizer>>();

/**
 * @param modelDir Chemin absolu du dossier contenant tokenizer.json et
 *   tokenizer_config.json (sans slash final), ex : `${documentDirectory}ai-models/emotion`
 */
export function loadLocalTokenizer(modelDir: string): Promise<PreTrainedTokenizer> {
  const normalized = modelDir.replace(/\/$/, '');
  const cached = cache.get(normalized);
  if (cached) return cached;

  env.localModelPath = '';
  const promise = AutoTokenizer.from_pretrained(normalized, {
    local_files_only: true,
  }) as Promise<PreTrainedTokenizer>;

  cache.set(normalized, promise);
  promise.catch(() => cache.delete(normalized));
  return promise;
}
