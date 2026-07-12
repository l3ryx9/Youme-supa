/**
 * Orchestrateur IA
 *
 * Coordonne le pipeline d'analyse IA pour chaque message :
 * - Messages texte : analyse émotionnelle → LLM → mémoire
 * - Messages vocaux : Whisper → analyse émotionnelle → LLM → mémoire
 *
 * Toutes les opérations sont asynchrones et non bloquantes pour l'UI.
 * Les résultats sont stockés localement et mis à jour dans Firestore.
 *
 * Le pipeline est désactivable par l'utilisateur (paramètre aiEnabled).
 */
import { whisperService } from '../whisper/WhisperService';
import { emotionService } from '../emotion/EmotionAnalysisService';
import { llmService } from '../llm/LLMService';
import { memoryRepository } from '@infrastructure/storage/LocalMemoryRepository';
import type { Message, AIAnalysisResult } from '@domain/entities/Message';
import type { MemoryCategory } from '@domain/entities/Memory';

export type PipelineStep = 'whisper' | 'emotion' | 'llm' | 'memory' | 'complete' | 'error';

export interface PipelineProgress {
  step: PipelineStep;
  messageId: string;
  progress: number;
}

type ProgressListener = (progress: PipelineProgress) => void;

export class AIOrchestrator {
  private progressListeners: ProgressListener[] = [];
  private processingQueue: Map<string, Promise<AIAnalysisResult | null>> = new Map();

  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.push(listener);
    return () => {
      this.progressListeners = this.progressListeners.filter((l) => l !== listener);
    };
  }

  private emit(step: PipelineStep, messageId: string, progress: number): void {
    this.progressListeners.forEach((l) => l({ step, messageId, progress }));
  }

  /**
   * Initialise tous les services IA.
   * À appeler une fois au démarrage de l'application.
   */
  async initialize(): Promise<void> {
    await memoryRepository.initialize();
    await Promise.allSettled([
      whisperService.initialize(),
      emotionService.initialize(),
      llmService.initialize(),
    ]);
    console.log('[AIOrchestrator] Services IA initialisés.');
  }

  /**
   * Analyse un message de manière asynchrone.
   * Retourne immédiatement — le résultat est disponible via le callback onProgress.
   *
   * @param message - Message à analyser
   * @param aiEnabled - Si false, l'analyse est ignorée
   */
  async analyzeMessageAsync(
    message: Message,
    aiEnabled: boolean
  ): Promise<AIAnalysisResult | null> {
    if (!aiEnabled) return null;
    if (this.processingQueue.has(message.id)) {
      return this.processingQueue.get(message.id)!;
    }

    const promise = this.runPipeline(message);
    this.processingQueue.set(message.id, promise);

    promise.finally(() => {
      this.processingQueue.delete(message.id);
    });

    return promise;
  }

  /**
   * Exécute le pipeline complet d'analyse.
   */
  private async runPipeline(message: Message): Promise<AIAnalysisResult | null> {
    try {
      let textToAnalyze = message.content;
      let transcription: string | undefined;
      let language: string | undefined;
      let audioDuration: number | undefined;

      // === Étape 1 : Transcription Whisper (messages vocaux uniquement) ===
      if (message.type === 'voice' && message.voiceLocalPath) {
        this.emit('whisper', message.id, 10);
        const whisperResult = await whisperService.transcribe(message.voiceLocalPath);
        if (whisperResult) {
          transcription = whisperResult.text;
          language = whisperResult.language;
          audioDuration = whisperResult.duration;
          textToAnalyze = whisperResult.text;
        }
      }

      if (!textToAnalyze.trim()) return null;

      // === Étape 2 : Analyse émotionnelle ===
      this.emit('emotion', message.id, 40);
      const emotionResult = await emotionService.analyze(textToAnalyze);

      // === Étape 3 : Extraction LLM ===
      this.emit('llm', message.id, 65);
      const llmResult = await llmService.extractFromText(textToAnalyze);

      // === Étape 4 : Sauvegarde en mémoire ===
      this.emit('memory', message.id, 85);
      if (message.conversationId && message.senderId) {
        await this.saveToMemory(message, llmResult, emotionResult);
      }

      const analysis: AIAnalysisResult = {
        emotions: emotionResult ?? {
          primary: 'neutral',
          primaryScore: 1.0,
          secondary: [],
          label: 'Neutre',
        },
        summary: llmResult.summary ?? undefined,
        topics: llmResult.topics,
        entities: llmResult.entities,
        transcription,
        language,
        audioDuration,
        processedAt: new Date(),
      };

      this.emit('complete', message.id, 100);
      return analysis;
    } catch (error) {
      console.error('[AIOrchestrator] Erreur pipeline :', error);
      this.emit('error', message.id, 0);
      return null;
    }
  }

  /**
   * Sauvegarde les extractions LLM dans la mémoire locale.
   */
  private async saveToMemory(
    message: Message,
    llmResult: any,
    emotionResult: any
  ): Promise<void> {
    const base = {
      conversationId: message.conversationId,
      partnerId: message.senderId,
      messageId: message.id,
      timestamp: message.createdAt,
      emotion: emotionResult?.primary,
      emotionScore: emotionResult?.primaryScore,
    };

    const saveEntities = async (
      items: Array<{ value: string; citation: string; confidence: number }>,
      category: MemoryCategory
    ) => {
      for (const item of items) {
        if (item.value && item.citation) {
          await memoryRepository.saveMemoryEntry({
            ...base,
            category,
            value: item.value,
            citation: item.citation,
            confidence: item.confidence,
          });
        }
      }
    };

    const entities = llmResult.entities;
    await Promise.allSettled([
      saveEntities(entities.persons, 'person'),
      saveEntities(entities.locations, 'location'),
      saveEntities(entities.events, 'event'),
      saveEntities(entities.dates, 'date'),
      saveEntities(entities.preferences, 'preference'),
      saveEntities(entities.concerns, 'concern'),
      saveEntities(entities.goals, 'goal'),
      saveEntities(entities.tasks, 'task'),
      saveEntities(entities.projects, 'project'),
      saveEntities(entities.important, 'important'),
    ]);

    // Sauvegarde de l'émotion principale
    if (emotionResult?.primary && emotionResult.primary !== 'neutral') {
      await memoryRepository.saveMemoryEntry({
        ...base,
        category: 'emotion',
        value: emotionResult.primary,
        citation: message.content.substring(0, 150),
        confidence: emotionResult.primaryScore ?? 0.5,
      });
    }
  }
}

export const aiOrchestrator = new AIOrchestrator();
