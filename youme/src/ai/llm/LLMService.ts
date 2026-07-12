/**
 * Service LLM — Llama 3.2 3B Instruct (ONNX, local, on-device)
 *
 * Remplace Qwen2.5-1.5B-Instruct par Llama 3.2 3B Instruct quantifié q4
 * (~1.8 Go). Meilleur français, même principe de fonctionnement.
 *
 * Architecture Llama 3.2 3B :
 *   - num_hidden_layers : 28
 *   - num_key_value_heads : 8
 *   - head_dim : 128
 *
 * RÈGLE FONDAMENTALE : Le modèle ne doit JAMAIS inventer d'informations.
 * Chaque extraction doit être justifiée par une citation exacte du message.
 * Si aucune information ne peut être extraite avec certitude, retourner null.
 */
import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import type { ExtractedEntities, EntityWithCitation } from '@domain/entities/Message';
import { modelDownloadManager } from '@ai/models/ModelDownloadManager';
import { loadLocalTokenizer } from '@ai/models/tokenizerLoader';
import { sampleTopP } from '@ai/models/onnxUtils';

export interface LLMExtractionResult {
  summary: string | null;
  topics: string[];
  entities: ExtractedEntities;
  sentiment: string | null;
  confidence: number;
}

export interface LLMConfig {
  maxTokens: number;
  temperature: number;
  topP: number;
}

const DEFAULT_CONFIG: LLMConfig = {
  maxTokens: 256,
  temperature: 0.1,
  topP: 0.9,
};

// Architecture Llama 3.2 3B Instruct (config.json du modèle)
const NUM_LAYERS = 28;
const NUM_KV_HEADS = 8;
const HEAD_DIM = 128;

interface GenerationConfig {
  eos_token_id?: number | number[];
}

export class LLMService {
  private isModelLoaded = false;
  private config: LLMConfig = DEFAULT_CONFIG;
  private session: InferenceSession | null = null;
  private tokenizer: Awaited<ReturnType<typeof loadLocalTokenizer>> | null = null;
  private eosTokenIds: Set<number> = new Set();

  async initialize(): Promise<boolean> {
    try {
      const ready = await modelDownloadManager.isModelReady('llm');
      if (!ready) {
        console.warn('[LLMService] Modèle non téléchargé — fallback par règles actif.');
        return false;
      }

      const modelPath = modelDownloadManager.getFilePath('llm', 'model.onnx');
      const modelDir = modelPath.substring(0, modelPath.lastIndexOf('/'));

      this.tokenizer = await loadLocalTokenizer(modelDir);
      this.session = await InferenceSession.create(modelPath);

      const genConfigPath = modelDownloadManager.getFilePath('llm', 'generation_config.json');
      try {
        const FileSystem = await import('expo-file-system');
        const raw = await FileSystem.readAsStringAsync(genConfigPath);
        const genConfig: GenerationConfig = JSON.parse(raw);
        const eos = genConfig.eos_token_id;
        if (Array.isArray(eos)) eos.forEach((id) => this.eosTokenIds.add(id));
        else if (typeof eos === 'number') this.eosTokenIds.add(eos);
      } catch {
        // Pas bloquant
      }
      const tokenizerEos = (this.tokenizer as any)?.model?.eos_token_id;
      if (typeof tokenizerEos === 'number') this.eosTokenIds.add(tokenizerEos);

      this.isModelLoaded = true;
      console.log('[LLMService] Modèle Llama 3.2 3B Instruct chargé.');
      return true;
    } catch (error) {
      console.error("[LLMService] Erreur d'initialisation :", error);
      this.isModelLoaded = false;
      return false;
    }
  }

  async extractFromText(text: string): Promise<LLMExtractionResult> {
    if (!text.trim()) return this.emptyResult();

    if (!this.isModelLoaded || !this.session || !this.tokenizer) {
      return this.ruleBasedExtraction(text);
    }

    try {
      const prompt = this.buildExtractionPrompt(text);
      const raw = await this.generate(prompt, this.config.maxTokens);
      const parsed = this.parseStructuredResponse(raw, text);
      return parsed ?? this.ruleBasedExtraction(text);
    } catch (error) {
      console.error("[LLMService] Erreur d'extraction, fallback par règles :", error);
      return this.ruleBasedExtraction(text);
    }
  }

  async summarizeMessages(messages: string[]): Promise<string> {
    if (messages.length === 0) return '';

    if (!this.isModelLoaded || !this.session || !this.tokenizer) {
      return this.heuristicSummary(messages);
    }

    try {
      const combined = messages.join('\n---\n');
      const prompt = `Résume en 2-3 phrases les points essentiels de cette conversation, sans ajouter d'interprétations ni d'informations non présentes dans le texte :\n\n${combined}`;
      const summary = await this.generate(prompt, 128);
      return summary.trim() || this.heuristicSummary(messages);
    } catch (error) {
      console.error('[LLMService] Erreur de résumé, fallback heuristique :', error);
      return this.heuristicSummary(messages);
    }
  }

  private async generate(prompt: string, maxNewTokens: number): Promise<string> {
    const session = this.session!;
    const tokenizer = this.tokenizer!;

    const chatText =
      typeof (tokenizer as any).apply_chat_template === 'function'
        ? (tokenizer as any).apply_chat_template(
            [{ role: 'user', content: prompt }],
            { tokenize: false, add_generation_prompt: true }
          )
        : prompt;

    const encoded = tokenizer(chatText, { return_tensors: false }) as { input_ids: number[] };
    let inputIds: number[] = Array.from(encoded.input_ids);

    let pastKeyValues: Record<string, Tensor> = this.emptyPastKeyValues();
    const generatedIds: number[] = [];

    for (let step = 0; step < maxNewTokens; step++) {
      const isFirstStep = step === 0;
      const stepInputIds = isFirstStep ? inputIds : [inputIds[inputIds.length - 1]];
      const seqLen = stepInputIds.length;
      const pastLen = isFirstStep ? 0 : inputIds.length - 1;
      const attentionLength = pastLen + seqLen;

      const feeds: Record<string, Tensor> = {
        input_ids: new Tensor('int64', BigInt64Array.from(stepInputIds.map(BigInt)), [1, seqLen]),
        attention_mask: new Tensor(
          'int64',
          BigInt64Array.from(Array(attentionLength).fill(1n)),
          [1, attentionLength]
        ),
        position_ids: new Tensor(
          'int64',
          BigInt64Array.from(Array.from({ length: seqLen }, (_, i) => BigInt(pastLen + i))),
          [1, seqLen]
        ),
        ...pastKeyValues,
      };
      if (session.inputNames.includes('use_cache_branch')) {
        feeds.use_cache_branch = new Tensor('bool', [!isFirstStep], [1]);
      }

      const outputs = await session.run(feeds);
      const logitsTensor = outputs.logits;
      const vocabSize = logitsTensor.dims[logitsTensor.dims.length - 1];
      const lastLogits = (logitsTensor.data as Float32Array).slice(
        (seqLen - 1) * vocabSize,
        seqLen * vocabSize
      );

      const nextId = sampleTopP(lastLogits, this.config.temperature, this.config.topP);
      if (this.eosTokenIds.has(nextId)) break;

      generatedIds.push(nextId);
      inputIds.push(nextId);
      pastKeyValues = this.extractPresentAsPast(outputs, session.outputNames);
    }

    return (tokenizer as any).decode(generatedIds, { skip_special_tokens: true }) as string;
  }

  private emptyPastKeyValues(): Record<string, Tensor> {
    const feeds: Record<string, Tensor> = {};
    for (let i = 0; i < NUM_LAYERS; i++) {
      feeds[`past_key_values.${i}.key`] = new Tensor(
        'float32',
        new Float32Array(0),
        [1, NUM_KV_HEADS, 0, HEAD_DIM]
      );
      feeds[`past_key_values.${i}.value`] = new Tensor(
        'float32',
        new Float32Array(0),
        [1, NUM_KV_HEADS, 0, HEAD_DIM]
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

  private ruleBasedExtraction(text: string): LLMExtractionResult {
    const entities = this.emptyEntities();

    const datePatterns = [
      /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/gi,
      /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g,
      /\b(demain|aujourd'hui|hier|ce soir|ce matin|cette semaine)\b/gi,
    ];

    for (const pattern of datePatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        entities.dates.push({
          value: match[0],
          citation: this.extractSentence(text, match.index ?? 0),
          confidence: 0.8,
        });
      }
    }

    const taskPatterns = [
      /\b(je dois|il faut|n'oublie pas|rappelle-moi|pense à|prévu de|planifié)\s+(.+?)(?:[.!?]|$)/gi,
    ];
    for (const pattern of taskPatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        if (match[2]) {
          entities.tasks.push({
            value: match[2].trim(),
            citation: match[0].trim(),
            confidence: 0.75,
          });
        }
      }
    }

    const summary = text.length > 100 ? text.substring(0, 97) + '...' : null;
    return { summary, topics: [], entities, sentiment: null, confidence: 0.5 };
  }

  private parseStructuredResponse(raw: string, sourceText: string): LLMExtractionResult | null {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    let data: any;
    try {
      data = JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }

    const verify = (item: any): EntityWithCitation | null => {
      if (!item || typeof item.value !== 'string' || typeof item.citation !== 'string') return null;
      if (!sourceText.includes(item.citation.trim())) return null;
      return {
        value: item.value.trim(),
        citation: item.citation.trim(),
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.6,
      };
    };

    const verifyList = (list: any): EntityWithCitation[] =>
      Array.isArray(list) ? list.map(verify).filter((v): v is EntityWithCitation => v !== null) : [];

    const entities: ExtractedEntities = {
      persons: verifyList(data.persons),
      locations: verifyList(data.locations),
      events: verifyList(data.events),
      dates: verifyList(data.dates),
      topics: verifyList(data.topics),
      preferences: verifyList(data.preferences),
      concerns: verifyList(data.concerns),
      goals: verifyList(data.goals),
      tasks: verifyList(data.tasks),
      projects: verifyList(data.projects),
      important: verifyList(data.important),
    };

    const summary =
      typeof data.summary === 'string' && data.summary.trim() ? data.summary.trim() : null;

    return {
      summary,
      topics: Array.isArray(data.topics)
        ? data.topics.map((t: any) => (typeof t === 'string' ? t : t?.value)).filter(Boolean)
        : [],
      entities,
      sentiment: typeof data.sentiment === 'string' ? data.sentiment : null,
      confidence: 0.7,
    };
  }

  private heuristicSummary(messages: string[]): string {
    const total = messages.length;
    const first = messages[0]?.substring(0, 50) ?? '';
    return `Conversation de ${total} message${total > 1 ? 's' : ''}. Début : "${first}..."`;
  }

  private buildExtractionPrompt(text: string): string {
    return `Tu es un système d'extraction d'informations. Extrais UNIQUEMENT les informations présentes dans le texte suivant. Ne jamais inventer d'informations. Chaque extraction doit inclure la citation exacte du texte source.

Texte : "${text}"

Réponds en JSON avec les champs : summary, topics, persons, locations, events, dates, preferences, concerns, goals, tasks, projects.
Pour chaque item, inclure : value (information extraite) et citation (phrase exacte du texte).
Retourner null pour les champs sans information vérifiable.`;
  }

  private extractSentence(text: string, index: number): string {
    const start = Math.max(0, text.lastIndexOf('.', index) + 1);
    const end = text.indexOf('.', index);
    return text.substring(start, end === -1 ? text.length : end + 1).trim();
  }

  private emptyEntities(): ExtractedEntities {
    return {
      persons: [], locations: [], events: [], dates: [], topics: [],
      preferences: [], concerns: [], goals: [], tasks: [], projects: [], important: [],
    };
  }

  private emptyResult(): LLMExtractionResult {
    return { summary: null, topics: [], entities: this.emptyEntities(), sentiment: null, confidence: 0 };
  }

  async generateRaw(prompt: string, maxNewTokens = 512): Promise<string | null> {
    if (!this.isModelLoaded || !this.session || !this.tokenizer) return null;
    try {
      return await this.generate(prompt, maxNewTokens);
    } catch (error) {
      console.error('[LLMService] Erreur de génération libre :', error);
      return null;
    }
  }

  isAvailable(): boolean {
    return this.isModelLoaded;
  }
}

export const llmService = new LLMService();
