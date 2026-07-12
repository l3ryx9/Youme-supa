/**
 * Service Whisper Tiny — Transcription vocale locale (ONNX, on-device)
 *
 * Modèle : onnx-community/whisper-tiny (encoder + decoder_model_merged,
 * quantifiés, cache KV). Les messages vocaux sont enregistrés en WAV PCM16
 * 16 kHz (voir VoiceRecorder.tsx / audioUtils.ts) car un modèle Whisper a
 * besoin d'échantillons audio bruts — impossible à extraire d'un AAC/M4A
 * sans décodeur natif supplémentaire (voir memoire "android-pcm-audio-recording").
 *
 * Aucune donnée audio n'est envoyée à un serveur externe : tout se passe sur
 * l'appareil.
 */
import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import * as FileSystem from 'expo-file-system';
import { modelDownloadManager } from '@ai/models/ModelDownloadManager';
import { loadLocalTokenizer } from '@ai/models/tokenizerLoader';
import { argmax } from '@ai/models/onnxUtils';
import { computeLogMelSpectrogram } from './melSpectrogram';
import { base64ToBytes, decodeWavPcm16 } from './audioUtils';

export interface WhisperTranscriptionResult {
  text: string;
  language: string;
  duration: number;
  segments: TranscriptionSegment[];
  confidence: number;
}

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export type WhisperStatus = 'idle' | 'loading' | 'transcribing' | 'ready' | 'unavailable';

// Configuration de whisper-tiny (voir config.json du modèle).
const NUM_LAYERS = 4;
const NUM_HEADS = 6;
const HEAD_DIM = 64;
const MAX_NEW_TOKENS = 200;
const TARGET_SAMPLE_RATE = 16000;

export class WhisperService {
  private isModelLoaded = false;
  private status: WhisperStatus = 'idle';
  private statusListeners: ((status: WhisperStatus) => void)[] = [];
  private encoderSession: InferenceSession | null = null;
  private decoderSession: InferenceSession | null = null;
  private tokenizer: Awaited<ReturnType<typeof loadLocalTokenizer>> | null = null;

  private setStatus(status: WhisperStatus): void {
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  getStatus(): WhisperStatus {
    return this.status;
  }

  onStatusChange(listener: (status: WhisperStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Initialise et charge le modèle Whisper Tiny.
   * Doit être appelé une fois au démarrage de l'application.
   * Échoue gracieusement si le modèle est absent.
   */
  async initialize(): Promise<boolean> {
    try {
      this.setStatus('loading');

      const ready = await modelDownloadManager.isModelReady('whisper');
      if (!ready) {
        console.warn('[WhisperService] Modèle non téléchargé.');
        this.setStatus('unavailable');
        return false;
      }

      const encoderPath = modelDownloadManager.getFilePath('whisper', 'encoder_model.onnx');
      const decoderPath = modelDownloadManager.getFilePath('whisper', 'decoder_model_merged.onnx');
      const modelDir = encoderPath.substring(0, encoderPath.lastIndexOf('/'));

      this.tokenizer = await loadLocalTokenizer(modelDir);
      this.encoderSession = await InferenceSession.create(encoderPath);
      this.decoderSession = await InferenceSession.create(decoderPath);

      this.isModelLoaded = true;
      this.setStatus('ready');
      console.log('[WhisperService] Modèle Whisper Tiny chargé.');
      return true;
    } catch (error) {
      console.error("[WhisperService] Erreur d'initialisation :", error);
      this.setStatus('unavailable');
      return false;
    }
  }

  /**
   * Transcrit un fichier audio local (WAV PCM16 16 kHz mono).
   * Retourne null si le modèle n'est pas disponible (fallback gracieux).
   */
  async transcribe(audioFilePath: string): Promise<WhisperTranscriptionResult | null> {
    if (!this.isModelLoaded || !this.encoderSession || !this.decoderSession || !this.tokenizer) {
      console.warn('[WhisperService] Modèle non chargé. Transcription indisponible.');
      return null;
    }

    try {
      this.setStatus('transcribing');

      const info = await FileSystem.getInfoAsync(audioFilePath);
      if (!info.exists) {
        throw new Error(`Fichier audio introuvable : ${audioFilePath}`);
      }

      const base64 = await FileSystem.readAsStringAsync(audioFilePath, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const wavBytes = base64ToBytes(base64);
      const { samples, sampleRate } = decodeWavPcm16(wavBytes);

      if (sampleRate !== TARGET_SAMPLE_RATE) {
        console.warn(
          `[WhisperService] Fréquence d'échantillonnage inattendue (${sampleRate} Hz, attendu ${TARGET_SAMPLE_RATE} Hz) — la précision peut être réduite.`
        );
      }

      const durationSeconds = samples.length / sampleRate;
      const { text, language } = await this.runInference(samples);

      this.setStatus('ready');
      return {
        text: text.trim(),
        language: language ?? 'fr',
        duration: durationSeconds,
        segments: [],
        confidence: text.trim() ? 0.7 : 0,
      };
    } catch (error) {
      console.error('[WhisperService] Erreur de transcription :', error);
      this.setStatus('ready');
      return null;
    }
  }

  private async runInference(samples: Float32Array): Promise<{ text: string; language: string }> {
    const { data: melData, nFrames } = computeLogMelSpectrogram(samples);
    const encoderFeeds: Record<string, Tensor> = {
      input_features: new Tensor('float32', melData, [1, 80, nFrames]),
    };

    const encoderOutputs = await this.encoderSession!.run(encoderFeeds);
    const encoderHiddenStates = encoderOutputs.last_hidden_state;

    const tokenizer = this.tokenizer! as any;
    // Préfixe standard Whisper multilingue : <|startoftranscript|><|fr|><|transcribe|><|notimestamps|>
    const startTokens = this.resolveStartTokens(tokenizer);
    let generatedIds: number[] = [...startTokens];

    let pastKeyValues = this.emptyDecoderPast();
    const decoderSession = this.decoderSession!;

    for (let step = 0; step < MAX_NEW_TOKENS; step++) {
      const isFirstStep = step === 0;
      const stepInputIds = isFirstStep ? generatedIds : [generatedIds[generatedIds.length - 1]];
      const seqLen = stepInputIds.length;

      const feeds: Record<string, Tensor> = {
        input_ids: new Tensor('int64', BigInt64Array.from(stepInputIds.map(BigInt)), [1, seqLen]),
        encoder_hidden_states: encoderHiddenStates,
        ...pastKeyValues,
      };
      if (decoderSession.inputNames.includes('use_cache_branch')) {
        feeds.use_cache_branch = new Tensor('bool', [!isFirstStep], [1]);
      }

      const outputs = await decoderSession.run(feeds);
      const logitsTensor = outputs.logits;
      const vocabSize = logitsTensor.dims[logitsTensor.dims.length - 1];
      const lastLogits = (logitsTensor.data as Float32Array).slice(
        (seqLen - 1) * vocabSize,
        seqLen * vocabSize
      );

      const nextId = argmax(lastLogits);
      const eosId = tokenizer.model?.eos_token_id ?? tokenizer.getEosTokenId?.();
      if (typeof eosId === 'number' && nextId === eosId) break;

      generatedIds.push(nextId);
      pastKeyValues = this.extractPresentAsPast(outputs, decoderSession.outputNames);
    }

    const textIds = generatedIds.slice(startTokens.length);
    const text = tokenizer.decode(textIds, { skip_special_tokens: true }) as string;
    return { text, language: 'fr' };
  }

  private resolveStartTokens(tokenizer: any): number[] {
    try {
      const bos = tokenizer.model?.tokens_to_ids?.get?.('<|startoftranscript|>');
      const frLang = tokenizer.model?.tokens_to_ids?.get?.('<|fr|>');
      const transcribe = tokenizer.model?.tokens_to_ids?.get?.('<|transcribe|>');
      const noTimestamps = tokenizer.model?.tokens_to_ids?.get?.('<|notimestamps|>');
      const tokens = [bos, frLang, transcribe, noTimestamps].filter(
        (t): t is number => typeof t === 'number'
      );
      if (tokens.length === 4) return tokens;
    } catch {
      // ignore — fallback ci-dessous
    }
    // Repli : laisser le modèle démarrer sur le token BOS générique s'il est
    // exposé par la config du tokenizer, sinon 0 (résultat potentiellement
    // dégradé, journalisé pour diagnostic sur device).
    console.warn('[WhisperService] Tokens de préfixe Whisper introuvables — repli générique.');
    const genericBos = tokenizer.model?.bos_token_id;
    return typeof genericBos === 'number' ? [genericBos] : [0];
  }

  private emptyDecoderPast(): Record<string, Tensor> {
    const feeds: Record<string, Tensor> = {};
    for (let i = 0; i < NUM_LAYERS; i++) {
      feeds[`past_key_values.${i}.decoder.key`] = new Tensor(
        'float32',
        new Float32Array(0),
        [1, NUM_HEADS, 0, HEAD_DIM]
      );
      feeds[`past_key_values.${i}.decoder.value`] = new Tensor(
        'float32',
        new Float32Array(0),
        [1, NUM_HEADS, 0, HEAD_DIM]
      );
      feeds[`past_key_values.${i}.encoder.key`] = new Tensor(
        'float32',
        new Float32Array(0),
        [1, NUM_HEADS, 0, HEAD_DIM]
      );
      feeds[`past_key_values.${i}.encoder.value`] = new Tensor(
        'float32',
        new Float32Array(0),
        [1, NUM_HEADS, 0, HEAD_DIM]
      );
    }
    return feeds;
  }

  private extractPresentAsPast(
    outputs: Record<string, Tensor>,
    outputNames: readonly string[]
  ): Record<string, Tensor> {
    const feeds: Record<string, Tensor> = {};
    for (const name of outputNames) {
      if (name.startsWith('present.')) {
        const pastName = name.replace('present.', 'past_key_values.');
        feeds[pastName] = outputs[name];
      }
    }
    return feeds;
  }

  /**
   * Retourne true si le modèle Whisper est disponible et chargé.
   */
  isAvailable(): boolean {
    return this.isModelLoaded && this.status === 'ready';
  }
}

export const whisperService = new WhisperService();
