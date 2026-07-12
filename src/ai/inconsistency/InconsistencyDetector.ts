/**
 * Détecteur d'Incohérences
 *
 * Analyse l'historique d'une conversation pour détecter :
 * - Contradictions directes
 * - Changements de version des déclarations
 * - Incohérences chronologiques
 * - Différences factuelles entre déclarations
 *
 * PRINCIPES ÉTHIQUES OBLIGATOIRES :
 * - Les résultats sont des INDICATEURS, jamais des certitudes.
 * - Toujours afficher : "Une incohérence potentielle a été détectée"
 * - Toujours recommander : "Une vérification manuelle est recommandée"
 * - Ne jamais formuler d'accusations — présenter des observations neutres.
 * - Le score de cohérence est probabiliste, pas définitif.
 */
import type { Message } from '@domain/entities/Message';
import type { InconsistencyRecord } from '@domain/entities/Memory';
import { v4 as uuidv4 } from 'uuid';

export interface InconsistencyDetectionConfig {
  coherenceThreshold: number;
  minMessagePairDistance: number;
}

const DEFAULT_CONFIG: InconsistencyDetectionConfig = {
  coherenceThreshold: 70,
  minMessagePairDistance: 2,
};

export class InconsistencyDetector {
  private config: InconsistencyDetectionConfig;

  constructor(config: Partial<InconsistencyDetectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyse une liste de messages pour détecter des incohérences potentielles.
   * Compare chaque message avec les messages précédents du même expéditeur.
   *
   * @param messages - Messages de la conversation, triés par date
   * @param partnerId - ID du partenaire analysé
   * @param conversationId - ID de la conversation
   */
  async detectInconsistencies(
    messages: Message[],
    partnerId: string,
    conversationId: string
  ): Promise<InconsistencyRecord[]> {
    const inconsistencies: InconsistencyRecord[] = [];
    const partnerMessages = messages.filter(
      (m) => m.senderId === partnerId && !m.isDeleted && m.content.trim().length > 10
    );

    for (let i = this.config.minMessagePairDistance; i < partnerMessages.length; i++) {
      const currentMsg = partnerMessages[i];

      for (let j = 0; j < i - this.config.minMessagePairDistance + 1; j++) {
        const previousMsg = partnerMessages[j];

        const result = await this.compareMessages(currentMsg, previousMsg);
        if (result) {
          inconsistencies.push({
            id: uuidv4(),
            conversationId,
            partnerId,
            statement1: previousMsg.content,
            statement2: currentMsg.content,
            citation1: result.citation1,
            citation2: result.citation2,
            messageId1: previousMsg.id,
            messageId2: currentMsg.id,
            date1: previousMsg.createdAt,
            date2: currentMsg.createdAt,
            inconsistencyType: result.type,
            explanation: result.explanation,
            coherenceScore: result.coherenceScore,
            isReviewed: false,
            detectedAt: new Date(),
          });
        }
      }
    }

    return inconsistencies;
  }

  /**
   * Compare deux messages pour détecter une incohérence potentielle.
   * Retourne null si aucune incohérence n'est détectée.
   */
  private async compareMessages(
    msg1: Message,
    msg2: Message
  ): Promise<{
    type: InconsistencyRecord['inconsistencyType'];
    citation1: string;
    citation2: string;
    explanation: string;
    coherenceScore: number;
  } | null> {
    const text1 = msg1.content.toLowerCase();
    const text2 = msg2.content.toLowerCase();

    // Détection de contradictions directes (négation)
    const negationResult = this.detectNegation(msg1.content, msg2.content);
    if (negationResult) return negationResult;

    // Détection d'incohérences chronologiques
    const chronoResult = this.detectChronologicalInconsistency(msg1, msg2);
    if (chronoResult) return chronoResult;

    // Détection de changements de version
    const versionResult = this.detectVersionChange(msg1.content, msg2.content);
    if (versionResult) return versionResult;

    return null;
  }

  /**
   * Détecte les contradictions directes via des patterns de négation.
   */
  private detectNegation(text1: string, text2: string): {
    type: InconsistencyRecord['inconsistencyType'];
    citation1: string;
    citation2: string;
    explanation: string;
    coherenceScore: number;
  } | null {
    const negationPairs = [
      { positive: /\bje suis\b/i, negative: /\bje ne suis pas\b/i },
      { positive: /\bj'ai\b/i, negative: /\bje n'ai pas\b/i },
      { positive: /\bje peux\b/i, negative: /\bje ne peux pas\b/i },
      { positive: /\bje veux\b/i, negative: /\bje ne veux pas\b/i },
      { positive: /\bje travaille\b/i, negative: /\bje ne travaille pas\b/i },
      { positive: /\bj'aime\b/i, negative: /\bje n'aime pas\b/i },
      { positive: /\bje connais\b/i, negative: /\bje ne connais pas\b/i },
      { positive: /\btoujours\b/i, negative: /\bjamais\b/i },
    ];

    for (const { positive, negative } of negationPairs) {
      const t1HasPositive = positive.test(text1);
      const t1HasNegative = negative.test(text1);
      const t2HasPositive = positive.test(text2);
      const t2HasNegative = negative.test(text2);

      if ((t1HasPositive && t2HasNegative) || (t1HasNegative && t2HasPositive)) {
        return {
          type: 'contradiction',
          citation1: this.extractRelevantSentence(text1, positive),
          citation2: this.extractRelevantSentence(text2, negative),
          explanation:
            'Une incohérence potentielle a été détectée : les déclarations semblent se contredire. ' +
            'Une vérification manuelle est recommandée.',
          coherenceScore: 35,
        };
      }
    }
    return null;
  }

  /**
   * Détecte les incohérences chronologiques (dates, moments).
   */
  private detectChronologicalInconsistency(
    msg1: Message,
    msg2: Message
  ): {
    type: InconsistencyRecord['inconsistencyType'];
    citation1: string;
    citation2: string;
    explanation: string;
    coherenceScore: number;
  } | null {
    const t1 = msg1.content.toLowerCase();
    const t2 = msg2.content.toLowerCase();

    const timeWords1 = this.extractTimeReferences(t1);
    const timeWords2 = this.extractTimeReferences(t2);

    if (timeWords1.length === 0 || timeWords2.length === 0) return null;

    // Détection de conflits passé/futur sur le même sujet
    const hasPast1 = /hier|la semaine dernière|l'année dernière|avant|autrefois/.test(t1);
    const hasFuture2 = /demain|la semaine prochaine|l'année prochaine|bientôt|prochainement/.test(t2);
    const hasFuture1 = /demain|la semaine prochaine|l'année prochaine|bientôt|prochainement/.test(t1);
    const hasPast2 = /hier|la semaine dernière|l'année dernière|avant|autrefois/.test(t2);

    if ((hasPast1 && hasFuture2) || (hasFuture1 && hasPast2)) {
      return {
        type: 'chronological',
        citation1: t1.substring(0, 100),
        citation2: t2.substring(0, 100),
        explanation:
          'Une incohérence potentielle a été détectée : les références temporelles semblent contradictoires. ' +
          'Une vérification manuelle est recommandée.',
        coherenceScore: 50,
      };
    }

    return null;
  }

  /**
   * Détecte les changements de version sur un même sujet.
   */
  private detectVersionChange(text1: string, text2: string): {
    type: InconsistencyRecord['inconsistencyType'];
    citation1: string;
    citation2: string;
    explanation: string;
    coherenceScore: number;
  } | null {
    const versionIndicators = [
      /en fait|en réalité|à vrai dire|je me suis trompé|correction|j'avais dit que/i,
    ];

    for (const pattern of versionIndicators) {
      if (pattern.test(text2)) {
        return {
          type: 'version_change',
          citation1: text1.substring(0, 100),
          citation2: text2.substring(0, 100),
          explanation:
            'Une incohérence potentielle a été détectée : un changement de version d\'une déclaration précédente est possible. ' +
            'Une vérification manuelle est recommandée.',
          coherenceScore: 60,
        };
      }
    }
    return null;
  }

  private extractTimeReferences(text: string): string[] {
    const patterns = [
      /hier|aujourd'hui|demain|ce matin|ce soir/gi,
      /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/gi,
      /\d{1,2}[\/\-]\d{1,2}/g,
    ];
    const results: string[] = [];
    for (const p of patterns) {
      results.push(...(text.match(p) ?? []));
    }
    return results;
  }

  private extractRelevantSentence(text: string, pattern: RegExp): string {
    const match = text.match(pattern);
    if (!match) return text.substring(0, 100);
    const idx = text.search(pattern);
    const start = Math.max(0, text.lastIndexOf('.', idx) + 1);
    const end = text.indexOf('.', idx);
    return text.substring(start, end === -1 ? Math.min(text.length, idx + 80) : end + 1).trim();
  }
}

export const inconsistencyDetector = new InconsistencyDetector();
