/**
 * Service d'Analyse Quotidienne — Déclenché automatiquement à minuit
 *
 * Les autres IA locales (InconsistencyDetector, EmotionAnalysisService, LLMService)
 * ont déjà analysé chaque message au fil de la journée. Leurs résultats sont
 * stockés dans SQLite (mémoire locale).
 *
 * Le rôle de Gemini ici est de PERFECTIONNER ces analyses :
 *  - Valider ou corriger les incohérences/contradictions déjà détectées
 *  - Affiner la trajectoire émotionnelle issue du modèle CamemBERT local
 *  - Approfondir l'évaluation du risque de tromperie
 *  - Produire une synthèse globale que les modèles locaux ne peuvent pas faire
 *
 * Gemini ne repart pas de zéro — il reçoit en contexte :
 *  1. Les incohérences déjà détectées par InconsistencyDetector
 *  2. Les émotions déjà extraites par EmotionAnalysisService (via mémoire SQLite)
 *  3. La transcription des vocaux (via aiAnalysis.transcription)
 *  4. Les messages bruts de la journée
 *
 * Un seul appel API par conversation par nuit → économique sur le plan gratuit.
 */
import type { Message } from '@domain/entities/Message';
import type {
  DailyAnalysisReport,
  ContradictionDetail,
  EmotionalVariation,
  InconsistencyRecord,
  MemoryEntry,
} from '@domain/entities/Memory';
import {
  memoryRepository,
  toDateString,
} from '@infrastructure/storage/LocalMemoryRepository';
import { messageRepository } from '@infrastructure/supabase/MessageRepository';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_MESSAGES_PER_DAY = 200;

export class DailyAnalysisService {
  private readonly apiKey: string | null;
  private readonly model: string;

  constructor() {
    this.apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? null;
    this.model = process.env.EXPO_PUBLIC_GEMINI_MODEL ?? 'gemini-1.5-flash';
  }

  isAvailable(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0;
  }

  /**
   * Lance l'analyse de raffinement Gemini pour une journée.
   *
   * @param conversationId  ID de la conversation
   * @param partnerId       ID du partenaire
   * @param currentUserId   ID de l'utilisateur courant
   * @param partnerName     Nom affiché du partenaire
   * @param date            Jour à analyser (YYYY-MM-DD). Par défaut : hier.
   */
  async runDailyAnalysis(
    conversationId: string,
    partnerId: string,
    currentUserId: string,
    partnerName: string,
    date?: string
  ): Promise<DailyAnalysisReport | null> {
    if (!this.isAvailable()) {
      console.warn('[DailyAnalysis] Clé Gemini non configurée — raffinement ignoré.');
      return null;
    }

    const targetDate = date ?? toDateString(yesterday());

    // Ne pas refaire si déjà fait pour ce jour
    const existing = await memoryRepository.getDailyReport(conversationId, targetDate);
    if (existing) {
      console.log(`[DailyAnalysis] Rapport du ${targetDate} déjà existant — ignoré.`);
      return existing;
    }

    // ── 1. Charger les messages du jour ───────────────────────────────────────
    const allMessages = await messageRepository.getConversationMessages(conversationId, 500);
    const dayMessages = allMessages.filter(
      (m) => toDateString(m.createdAt) === targetDate && !m.isDeleted
    );

    if (dayMessages.length < 3) {
      console.log(`[DailyAnalysis] Trop peu de messages le ${targetDate} — ignoré.`);
      return null;
    }

    const usable = dayMessages.slice(-MAX_MESSAGES_PER_DAY);
    const voiceCount = usable.filter((m) => m.type === 'voice').length;

    // ── 2. Récupérer ce que les IA locales ont déjà trouvé ────────────────────
    const [localInconsistencies, emotionEntries] = await Promise.all([
      memoryRepository.getInconsistencies(conversationId),
      memoryRepository.getMemoryEntries(partnerId, 'emotion'),
    ]);

    // Filtrer sur la journée ciblée
    const dayInconsistencies = localInconsistencies.filter(
      (inc) => toDateString(inc.detectedAt) === targetDate
    );
    const dayEmotions = emotionEntries.filter(
      (e) => toDateString(e.timestamp) === targetDate
    );

    // ── 3. Appel Gemini avec tout le contexte ─────────────────────────────────
    try {
      const prompt = this.buildPrompt(
        usable,
        currentUserId,
        partnerName,
        dayInconsistencies,
        dayEmotions
      );

      const raw = await this.callGemini(prompt);
      const parsed = this.parseResponse(raw);

      const report: Omit<DailyAnalysisReport, 'id'> = {
        conversationId,
        partnerId,
        date: targetDate,
        contradictions: parsed.contradictions,
        coherenceScore: parsed.coherenceScore,
        emotionalJourney: parsed.emotionalJourney,
        dominantEmotion: parsed.dominantEmotion,
        emotionalSummary: parsed.emotionalSummary,
        deceptionRiskEstimate: parsed.deceptionRiskEstimate,
        deceptionRiskLabel: parsed.deceptionRiskLabel,
        deceptionIndicators: parsed.deceptionIndicators,
        summary: parsed.summary,
        facts: parsed.facts,
        interpretations: parsed.interpretations,
        messageCount: usable.length,
        voiceCount,
        analyzedAt: new Date(),
      };

      const saved = await memoryRepository.saveDailyReport(report);
      console.log(
        `[DailyAnalysis] Raffinement Gemini du ${targetDate} terminé ` +
        `(${usable.length} messages, ${dayInconsistencies.length} incohérences locales, ` +
        `${dayEmotions.length} émotions locales).`
      );
      return saved;
    } catch (error) {
      console.error('[DailyAnalysis] Erreur Gemini :', error);
      return null;
    }
  }

  // ─── Construction du prompt ─────────────────────────────────────────────────

  private buildPrompt(
    messages: Message[],
    currentUserId: string,
    partnerName: string,
    localInconsistencies: InconsistencyRecord[],
    localEmotions: MemoryEntry[]
  ): string {
    // Transcription de la conversation
    const transcript = messages
      .map((m) => {
        const who = m.senderId === currentUserId ? 'Vous' : partnerName;
        const time = m.createdAt.toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
        });
        const text =
          m.type === 'voice'
            ? `[VOCAL] ${m.aiAnalysis?.transcription ?? '(transcription indisponible)'}`
            : m.content;
        return `[${time}] ${who}: ${text}`;
      })
      .join('\n');

    // Ce que InconsistencyDetector a déjà trouvé
    const inconsistencyContext =
      localInconsistencies.length > 0
        ? localInconsistencies
            .map(
              (inc, i) =>
                `#${i + 1} (${inc.inconsistencyType}) — Cohérence locale : ${inc.coherenceScore}/100\n` +
                `  Déclaration 1 : "${inc.citation1}"\n` +
                `  Déclaration 2 : "${inc.citation2}"\n` +
                `  Explication locale : ${inc.explanation}`
            )
            .join('\n\n')
        : 'Aucune incohérence détectée par l\'analyse locale.';

    // Ce que EmotionAnalysisService (CamemBERT) a déjà trouvé
    const emotionContext =
      localEmotions.length > 0
        ? localEmotions
            .map((e) => {
              const time = e.timestamp.toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
              });
              return `[${time}] ${e.value} (confiance: ${Math.round(e.confidence * 100)}%) — "${e.citation.substring(0, 80)}"`;
            })
            .join('\n')
        : 'Aucune émotion marquante détectée par l\'analyse locale.';

    return `Tu es un système d'analyse psychologique relationnelle avancé. Des IA locales ont déjà analysé cette conversation. Ton rôle est de RAFFINER et APPROFONDIR leurs analyses — pas de tout refaire.

═══════════════════════════════════════
CONVERSATION DU JOUR (entre "Vous" et "${partnerName}") :
═══════════════════════════════════════
${transcript}

═══════════════════════════════════════
CE QUE L'IA LOCALE A DÉJÀ DÉTECTÉ :
═══════════════════════════════════════

── Incohérences / contradictions (InconsistencyDetector) ──
${inconsistencyContext}

── Émotions détectées (CamemBERT local) ──
${emotionContext}

═══════════════════════════════════════
TA MISSION — RAFFINER CES ANALYSES :
═══════════════════════════════════════

1. CONTRADICTIONS : Pour chaque incohérence locale ci-dessus :
   - Confirme-la, invalide-la, ou nuance-la en te basant sur le contexte complet.
   - Ajoute des incohérences que l'IA locale aurait manquées (plus subtiles, sémantiques, contextuelles).
   - Attribue un score de cohérence final raffiné (0-100).

2. TRAJECTOIRE ÉMOTIONNELLE : À partir des émotions détectées par CamemBERT :
   - Construis la trajectoire complète de la journée (évolution heure par heure).
   - Identifie les ruptures émotionnelles importantes que le modèle local a pu manquer.
   - Détermine l'émotion dominante réelle après lecture du contexte complet.

3. RISQUE DE TROMPERIE : En croisant les contradictions + les émotions + le texte brut :
   - Évalue la probabilité que certaines déclarations soient trompeuses.
   - Cite les indicateurs spécifiques (discordances émotion/contenu, changements de version, évitements).
   - Propose TOUJOURS au moins 3 hypothèses bénignes (oubli, stress, confusion, reformulation).
   - JAMAIS accusatoire — toujours probabiliste.

RÈGLES ABSOLUES :
- Sépare FAITS (citations exactes extraites des messages) et INTERPRÉTATIONS (hypothèses du modèle).
- Langage neutre : "pourrait indiquer", "semble suggérer", jamais "ment" ou "manipule".
- Si aucun risque ou contradiction réel → le dire clairement plutôt qu'inventer.
- Réponds UNIQUEMENT en JSON valide, sans texte autour.

JSON ATTENDU :
{
  "contradictions": [
    {
      "subject": "sujet",
      "version1": "première déclaration",
      "version2": "déclaration contradictoire",
      "citation1": "extrait exact",
      "citation2": "extrait exact",
      "explanation": "explication neutre",
      "locallyDetected": true/false,
      "geminiVerdict": "confirmée|invalidée|nuancée|nouvelle"
    }
  ],
  "coherenceScore": 0,
  "emotionalJourney": [
    {
      "timeLabel": "matin|après-midi|soir|soirée",
      "emotion": "joie|tristesse|colère|peur|neutre|surprise|amour|optimisme",
      "score": 0.0,
      "context": "contexte bref",
      "refinedFromLocal": true/false
    }
  ],
  "dominantEmotion": "émotion dominante",
  "emotionalSummary": "trajectoire en 2 phrases max",
  "deceptionRiskEstimate": 0.0,
  "deceptionRiskLabel": "faible|modéré|élevé",
  "deceptionIndicators": ["indicateur 1", "indicateur 2"],
  "benignHypotheses": ["hypothèse bénigne 1", "hypothèse bénigne 2", "hypothèse bénigne 3"],
  "summary": "synthèse globale de la journée (3 phrases max)",
  "facts": ["fait vérifiable 1", "fait vérifiable 2"],
  "interpretations": ["interprétation hypothétique 1"]
}`;
  }

  // ─── Appel API ───────────────────────────────────────────────────────────────

  private async callGemini(prompt: string): Promise<string> {
    const url = `${GEMINI_API_URL}/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 3000,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Gemini API ${response.status}: ${JSON.stringify(err)}`);
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  // ─── Parsing ─────────────────────────────────────────────────────────────────

  private parseResponse(raw: string): {
    contradictions: ContradictionDetail[];
    coherenceScore: number;
    emotionalJourney: EmotionalVariation[];
    dominantEmotion: string;
    emotionalSummary: string;
    deceptionRiskEstimate: number;
    deceptionRiskLabel: 'faible' | 'modéré' | 'élevé';
    deceptionIndicators: string[];
    summary: string;
    facts: string[];
    interpretations: string[];
  } {
    try {
      const jsonMatch =
        raw.match(/```json\n?([\s\S]*?)\n?```/) ?? raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return this.emptyResult();

      const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);

      const riskLabel = ['faible', 'modéré', 'élevé'].includes(parsed.deceptionRiskLabel)
        ? parsed.deceptionRiskLabel
        : 'faible';

      // Fusionner les hypothèses bénignes dans les interpretations
      const interpretations: string[] = [
        ...(Array.isArray(parsed.interpretations) ? parsed.interpretations : []),
        ...(Array.isArray(parsed.benignHypotheses)
          ? parsed.benignHypotheses.map((h: string) => `Hypothèse bénigne : ${h}`)
          : []),
      ].filter(Boolean);

      return {
        contradictions: Array.isArray(parsed.contradictions)
          ? parsed.contradictions.map((c: any) => ({
              subject: c.subject ?? '',
              version1: c.version1 ?? '',
              version2: c.version2 ?? '',
              citation1: c.citation1 ?? '',
              citation2: c.citation2 ?? '',
              explanation: c.explanation ?? '',
            }))
          : [],
        coherenceScore: clamp(Number(parsed.coherenceScore ?? 50), 0, 100),
        emotionalJourney: this.parseEmotionalJourney(parsed.emotionalJourney),
        dominantEmotion: parsed.dominantEmotion ?? 'neutre',
        emotionalSummary: parsed.emotionalSummary ?? '',
        deceptionRiskEstimate: clamp(Number(parsed.deceptionRiskEstimate ?? 0), 0, 1),
        deceptionRiskLabel: riskLabel,
        deceptionIndicators: Array.isArray(parsed.deceptionIndicators)
          ? parsed.deceptionIndicators.filter(Boolean)
          : [],
        summary: parsed.summary ?? '',
        facts: Array.isArray(parsed.facts) ? parsed.facts.filter(Boolean) : [],
        interpretations,
      };
    } catch (e) {
      console.error('[DailyAnalysis] Erreur parsing JSON Gemini :', e);
      return this.emptyResult();
    }
  }

  private parseEmotionalJourney(raw: any): EmotionalVariation[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e: any) => e && typeof e.emotion === 'string')
      .map((e: any): EmotionalVariation => ({
        date: new Date(),
        emotion: e.emotion ?? 'neutre',
        score: clamp(Number(e.score ?? 0.5), 0, 1),
        context: e.context ?? e.timeLabel ?? '',
      }));
  }

  private emptyResult() {
    return {
      contradictions: [] as ContradictionDetail[],
      coherenceScore: 50,
      emotionalJourney: [] as EmotionalVariation[],
      dominantEmotion: 'neutre',
      emotionalSummary: 'Raffinement Gemini indisponible.',
      deceptionRiskEstimate: 0,
      deceptionRiskLabel: 'faible' as const,
      deceptionIndicators: [] as string[],
      summary: 'Raffinement Gemini indisponible pour ce jour.',
      facts: [] as string[],
      interpretations: ['Aucune donnée de raffinement disponible.'],
    };
  }
}

export const dailyAnalysisService = new DailyAnalysisService();

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function yesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}
