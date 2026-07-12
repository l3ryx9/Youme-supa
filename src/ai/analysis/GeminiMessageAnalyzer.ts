/**
 * Module Gemini — Analyse par message pour le compteur de green flags
 *
 * Appelé pour CHAQUE message (texte ou vocal transcrit) entrant dans
 * le pipeline IA. Détecte si le message contient un green flag relationnel
 * et incrémente le compteur journalier dans SQLite.
 *
 * Limite de débit : 1 appel toutes les 3 secondes max (plan gratuit Gemini
 * = 15 req/min). Les messages trop courts ou trop proches du précédent
 * sont ignorés silencieusement.
 *
 * API : https://aistudio.google.com (EXPO_PUBLIC_GEMINI_API_KEY)
 */
import type { Message } from '@domain/entities/Message';
import type { MessageGreenFlag } from '@domain/entities/Memory';
import { memoryRepository } from '@infrastructure/storage/LocalMemoryRepository';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Longueur minimale du texte pour déclencher l'analyse (évite les "ok", "👍"…) */
const MIN_TEXT_LENGTH = 15;

/** Délai minimum entre deux appels Gemini (ms) — respecte la limite 15 req/min */
const MIN_CALL_INTERVAL_MS = 4_000;

export class GeminiMessageAnalyzer {
  private readonly apiKey: string | null;
  private readonly model: string;
  private lastCallAt = 0;

  constructor() {
    this.apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? null;
    this.model = process.env.EXPO_PUBLIC_GEMINI_MODEL ?? 'gemini-1.5-flash';
  }

  isAvailable(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0;
  }

  /**
   * Analyse un message pour détecter un green flag.
   * Si un green flag est détecté, l'ajoute au compteur journalier SQLite.
   *
   * @param message   Message à analyser
   * @param partnerId ID du partenaire dans la conversation
   * @returns         Le green flag détecté, ou null si aucun / Gemini indisponible
   */
  async analyzeForGreenFlag(
    message: Message,
    partnerId: string
  ): Promise<MessageGreenFlag | null> {
    if (!this.isAvailable()) return null;

    // Extraire le texte analysable (texte brut ou transcription vocale)
    const text = this.extractText(message);
    if (!text || text.length < MIN_TEXT_LENGTH) return null;

    // Respecter le débit Gemini
    const now = Date.now();
    if (now - this.lastCallAt < MIN_CALL_INTERVAL_MS) return null;
    this.lastCallAt = now;

    try {
      const result = await this.callGemini(text);
      if (!result || !result.hasGreenFlag) return null;

      const flag: MessageGreenFlag = {
        category: result.category ?? 'Communication saine',
        citation: result.citation ?? text.substring(0, 100),
        messageId: message.id,
        confidence: Math.min(1, Math.max(0, result.confidence ?? 0.7)),
      };

      // Enregistrer dans SQLite
      await memoryRepository.addDailyGreenFlag(message.conversationId, partnerId, flag);

      return flag;
    } catch (error) {
      console.warn('[GeminiMessageAnalyzer] Erreur analyse green flag :', error);
      return null;
    }
  }

  private extractText(message: Message): string {
    if (message.type === 'voice') {
      return message.aiAnalysis?.transcription ?? '';
    }
    if (message.type === 'text') {
      return message.content ?? '';
    }
    return '';
  }

  private async callGemini(text: string): Promise<{
    hasGreenFlag: boolean;
    category: string;
    citation: string;
    explanation: string;
    confidence: number;
  } | null> {
    const url = `${GEMINI_API_URL}/${this.model}:generateContent?key=${this.apiKey}`;

    const prompt = `Tu es un système d'analyse de la santé relationnelle. Analyse ce message et détecte s'il contient un GREEN FLAG relationnel.

Un GREEN FLAG est un signal POSITIF : respect mutuel, soutien émotionnel, encouragements sincères, excuses honnêtes, écoute active, réciprocité, communication ouverte, honnêteté, gestion saine des conflits, respect des limites.

Message à analyser : "${text}"

INSTRUCTIONS :
- Ne détecte un green flag que si le signal est clairement présent, pas implicite.
- Cite l'extrait EXACT du message qui constitue le signal.
- Si aucun green flag clair → hasGreenFlag: false.
- Réponds UNIQUEMENT en JSON, sans texte autour.

JSON attendu :
{
  "hasGreenFlag": true/false,
  "category": "Soutien|Respect|Communication ouverte|Honnêteté|Encouragement|Excuses sincères|Écoute|Réciprocité|Autre",
  "citation": "extrait exact du message",
  "explanation": "pourquoi c'est un green flag (1 phrase)",
  "confidence": 0.0
}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          topK: 20,
          topP: 0.9,
          maxOutputTokens: 256,
        },
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    const jsonMatch = raw.match(/```json\n?([\s\S]*?)\n?```/) ?? raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      return JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
    } catch {
      return null;
    }
  }
}

export const geminiMessageAnalyzer = new GeminiMessageAnalyzer();
