/**
 * ModelDownloadManager — Téléchargement groupé des 3 modèles IA locaux
 *
 * Modèles hébergés sur https://github.com/l3ryx9/youme-ai/releases/tag/ai-models-v1
 *
 *   - "llm"     : Llama-3.2-1B-Instruct q4 ONNX  (~500 Mo)
 *   - "emotion" : CamemBERT français d'émotions   (~111 Mo)
 *   - "whisper" : Whisper Small multilingue        (~275 Mo)
 *
 * Total ≈ 900 Mo — téléchargement ~2× plus rapide que la version 3B.
 *
 * Synchronisation barre de progression :
 *   Le manager émet des événements status='retrying' pendant les délais de
 *   backoff afin que l'UI puisse afficher un compte à rebours en temps réel.
 */
import * as FileSystem from 'expo-file-system';

export type ModelId = 'llm' | 'emotion' | 'whisper';

interface ModelFileSpec {
  url: string;
  filename: string;
  approxBytes: number;
}

interface ModelSpec {
  files: ModelFileSpec[];
}

const MODELS_DIR = `${FileSystem.documentDirectory}ai-models/`;
const STATE_FILE = `${MODELS_DIR}download-state.json`;

/** Toutes les assets sont sur le release youme-ai */
const R = 'https://github.com/l3ryx9/youme-ai/releases/download/ai-models-v1';

export const MODEL_MANIFEST: Record<ModelId, ModelSpec> = {
  llm: {
    files: [
      // Llama-3.2-1B-Instruct q4 — ~500 Mo (vs 1,8 Go pour le 3B)
      { url: `${R}/llm-model_q4.onnx`,            filename: 'model.onnx',             approxBytes: 500_000_000 },
      { url: `${R}/llm-tokenizer.json`,            filename: 'tokenizer.json',          approxBytes: 9_000_000  },
      { url: `${R}/llm-tokenizer_config.json`,     filename: 'tokenizer_config.json',   approxBytes: 54_000     },
      { url: `${R}/llm-special_tokens_map.json`,   filename: 'special_tokens_map.json', approxBytes: 400        },
      { url: `${R}/llm-config.json`,               filename: 'config.json',             approxBytes: 1_000      },
      { url: `${R}/llm-generation_config.json`,    filename: 'generation_config.json',  approxBytes: 200        },
    ],
  },
  emotion: {
    files: [
      { url: `${R}/emotion-model.onnx`,            filename: 'model.onnx',             approxBytes: 111_403_778 },
      { url: `${R}/emotion-tokenizer.json`,         filename: 'tokenizer.json',          approxBytes: 2_421_253  },
      { url: `${R}/emotion-tokenizer_config.json`,  filename: 'tokenizer_config.json',   approxBytes: 1_813      },
      { url: `${R}/emotion-special_tokens_map.json`,filename: 'special_tokens_map.json', approxBytes: 1_058      },
      { url: `${R}/emotion-config.json`,            filename: 'config.json',             approxBytes: 965        },
    ],
  },
  whisper: {
    files: [
      { url: `${R}/whisper-encoder.onnx`,           filename: 'encoder_model.onnx',          approxBytes: 85_000_000  },
      { url: `${R}/whisper-decoder.onnx`,           filename: 'decoder_model_merged.onnx',   approxBytes: 190_000_000 },
      { url: `${R}/whisper-tokenizer.json`,          filename: 'tokenizer.json',              approxBytes: 2_400_000   },
      { url: `${R}/whisper-tokenizer_config.json`,   filename: 'tokenizer_config.json',       approxBytes: 5_000       },
      { url: `${R}/whisper-config.json`,             filename: 'config.json',                 approxBytes: 2_000       },
      { url: `${R}/whisper-generation_config.json`,  filename: 'generation_config.json',      approxBytes: 4_000       },
      { url: `${R}/whisper-preprocessor_config.json`,filename: 'preprocessor_config.json',    approxBytes: 339         },
      { url: `${R}/whisper-special_tokens_map.json`, filename: 'special_tokens_map.json',     approxBytes: 2_000       },
      { url: `${R}/whisper-normalizer.json`,         filename: 'normalizer.json',             approxBytes: 52_000      },
      { url: `${R}/whisper-added_tokens.json`,       filename: 'added_tokens.json',           approxBytes: 2_000       },
    ],
  },
};

const TOTAL_APPROX_BYTES = Object.values(MODEL_MANIFEST).reduce(
  (sum, model) => sum + model.files.reduce((s, f) => s + f.approxBytes, 0),
  0
);

export interface ModelDownloadProgress {
  modelId: ModelId;
  filename: string;
  fileIndex: number;
  fileCountForModel: number;
  overallProgress: number;
  status: 'downloading' | 'retrying';
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retryDelayMs?: number;
}

type ProgressListener = (progress: ModelDownloadProgress) => void;

interface DownloadState {
  completedModels: ModelId[];
}

const MAX_ATTEMPTS = 7;
const RETRY_DELAYS = [2000, 4000, 8000, 15000, 30000, 60000];
const STALL_TIMEOUT_MS = 20000;
const STALL_CHECK_INTERVAL_MS = 5000;

export class ModelDownloadManager {
  private progressListeners: ProgressListener[] = [];
  private downloadPromise: Promise<void> | null = null;

  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.push(listener);
    return () => {
      this.progressListeners = this.progressListeners.filter((l) => l !== listener);
    };
  }

  private emit(progress: ModelDownloadProgress): void {
    this.progressListeners.forEach((l) => l(progress));
  }

  private getModelDir(modelId: ModelId): string {
    return `${MODELS_DIR}${modelId}/`;
  }

  getFilePath(modelId: ModelId, filename: string): string {
    return `${this.getModelDir(modelId)}${filename}`;
  }

  private async readState(): Promise<DownloadState> {
    try {
      const info = await FileSystem.getInfoAsync(STATE_FILE);
      if (!info.exists) return { completedModels: [] };
      const raw = await FileSystem.readAsStringAsync(STATE_FILE);
      return JSON.parse(raw) as DownloadState;
    } catch {
      return { completedModels: [] };
    }
  }

  private async writeState(state: DownloadState): Promise<void> {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(STATE_FILE, JSON.stringify(state));
  }

  async isModelReady(modelId: ModelId): Promise<boolean> {
    const state = await this.readState();
    if (!state.completedModels.includes(modelId)) return false;
    const spec = MODEL_MANIFEST[modelId];
    for (const file of spec.files) {
      const info = await FileSystem.getInfoAsync(this.getFilePath(modelId, file.filename));
      if (!info.exists) return false;
    }
    return true;
  }

  async areAllModelsReady(): Promise<boolean> {
    const results = await Promise.all(
      (Object.keys(MODEL_MANIFEST) as ModelId[]).map((id) => this.isModelReady(id))
    );
    return results.every(Boolean);
  }

  async downloadAllModels(onProgress?: ProgressListener): Promise<void> {
    if (this.downloadPromise) return this.downloadPromise;
    const unsubscribe = onProgress ? this.onProgress(onProgress) : null;
    this.downloadPromise = this.runDownload().finally(() => {
      this.downloadPromise = null;
      unsubscribe?.();
    });
    return this.downloadPromise;
  }

  private async runDownload(): Promise<void> {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true }).catch(() => {});
    const state = await this.readState();

    const bytesBeforeModel = (modelId: ModelId): number => {
      let done = 0;
      for (const [id, spec] of Object.entries(MODEL_MANIFEST) as [ModelId, ModelSpec][]) {
        if (id === modelId) break;
        done += spec.files.reduce((s, f) => s + f.approxBytes, 0);
      }
      return done;
    };

    let bytesDoneAcrossAllModels = 0;

    for (const modelId of Object.keys(MODEL_MANIFEST) as ModelId[]) {
      if (await this.isModelReady(modelId)) {
        bytesDoneAcrossAllModels =
          bytesBeforeModel(modelId) +
          MODEL_MANIFEST[modelId].files.reduce((s, f) => s + f.approxBytes, 0);
        continue;
      }

      const spec = MODEL_MANIFEST[modelId];
      const modelDir = this.getModelDir(modelId);
      await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true }).catch(() => {});

      const modelBaseBytes = bytesBeforeModel(modelId);
      let bytesDoneInModel = 0;

      for (let i = 0; i < spec.files.length; i++) {
        const file = spec.files[i];
        const destPath = this.getFilePath(modelId, file.filename);

        const existing = await FileSystem.getInfoAsync(destPath);
        if (!existing.exists) {
          await this.downloadFileWithRetry(
            file.url,
            destPath,
            (bytesWritten, expectedBytes) => {
              const fileSize = (expectedBytes && expectedBytes > 0) ? expectedBytes : file.approxBytes;
              const normalizedBytes = Math.min(bytesWritten, fileSize) * (file.approxBytes / fileSize);
              const overall = (modelBaseBytes + bytesDoneInModel + normalizedBytes) / TOTAL_APPROX_BYTES;
              this.emit({
                modelId,
                filename: file.filename,
                fileIndex: i,
                fileCountForModel: spec.files.length,
                overallProgress: Math.min(overall, 0.999),
                status: 'downloading',
              });
            },
            (attempt, maxAttempts, delayMs, currentOverall) => {
              this.emit({
                modelId,
                filename: file.filename,
                fileIndex: i,
                fileCountForModel: spec.files.length,
                overallProgress: currentOverall,
                status: 'retrying',
                retryAttempt: attempt,
                retryMaxAttempts: maxAttempts,
                retryDelayMs: delayMs,
              });
            }
          );
        }

        bytesDoneInModel += file.approxBytes;
      }

      state.completedModels = Array.from(new Set([...state.completedModels, modelId]));
      await this.writeState(state);

      bytesDoneAcrossAllModels = modelBaseBytes + bytesDoneInModel;
      this.emit({
        modelId,
        filename: '',
        fileIndex: spec.files.length,
        fileCountForModel: spec.files.length,
        overallProgress: Math.min(bytesDoneAcrossAllModels / TOTAL_APPROX_BYTES, 1),
        status: 'downloading',
      });
    }
  }

  private async downloadFileWithRetry(
    url: string,
    destPath: string,
    onBytes: (bytesWritten: number, expectedBytes?: number) => void,
    onRetry: (attempt: number, maxAttempts: number, delayMs: number, currentOverall: number) => void
  ): Promise<void> {
    const tmpPath = `${destPath}.part`;
    let lastError: unknown;
    let resumeData: string | undefined;
    let lastKnownOverall = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let resumable: FileSystem.DownloadResumable | undefined;
      let stallIntervalId: ReturnType<typeof setInterval> | undefined;

      try {
        let lastProgressAt = Date.now();

        const progressCallback = (data: {
          totalBytesWritten: number;
          totalBytesExpectedToWrite: number;
        }) => {
          lastProgressAt = Date.now();
          onBytes(data.totalBytesWritten, data.totalBytesExpectedToWrite);
        };

        if (resumeData) {
          resumable = FileSystem.createDownloadResumable(
            url, tmpPath, {}, progressCallback, resumeData
          );
        } else {
          await FileSystem.deleteAsync(tmpPath, { idempotent: true });
          resumable = FileSystem.createDownloadResumable(
            url, tmpPath, {}, progressCallback
          );
        }

        const stallWatchdog = new Promise<never>((_, reject) => {
          stallIntervalId = setInterval(() => {
            if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
              reject(new Error(
                `Téléchargement bloqué depuis ${STALL_TIMEOUT_MS / 1000}s pour ${url}`
              ));
            }
          }, STALL_CHECK_INTERVAL_MS);
        });

        const result = await Promise.race([resumable.downloadAsync(), stallWatchdog]);

        if (!result || result.status !== 200) {
          throw new Error(`Status ${result?.status ?? 'inconnu'} pour ${url}`);
        }

        await FileSystem.moveAsync({ from: tmpPath, to: destPath });
        return;

      } catch (error) {
        lastError = error;
        console.warn(`[ModelDownloadManager] Tentative ${attempt}/${MAX_ATTEMPTS} échouée:`, error);

        if (resumable) {
          try {
            const pauseState = await resumable.pauseAsync();
            resumeData = pauseState.resumeData;
          } catch {
            try { resumeData = resumable.savable().resumeData; } catch { resumeData = undefined; }
          }
        }

        if (attempt < MAX_ATTEMPTS) {
          const delay = RETRY_DELAYS[attempt - 1] ?? 60000;
          console.log(`[ModelDownloadManager] Reconnexion dans ${delay / 1000}s…`);

          // Émettre une mise à jour par seconde pour le compte à rebours UI
          const tickMs = 1000;
          let elapsed = 0;
          while (elapsed < delay) {
            onRetry(attempt, MAX_ATTEMPTS, delay - elapsed, lastKnownOverall);
            await new Promise((r) => setTimeout(r, Math.min(tickMs, delay - elapsed)));
            elapsed += tickMs;
          }
        }

      } finally {
        if (stallIntervalId) clearInterval(stallIntervalId);
      }
    }

    await FileSystem.deleteAsync(tmpPath, { idempotent: true });
    throw lastError instanceof Error
      ? lastError
      : new Error(`Échec du téléchargement de ${url}`);
  }

  async deleteAllModels(): Promise<void> {
    await FileSystem.deleteAsync(MODELS_DIR, { idempotent: true });
  }

  getTotalApproxBytes(): number {
    return TOTAL_APPROX_BYTES;
  }
}

export const modelDownloadManager = new ModelDownloadManager();
