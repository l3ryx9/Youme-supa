/**
 * ModelDownloadManager — Téléchargement des modèles IA depuis GitHub Releases
 *
 * Télécharge les 3 modèles IA (LLM, Emotion, Whisper) depuis la release
 * ai-models-v1 du repo youme-ai vers FileSystem.documentDirectory/ai_models/.
 *
 * Fonctionnalités :
 *  - Reprise automatique (fichiers partiels supprimés)
 *  - Retry exponentiel (7 tentatives max, délai doublé à chaque fois)
 *  - Progression globale pondérée par la taille relative des modèles
 *  - Saute les modèles déjà complets
 */
import * as FileSystem from 'expo-file-system';

// ─── Types publics ────────────────────────────────────────────────────────────

export type ModelId = 'llm' | 'emotion' | 'whisper';

export interface ModelDownloadProgress {
  modelId: ModelId;
  status: 'downloading' | 'retrying' | 'done' | 'error';
  /** Progression globale sur les 3 modèles, entre 0 et 1 */
  overallProgress: number;
  currentFile?: string;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retryDelayMs?: number;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const RELEASE_BASE =
  'https://github.com/l3ryx9/youme-ai/releases/download/ai-models-v1';

const MODELS_DIR = `${FileSystem.documentDirectory}ai_models/`;

const MAX_RETRY = 7;
const RETRY_BASE_MS = 2_000;

/** Poids relatifs pour la barre de progression globale (proportionnels aux tailles) */
const MODEL_WEIGHTS: Record<ModelId, number> = {
  emotion: 0.15, // ~110 MB
  whisper: 0.30, // ~240 MB
  llm:     0.55, // ~450 MB
};

/** Ordre de téléchargement : du plus léger au plus lourd */
const MODEL_ORDER: ModelId[] = ['emotion', 'whisper', 'llm'];

// ─── Mapping remote → local ───────────────────────────────────────────────────

interface FileSpec {
  /** Nom du fichier dans la GitHub Release */
  remote: string;
  /** Nom du fichier dans le dossier local du modèle */
  local: string;
}

const MODEL_FILES: Record<ModelId, FileSpec[]> = {
  llm: [
    { remote: 'llm-model_q4.onnx',            local: 'model.onnx' },
    { remote: 'llm-tokenizer.json',            local: 'tokenizer.json' },
    { remote: 'llm-tokenizer_config.json',     local: 'tokenizer_config.json' },
    { remote: 'llm-special_tokens_map.json',   local: 'special_tokens_map.json' },
    { remote: 'llm-config.json',               local: 'config.json' },
    { remote: 'llm-generation_config.json',    local: 'generation_config.json' },
  ],
  emotion: [
    { remote: 'emotion-model.onnx',            local: 'model.onnx' },
    { remote: 'emotion-tokenizer.json',        local: 'tokenizer.json' },
    { remote: 'emotion-tokenizer_config.json', local: 'tokenizer_config.json' },
    { remote: 'emotion-special_tokens_map.json', local: 'special_tokens_map.json' },
    { remote: 'emotion-config.json',           local: 'config.json' },
  ],
  whisper: [
    { remote: 'whisper-encoder.onnx',              local: 'encoder_model.onnx' },
    { remote: 'whisper-decoder.onnx',              local: 'decoder_model_merged.onnx' },
    { remote: 'whisper-tokenizer.json',            local: 'tokenizer.json' },
    { remote: 'whisper-tokenizer_config.json',     local: 'tokenizer_config.json' },
    { remote: 'whisper-config.json',               local: 'config.json' },
    { remote: 'whisper-generation_config.json',    local: 'generation_config.json' },
    { remote: 'whisper-preprocessor_config.json',  local: 'preprocessor_config.json' },
    { remote: 'whisper-special_tokens_map.json',   local: 'special_tokens_map.json' },
    { remote: 'whisper-normalizer.json',           local: 'normalizer.json' },
    { remote: 'whisper-added_tokens.json',         local: 'added_tokens.json' },
  ],
};

// ─── Classe principale ────────────────────────────────────────────────────────

class ModelDownloadManager {
  private listeners: ((p: ModelDownloadProgress) => void)[] = [];
  private completedWeights = 0;

  // ── API publique ────────────────────────────────────────────────────────────

  /**
   * S'abonne aux événements de progression.
   * Retourne une fonction pour se désabonner.
   */
  onProgress(cb: (p: ModelDownloadProgress) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  /**
   * Retourne le chemin absolu d'un fichier local pour un modèle donné.
   *
   * @example
   *   getFilePath('whisper', 'encoder_model.onnx')
   *   // → file:///data/user/0/.../ai_models/whisper/encoder_model.onnx
   */
  getFilePath(modelId: ModelId, localFilename: string): string {
    return `${MODELS_DIR}${modelId}/${localFilename}`;
  }

  /**
   * Vérifie si tous les fichiers d'un modèle sont présents et non vides.
   */
  async isModelReady(modelId: ModelId): Promise<boolean> {
    for (const { local } of MODEL_FILES[modelId]) {
      const info = await FileSystem.getInfoAsync(
        this.getFilePath(modelId, local)
      );
      if (!info.exists || (info as any).size === 0) return false;
    }
    return true;
  }

  /**
   * Télécharge les 3 modèles dans l'ordre : emotion → whisper → llm.
   * Saute automatiquement les modèles déjà complets.
   * Lance une erreur si un fichier échoue après MAX_RETRY tentatives.
   */
  async downloadAllModels(): Promise<void> {
    await this.ensureDir(MODELS_DIR);
    this.completedWeights = 0;

    for (const modelId of MODEL_ORDER) {
      const already = await this.isModelReady(modelId);
      if (already) {
        this.completedWeights += MODEL_WEIGHTS[modelId];
        this.emit({
          modelId,
          status: 'done',
          overallProgress: Math.min(this.completedWeights, 1),
        });
        continue;
      }
      await this.downloadModel(modelId);
    }
  }

  // ── Interne ─────────────────────────────────────────────────────────────────

  private async downloadModel(modelId: ModelId): Promise<void> {
    const files = MODEL_FILES[modelId];
    const modelDir = `${MODELS_DIR}${modelId}/`;
    await this.ensureDir(modelDir);

    const weightPerFile = MODEL_WEIGHTS[modelId] / files.length;

    for (const { remote, local } of files) {
      const localPath = `${modelDir}${local}`;

      // Fichier déjà présent et non vide : on saute
      const info = await FileSystem.getInfoAsync(localPath);
      if (info.exists && (info as any).size > 0) {
        this.completedWeights += weightPerFile;
        this.emit({
          modelId,
          status: 'downloading',
          overallProgress: Math.min(this.completedWeights, 1),
          currentFile: local,
        });
        continue;
      }

      await this.downloadFileWithRetry(
        modelId,
        `${RELEASE_BASE}/${remote}`,
        localPath,
        local,
        weightPerFile,
      );
    }

    this.emit({
      modelId,
      status: 'done',
      overallProgress: Math.min(this.completedWeights, 1),
    });
  }

  private async downloadFileWithRetry(
    modelId: ModelId,
    url: string,
    localPath: string,
    label: string,
    weight: number,
  ): Promise<void> {
    const tmpPath = `${localPath}.tmp`;

    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        // Nettoyer un fichier temporaire précédent
        const tmpInfo = await FileSystem.getInfoAsync(tmpPath);
        if (tmpInfo.exists) {
          await FileSystem.deleteAsync(tmpPath, { idempotent: true });
        }

        const downloadResumable = FileSystem.createDownloadResumable(
          url,
          tmpPath,
          {},
          (progressEvent) => {
            const { totalBytesWritten, totalBytesExpectedToWrite } = progressEvent;
            const fileRatio =
              totalBytesExpectedToWrite > 0
                ? totalBytesWritten / totalBytesExpectedToWrite
                : 0;
            this.emit({
              modelId,
              status: 'downloading',
              overallProgress: Math.min(
                this.completedWeights + weight * fileRatio,
                1,
              ),
              currentFile: label,
            });
          },
        );

        const result = await downloadResumable.downloadAsync();

        if (!result || result.status !== 200) {
          throw new Error(`HTTP ${result?.status ?? '?'} pour ${url}`);
        }

        // Renommer le fichier temporaire en fichier final (opération atomique)
        await FileSystem.moveAsync({ from: tmpPath, to: localPath });

        this.completedWeights += weight;
        this.emit({
          modelId,
          status: 'downloading',
          overallProgress: Math.min(this.completedWeights, 1),
          currentFile: label,
        });
        return; // ✅ succès

      } catch (err) {
        // Supprimer le fichier temporaire corrompu
        await FileSystem.deleteAsync(tmpPath, { idempotent: true }).catch(() => {});

        if (attempt >= MAX_RETRY) {
          throw new Error(
            `[ModelDownloadManager] Échec de ${label} après ${MAX_RETRY} tentatives : ${err}`,
          );
        }

        // Backoff exponentiel : 2s, 4s, 8s, 16s, 32s, 64s
        const delayMs = RETRY_BASE_MS * Math.pow(2, attempt - 1);

        this.emit({
          modelId,
          status: 'retrying',
          overallProgress: Math.min(this.completedWeights, 1),
          currentFile: label,
          retryAttempt: attempt,
          retryMaxAttempts: MAX_RETRY,
          retryDelayMs: delayMs,
        });

        await this.sleep(delayMs);
      }
    }
  }

  private emit(p: ModelDownloadProgress): void {
    this.listeners.forEach((l) => l(p));
  }

  private async ensureDir(dir: string): Promise<void> {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const modelDownloadManager = new ModelDownloadManager();
