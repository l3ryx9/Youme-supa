/**
 * Service d'Analyse Émotionnelle — CamemBERT français (ONNX, local, on-device)
 *
 * Modèle : astrosbd/french_emotion_camembert, converti en ONNX et quantifié
 * int8 (voir ai-models-v1 sur GitHub Releases). 6 émotions : tristesse, peur,
 * colère, neutre, surprise, joie. Spécifique au français — pas de fallback
 * multilingue générique.
 *
 * IMPORTANT : Les résultats sont PROBABILISTES et ne constituent pas
 * une certitude. L'interface utilisateur doit toujours formuler les
 * résultats avec des termes comme "probable", "possible", "suggère".
 */
import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import * as FileSystem from 'expo-file-system';
import type { EmotionResult, EmotionScore } from '@domain/entities/Message';
import { modelDownloadManager } from '@ai/models/ModelDownloadManager';
import { loadLocalTokenizer } from '@ai/models/tokenizerLoader';
import { softmax } from '@ai/models/onnxUtils';

export const EMOTION_LABELS: Record<string, string> = {
  joy: 'Joie',
  sadness: 'Tristesse',
  anger: 'Colère',
  fear: 'Peur',
  surprise: 'Surprise',
  disgust: 'Dégoût',
  neutral: 'Neutre',
  love: 'Amour',
  optimism: 'Optimisme',
  pessimism: 'Pessimisme',
};

const EMOTION_COLORS: Record<string, string> = {
  joy: '#FFD700',
  sadness: '#6495ED',
  anger: '#FF4444',
  fear: '#9370DB',
  surprise: '#FF8C00',
  disgust: '#6B8E23',
  neutral: '#9E9E9E',
  love: '#FF69B4',
  optimism: '#00CED1',
  pessimism: '#708090',
};

// id2label du modèle astrosbd/french_emotion_camembert (voir emotion-fr-config.json)
const MODEL_ID2LABEL: Record<number, string> = {
  0: 'sadness',
  1: 'fear',
  2: 'anger',
  3: 'neutral',
  4: 'surprise',
  5: 'joy',
};

const MAX_SEQUENCE_LENGTH = 128;

export class EmotionAnalysisService {
  private isModelLoaded = false;
  private session: InferenceSession | null = null;
  private tokenizer: Awaited<ReturnType<typeof loadLocalTokenizer>> | null = null;

  /**
   * Initialise le modèle d'analyse émotionnelle.
   * Échoue gracieusement (fallback heuristique) si le modèle n'est pas
   * encore téléchargé ou si le chargement échoue.
   */
  async initialize(): Promise<boolean> {
    try {
      const ready = await modelDownloadManager.isModelReady('emotion');
      if (!ready) {
        console.warn('[EmotionService] Modèle non téléchargé — fallback heuristique actif.');
        return false;
      }

      const modelPath = modelDownloadManager.getFilePath('emotion', 'model.onnx');
      const modelDir = modelPath.substring(0, modelPath.lastIndexOf('/'));

      this.tokenizer = await loadLocalTokenizer(modelDir);
      this.session = await InferenceSession.create(modelPath);
      this.isModelLoaded = true;
      console.log('[EmotionService] Modèle CamemBERT-émotion chargé.');
      return true;
    } catch (error) {
      console.error("[EmotionService] Erreur d'initialisation :", error);
      this.isModelLoaded = false;
      return false;
    }
  }

  /**
   * Analyse les émotions d'un texte français.
   * Retourne une analyse ONNX si le modèle est chargé, sinon un fallback
   * heuristique par mots-clés.
   *
   * Les scores retournés sont des probabilités (somme = 1.0).
   * JAMAIS présentés comme des certitudes dans l'UI.
   */
  async analyze(text: string): Promise<EmotionResult | null> {
    if (!text.trim()) return null;

    if (!this.isModelLoaded || !this.session || !this.tokenizer) {
      return this.heuristicAnalysis(text);
    }

    try {
      return await this.onnxAnalysis(text);
    } catch (error) {
      console.error("[EmotionService] Erreur d'analyse ONNX, fallback heuristique :", error);
      return this.heuristicAnalysis(text);
    }
  }

  private async onnxAnalysis(text: string): Promise<EmotionResult> {
    const session = this.session!;
    const tokenizer = this.tokenizer!;

    const encoded = tokenizer(text, {
      padding: true,
      truncation: true,
      max_length: MAX_SEQUENCE_LENGTH,
      return_tensors: false,
    }) as { input_ids: number[]; attention_mask: number[] };

    const inputIds = Int32Array.from(encoded.input_ids.map((v) => Number(v)));
    const attentionMask = Int32Array.from(encoded.attention_mask.map((v) => Number(v)));
    const dims = [1, inputIds.length];

    const feeds: Record<string, Tensor> = {
      input_ids: new Tensor('int64', BigInt64Array.from(Array.from(inputIds).map(BigInt)), dims),
      attention_mask: new Tensor(
        'int64',
        BigInt64Array.from(Array.from(attentionMask).map(BigInt)),
        dims
      ),
    };

    const results = await session.run(feeds);
    const logitsTensor = results.logits ?? results[session.outputNames[0]];
    const logits = logitsTensor.data as Float32Array;
    const probs = softmax(logits);

    const scores: EmotionScore[] = Array.from(probs).map((score, index) => ({
      emotion: MODEL_ID2LABEL[index] ?? `label_${index}`,
      score,
    }));
    scores.sort((a, b) => b.score - a.score);

    const primary = scores[0];
    return {
      primary: primary.emotion,
      primaryScore: primary.score,
      secondary: scores.slice(1, 4).filter((s) => s.score > 0.05),
      label: this.buildLabel(primary.emotion, primary.score),
    };
  }

  /**
   * Analyse heuristique légère basée sur des mots-clés.
   * Utilisée comme fallback quand le modèle ONNX n'est pas disponible.
   */
  private heuristicAnalysis(text: string): EmotionResult {
    const lower = text.toLowerCase();

    const emotionKeywords: Record<string, string[]> = {
      joy: ['heureux', 'heureuse', 'content', 'contente', 'super', 'génial', 'parfait', 'bravo', '😊', '😄', '🎉', 'excellent', 'merci'],
      sadness: ['triste', 'déprimé', 'malheureux', 'pleure', 'pleuré', 'seul', 'seule', 'mal', '😢', '😭', 'dommage'],
      anger: ['énervé', 'furieux', 'colère', 'rage', 'insupportable', 'nul', 'nulle', '😡', '🤬', 'inacceptable'],
      fear: ['peur', 'inquiet', 'angoissé', 'stressé', 'anxieux', 'crainte', '😨', '😰', 'effrayé'],
      surprise: ['surpris', 'incroyable', 'wow', 'choqué', 'étonnant', '😮', '😲', 'vraiment'],
      love: ['amour', 'adore', 'chéri', 'chérie', '❤️', '💕', '💖', 'tendresse', 'bisou'],
    };

    const scores: EmotionScore[] = [];
    let total = 0;

    for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
      const count = keywords.filter((k) => lower.includes(k)).length;
      const score = Math.min(count * 0.15, 0.9);
      scores.push({ emotion, score });
      total += score;
    }

    if (total === 0) {
      scores.push({ emotion: 'neutral', score: 1.0 });
      total = 1.0;
    }

    const normalized = scores
      .map((s) => ({ ...s, score: total > 0 ? s.score / total : 0 }))
      .sort((a, b) => b.score - a.score);

    if (normalized[0].emotion !== 'neutral' && total === 0) {
      normalized.unshift({ emotion: 'neutral', score: 1.0 });
    }

    const primary = normalized[0];
    return {
      primary: primary.emotion,
      primaryScore: primary.score,
      secondary: normalized.slice(1, 4).filter((s) => s.score > 0.05),
      label: this.buildLabel(primary.emotion, primary.score),
    };
  }

  /**
   * Construit un label probabiliste pour l'UI.
   * JAMAIS de formulation certaine — toujours probabiliste.
   */
  private buildLabel(emotion: string, score: number): string {
    const emotionFr = EMOTION_LABELS[emotion] ?? emotion;
    if (score > 0.7) return `Suggère probablement : ${emotionFr}`;
    if (score > 0.4) return `Pourrait indiquer : ${emotionFr}`;
    return `Légère tendance vers : ${emotionFr}`;
  }

  /**
   * Retourne la couleur associée à une émotion.
   */
  getEmotionColor(emotion: string): string {
    return EMOTION_COLORS[emotion] ?? '#9E9E9E';
  }

  isAvailable(): boolean {
    return this.isModelLoaded;
  }
}

export const emotionService = new EmotionAnalysisService();
