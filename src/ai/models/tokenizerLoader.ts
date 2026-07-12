/**
 * tokenizerLoader — Chargement des tokenizers HuggingFace depuis le stockage local
 *
 * Utilise @xenova/transformers pour charger les tokenizers ONNX sauvegardés
 * localement par ModelDownloadManager.
 *
 * Le mécanisme :
 *  1. Intercepte fetch() pour les URLs file:// afin de servir les fichiers
 *     depuis expo-file-system (React Native n'implémente pas fetch('file://…'))
 *  2. Configure @xenova/transformers en mode local uniquement
 *  3. Charge le tokenizer depuis le dossier du modèle
 *  4. Restaure fetch() après le chargement
 */
import * as FileSystem from 'expo-file-system';
import { env, AutoTokenizer } from '@xenova/transformers';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TokenizerOutput = {
  input_ids: { data: BigInt64Array | Int32Array | number[] };
  attention_mask: { data: BigInt64Array | Int32Array | number[] };
  token_type_ids?: { data: BigInt64Array | Int32Array | number[] };
  [key: string]: any;
};

export type LocalTokenizer = {
  (text: string, options?: TokenizerOptions): TokenizerOutput;
  model?: { eos_token_id?: number };
  [key: string]: any;
};

export interface TokenizerOptions {
  truncation?: boolean;
  max_length?: number;
  padding?: string | boolean;
  return_tensors?: string | boolean;
  add_special_tokens?: boolean;
}

// ─── Patch fetch pour les URLs file:// ────────────────────────────────────────

/**
 * En React Native, fetch() ne supporte pas les URLs file://.
 * @xenova/transformers en a besoin pour charger tokenizer.json etc.
 * depuis le stockage local.
 *
 * Cette fonction remplace temporairement fetch() par une version
 * qui intercepte les file:// et les sert via expo-file-system.
 */
function patchFetchForLocalFiles(): () => void {
  const originalFetch = global.fetch;

  global.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.startsWith('file://')) {
      try {
        const filePath = url; // expo-file-system accepte les file:// URIs directement
        const info = await FileSystem.getInfoAsync(filePath);

        if (!info.exists) {
          return new Response(null, {
            status: 404,
            statusText: `File not found: ${filePath}`,
          });
        }

        const content = await FileSystem.readAsStringAsync(filePath, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        // Déterminer le Content-Type selon l'extension
        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
        const contentType =
          ext === 'json' ? 'application/json' :
          ext === 'txt'  ? 'text/plain' :
          'application/octet-stream';

        return new Response(content, {
          status: 200,
          headers: { 'Content-Type': contentType },
        });
      } catch (err) {
        console.warn(`[tokenizerLoader] Impossible de lire ${url} :`, err);
        return new Response(null, { status: 500, statusText: String(err) });
      }
    }

    // URL normale : déléguer au fetch original
    return originalFetch(input, init);
  };

  // Retourne une fonction pour restaurer le fetch original
  return () => {
    global.fetch = originalFetch;
  };
}

// ─── Fonction principale ──────────────────────────────────────────────────────

/**
 * Charge un tokenizer depuis un dossier local (issu du ModelDownloadManager).
 *
 * @param modelDir  Chemin absolu du dossier contenant tokenizer.json
 *                  (ex: file:///data/.../ai_models/llm/)
 * @returns Tokenizer @xenova/transformers utilisable comme fonction
 *
 * @example
 *   const tokenizer = await loadLocalTokenizer(modelDownloadManager.getFilePath('llm', ''));
 *   const { input_ids } = tokenizer('Bonjour le monde', { truncation: true, max_length: 128 });
 */
export async function loadLocalTokenizer(modelDir: string): Promise<LocalTokenizer> {
  // Normaliser le chemin (supprimer le slash final s'il existe)
  const dir = modelDir.endsWith('/') ? modelDir.slice(0, -1) : modelDir;

  // Configurer @xenova/transformers en mode local uniquement
  env.allowRemoteModels = false;
  env.allowLocalModels = true;

  // Patch fetch pour intercepter les file:// URLs
  const restoreFetch = patchFetchForLocalFiles();

  try {
    const tokenizer = await AutoTokenizer.from_pretrained(dir);
    return tokenizer as unknown as LocalTokenizer;
  } finally {
    restoreFetch();
  }
}

// ─── Utilitaire : lecture directe d'un fichier JSON du modèle ────────────────

/**
 * Lit un fichier JSON depuis le dossier d'un modèle local.
 * Pratique pour lire generation_config.json, config.json, etc.
 *
 * @returns L'objet JSON parsé, ou null si le fichier est absent/invalide
 */
export async function readModelJson<T = Record<string, unknown>>(
  modelDir: string,
  filename: string,
): Promise<T | null> {
  const dir = modelDir.endsWith('/') ? modelDir.slice(0, -1) : modelDir;
  const path = `${dir}/${filename}`;

  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;

    const raw = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
