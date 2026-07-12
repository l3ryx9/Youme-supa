/**
 * Module Gemini — Analyse Red Flags / Green Flags (Expérimental)
 *
 * Lit les messages d'une conversation et identifie :
 * - RED FLAGS   : signaux d'alerte (manque de respect, contrôle, manipulation,
 *                 dévalorisation, incohérences, pression, etc.)
 * - GREEN FLAGS : signaux positifs (respect, soutien, écoute, réciprocité,
 *                 communication saine, honnêteté, encouragement, etc.)
 *
 * PRINCIPES (identiques au module d'incohérences) :
 * - Probabiliste, JAMAIS accusatoire.
 * - Séparation stricte FAITS (citations exactes) vs INTERPRÉTATIONS (hypothèses).
 * - Chaque signal porte une citation vérifiable + un niveau de confiance.
 *
 * API gratuite : https://aistudio.google.com (clé dans EXPO_PUBLIC_GEMINI_API_KEY)
 */
import type { FlagAnalysisResult, RelationshipFlag, FlagSeverity } from '@domain/entities/Memory';
import type { Message } from '@domain/entities/Message';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Nombre max de messages envoyés à Gemini (les plus récents). */
const MAX_MESSAGES = 120;

export class GeminiFlagAnalysisModule {
  private apiKey: string | null;
  private model: string;

  constructor() {
    this.apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? null;
    this.model = process.env.EXPO_PUBLIC_GEMINI_MODEL ?? 'gemini-1.5-flash';
  }

  isAvailable(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0;
  }

  /**
   * Analyse les red/green flags d'une conversation.
   * @param messages     tous les messages de la conversation
   * @param currentUserId id de l'utilisateur courant (pour étiqueter "Vous")
   * @param partnerName  nom affiché du partenaire
   * @returns résultat structuré, ou null si Gemini indisponible / erreur API
   */
  async analyzeFlags(
    messages: Message[],
    currentUserId: string,
    partnerName: string
  ): Promise<FlagAnalysisResult | null> {
    if (!this.isAvailable()) {
      console.warn('[GeminiFlags] Clé API non configurée. Module désactivé.');
      return null;
    }

    const usable = messages
      .filter((m) => !m.isDeleted && this.extractText(m).trim().length > 0)
      .slice(-MAX_MESSAGES);

    if (usable.length < 4) {
      // Trop peu de matière pour une analyse pertinente.
      return null;
    }

    try {
      const prompt = this.buildPrompt(usable, currentUserId, partnerName);
      const response = await this.callGeminiAPI(prompt);
      return this.parseResponse(response, usable.length);
    } catch (error) {
      console.error('[GeminiFlags] Erreur API Gemini :', error);
      return null;
    }
  }

  private extractText(m: Message): string {
    if (m.type === 'voice') {
      return m.aiAnalysis?.transcription ?? '';
    }
    return m.content ?? '';
  }

  private async callGeminiAPI(prompt: string): Promise<any> {
    const url = `${GEMINI_API_URL}/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
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

  private buildPrompt(messages: Message[], currentUserId: string, partnerName: string): string {
    const transcript = messages
      .map((m) => {
        const who = m.senderId === currentUserId ? 'Vous' : partnerName;
        const date = m.createdAt.toLocaleDateString('fr-FR');
        return `[${date}] ${who}: ${this.extractText(m)}`;
      })
      .join('\n');

    return `Tu es un système d'analyse de la santé relationnelle d'une conversation. Analyse les messages ci-dessous pour identifier les RED FLAGS (signaux d'alerte) et les GREEN FLAGS (signaux positifs) de communication.

CONVERSATION (entre "Vous" et "${partnerName}") :
${transcript}

DÉFINITIONS :
- RED FLAG : manque de respect, dévalorisation, contrôle, jalousie excessive, manipulation, culpabilisation, pression, mensonge apparent, mépris, isolement, non-respect des limites.
- GREEN FLAG : respect, écoute, soutien, encouragement, honnêteté, excuses sincères, réciprocité, respect des limites, communication ouverte, gestion saine des désaccords.

INSTRUCTIONS STRICTES :
1. Sépare clairement FAITS OBSERVÉS (citations exactes tirées des messages) et INTERPRÉTATIONS (hypothèses).
2. N'accuse jamais : langage neutre et probabiliste. Un signal n'est pas une preuve.
3. Chaque flag DOIT contenir une citation exacte présente dans la conversation.
4. Indique un niveau de confiance (0 à 1) et une gravité/force ("faible", "modéré", "élevé").
5. Considère aussi les signaux émis par "Vous", pas seulement par le partenaire.
6. Si aucun signal clair, renvoie des listes vides plutôt que d'inventer.

Réponds UNIQUEMENT en JSON, sans texte autour, avec ce schéma exact :
{
  "redFlags": [{ "category": "", "severity": "faible|modéré|élevé", "citation": "", "sender": "Vous|${partnerName}", "explanation": "", "confidence": 0.0 }],
  "greenFlags": [{ "category": "", "severity": "faible|modéré|élevé", "citation": "", "sender": "Vous|${partnerName}", "explanation": "", "confidence": 0.0 }],
  "balanceScore": 0,
  "climateLabel": "sain|globalement sain|à surveiller|préoccupant",
  "summary": "",
  "facts": [""],
  "interpretations": [""]
}`;
  }

  private parseResponse(apiResponse: any, messageCount: number): FlagAnalysisResult {
    try {
      const text = apiResponse?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const jsonMatch =
        text.match(/```json\n?([\s\S]*?)\n?```/) ?? text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
        return {
          redFlags: this.normalizeFlags(parsed.redFlags, 'red'),
          greenFlags: this.normalizeFlags(parsed.greenFlags, 'green'),
          balanceScore: Math.min(100, Math.max(0, Number(parsed.balanceScore ?? 50))),
          climateLabel: parsed.climateLabel ?? 'à surveiller',
          summary: parsed.summary ?? '',
          facts: Array.isArray(parsed.facts) ? parsed.facts.filter(Boolean) : [],
          interpretations: Array.isArray(parsed.interpretations)
            ? parsed.interpretations.filter(Boolean)
            : [],
          messageCount,
          analyzedAt: new Date(),
        };
      }
    } catch (parseError) {
      console.error('[GeminiFlags] Erreur de parsing :', parseError);
    }

    return this.emptyResult(messageCount);
  }

  private normalizeFlags(raw: any, type: 'red' | 'green'): RelationshipFlag[] {
    if (!Array.isArray(raw)) return [];
    const allowed: FlagSeverity[] = ['faible', 'modéré', 'élevé'];
    return raw
      .filter((f) => f && typeof f.citation === 'string' && f.citation.trim().length > 0)
      .map((f): RelationshipFlag => ({
        type,
        category: String(f.category ?? 'Autre'),
        severity: allowed.includes(f.severity) ? f.severity : 'modéré',
        citation: String(f.citation).trim(),
        sender: f.sender ? String(f.sender) : undefined,
        explanation: String(f.explanation ?? ''),
        confidence: Math.min(1, Math.max(0, Number(f.confidence ?? 0.5))),
      }));
  }

  private emptyResult(messageCount: number): FlagAnalysisResult {
    return {
      redFlags: [],
      greenFlags: [],
      balanceScore: 50,
      climateLabel: 'à surveiller',
      summary: 'Analyse Gemini indisponible — aucun signal fiable extrait.',
      facts: [],
      interpretations: ['Analyse indisponible pour le moment.'],
      messageCount,
      analyzedAt: new Date(),
    };
  }
}

export const geminiFlagModule = new GeminiFlagAnalysisModule();
