/**
 * Module Gemini — Analyse Avancée des Incohérences (Expérimental)
 *
 * Déclenché UNIQUEMENT quand plusieurs incohérences sont détectées
 * sur un même sujet dans une conversation.
 *
 * Utilise l'API Gemini (gratuite jusqu'à 15 req/min) pour produire
 * une analyse approfondie incluant :
 * - Chronologie complète des déclarations
 * - Analyse des contradictions
 * - Variations émotionnelles
 * - Hypothèses explicatives (oubli, confusion, stress, évolution, etc.)
 * - Score global de cohérence
 * - Estimation probabiliste du risque (JAMAIS une certitude)
 *
 * SÉPARATION CLAIRE : faits observés vs interprétations du modèle.
 * L'interface utilisateur doit toujours distinguer ces deux catégories.
 *
 * API Gratuite : https://aistudio.google.com (clé API requise dans .env)
 */
import type { InconsistencyRecord, GeminiAnalysisResult, TimelineEntry, ContradictionDetail } from '@domain/entities/Memory';
import type { Message } from '@domain/entities/Message';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiInconsistencyModule {
  private apiKey: string | null;
  private model: string;
  private triggerCount: number;

  constructor() {
    this.apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? null;
    this.model = process.env.EXPO_PUBLIC_GEMINI_MODEL ?? 'gemini-1.5-flash';
    this.triggerCount = Number(process.env.EXPO_PUBLIC_GEMINI_TRIGGER_COUNT ?? '3');
  }

  /**
   * Retourne true si le module Gemini est configuré et disponible.
   */
  isAvailable(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0;
  }

  /**
   * Vérifie si le nombre d'incohérences dépasse le seuil de déclenchement.
   */
  shouldTrigger(inconsistencies: InconsistencyRecord[]): boolean {
    return this.isAvailable() && inconsistencies.length >= this.triggerCount;
  }

  /**
   * Lance l'analyse avancée Gemini sur un ensemble d'incohérences.
   * Retourne null si Gemini n'est pas disponible ou si l'API échoue.
   *
   * IMPORTANT : Les résultats incluent TOUJOURS :
   * - facts : observations vérifiables (citations, dates, contradictions)
   * - interpretations : hypothèses du modèle (à prendre avec précaution)
   */
  async analyzeInconsistencies(
    inconsistencies: InconsistencyRecord[],
    allMessages: Message[],
    partnerName: string
  ): Promise<GeminiAnalysisResult | null> {
    if (!this.isAvailable()) {
      console.warn('[GeminiModule] API key non configurée. Module expérimental désactivé.');
      return null;
    }

    if (!this.shouldTrigger(inconsistencies)) {
      return null;
    }

    try {
      const prompt = this.buildAnalysisPrompt(inconsistencies, allMessages, partnerName);
      const response = await this.callGeminiAPI(prompt);
      return this.parseGeminiResponse(response, inconsistencies, allMessages);
    } catch (error) {
      console.error('[GeminiModule] Erreur API Gemini :', error);
      return null;
    }
  }

  private async callGeminiAPI(prompt: string): Promise<any> {
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
          maxOutputTokens: 2048,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`API Gemini error ${response.status}: ${JSON.stringify(error)}`);
    }

    return response.json();
  }

  private buildAnalysisPrompt(
    inconsistencies: InconsistencyRecord[],
    messages: Message[],
    partnerName: string
  ): string {
    const inconsistencySummary = inconsistencies
      .map((inc, i) =>
        `Incohérence #${i + 1} (${inc.inconsistencyType}) :
  Déclaration 1 (${inc.date1.toLocaleDateString('fr-FR')}) : "${inc.citation1}"
  Déclaration 2 (${inc.date2.toLocaleDateString('fr-FR')}) : "${inc.citation2}"
  Explication : ${inc.explanation}`
      )
      .join('\n\n');

    return `Tu es un système d'analyse de cohérence conversationnelle. Analyse les incohérences suivantes détectées dans une conversation avec ${partnerName}.

INCOHÉRENCES DÉTECTÉES :
${inconsistencySummary}

INSTRUCTIONS STRICTES :
1. Sépare clairement FAITS OBSERVÉS (citations directes, dates, contradictions vérifiables) et INTERPRÉTATIONS (hypothèses, suppositions).
2. Ne jamais formuler d'accusations — utiliser un langage neutre et probabiliste.
3. Pour chaque interprétation, indiquer le niveau de certitude (faible/modéré/élevé).
4. Les hypothèses explicatives doivent inclure des causes bénignes (oubli, confusion, évolution d'opinion).
5. L'estimation du risque de déclaration trompeuse est probabiliste et ne constitue PAS une preuve.

Réponds en JSON structuré avec :
- timeline : chronologie des déclarations (date, statement, citation)
- contradictions : liste des contradictions détectées (subject, version1, version2, citation1, citation2, explanation)
- emotionalVariations : variations émotionnelles si détectables
- hypotheses : liste des hypothèses explicatives (minimum 3 hypothèses bénignes)
- overallCoherenceScore : score de 0 à 100 (100 = parfaitement cohérent)
- deceptionRiskEstimate : probabilité de 0 à 1 (probabiliste, non définitif)
- deceptionRiskLabel : "faible", "modéré", ou "élevé"
- facts : liste des faits observés (citations exactes, contradictions vérifiables)
- interpretations : liste des interprétations du modèle (hypothèses)`;
  }

  private parseGeminiResponse(
    apiResponse: any,
    inconsistencies: InconsistencyRecord[],
    messages: Message[]
  ): GeminiAnalysisResult {
    try {
      const text =
        apiResponse?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ??
                        text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
        return {
          timeline: (parsed.timeline ?? []).map((t: any): TimelineEntry => ({
            date: new Date(t.date ?? Date.now()),
            statement: t.statement ?? '',
            citation: t.citation ?? '',
            emotion: t.emotion,
          })),
          contradictions: parsed.contradictions ?? [],
          emotionalVariations: parsed.emotionalVariations ?? [],
          hypotheses: parsed.hypotheses ?? [
            'Oubli naturel d\'une déclaration précédente',
            'Évolution normale de l\'opinion ou de la situation',
            'Confusion entre deux événements ou contextes différents',
            'Expression imprécise ou reformulation maladroite',
          ],
          overallCoherenceScore: Math.min(100, Math.max(0, parsed.overallCoherenceScore ?? 50)),
          deceptionRiskEstimate: Math.min(1, Math.max(0, parsed.deceptionRiskEstimate ?? 0.3)),
          deceptionRiskLabel: parsed.deceptionRiskLabel ?? 'modéré',
          facts: parsed.facts ?? inconsistencies.map((i) => i.citation1),
          interpretations: parsed.interpretations ?? [],
          analyzedAt: new Date(),
        };
      }
    } catch (parseError) {
      console.error('[GeminiModule] Erreur de parsing de la réponse :', parseError);
    }

    return this.fallbackResult(inconsistencies);
  }

  private fallbackResult(inconsistencies: InconsistencyRecord[]): GeminiAnalysisResult {
    return {
      timeline: inconsistencies.map((inc): TimelineEntry => ({
        date: inc.date1,
        statement: inc.statement1,
        citation: inc.citation1,
      })),
      contradictions: inconsistencies.map((inc): ContradictionDetail => ({
        subject: inc.inconsistencyType,
        version1: inc.statement1,
        version2: inc.statement2,
        citation1: inc.citation1,
        citation2: inc.citation2,
        explanation: inc.explanation,
      })),
      emotionalVariations: [],
      hypotheses: [
        'Oubli naturel d\'une déclaration précédente',
        'Évolution normale de l\'opinion ou de la situation',
        'Confusion entre deux événements ou contextes différents',
        'Expression imprécise ou reformulation maladroite',
        'Changement de circonstances entre les deux déclarations',
      ],
      overallCoherenceScore: Math.round(
        inconsistencies.reduce((sum, i) => sum + i.coherenceScore, 0) / inconsistencies.length
      ),
      deceptionRiskEstimate: 0.3,
      deceptionRiskLabel: 'faible',
      facts: inconsistencies.map((i) => `Citation 1: "${i.citation1}" — Citation 2: "${i.citation2}"`),
      interpretations: ['Analyse Gemini indisponible — résultats basiques affichés'],
      analyzedAt: new Date(),
    };
  }
}

export const geminiModule = new GeminiInconsistencyModule();
