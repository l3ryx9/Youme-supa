/**
 * Service d'analyse de conversation — santé relationnelle
 *
 * Analyse un historique de messages entre deux partenaires et produit :
 *  - un score de santé relationnelle (score global + sous-scores)
 *  - des points d'attention (red flags) et points positifs (green flags)
 *  - un résumé et des conseils de résolution de conflit
 *
 * Réutilise le LLM local déjà embarqué dans l'app (Qwen2.5-0.5B-Instruct via
 * LLMService, voir @ai/llm/LLMService) — aucun nouveau modèle IA à
 * télécharger. Si le modèle n'est pas encore chargé (téléchargement en
 * cours, échoué, ou désactivé), un repli heuristique par expressions
 * régulières est utilisé à la place (résultat marqué isAI: false).
 */
import { llmService } from '@ai/llm/LLMService';

export interface AnalysisScore {
  global: number;
  respect: number;
  empathie: number;
  honnetete: number;
  limites: number;
  positivite: number;
}

export interface RedFlag {
  texte: string;
  severite: 'faible' | 'modere' | 'eleve';
  contexte: string;
}

export interface GreenFlag {
  texte: string;
  contexte: string;
}

export interface AnalysisResult {
  scores: AnalysisScore;
  redFlags: RedFlag[];
  greenFlags: GreenFlag[];
  resume: string;
  isAI: boolean;
}

export interface AnalysisMessage {
  content: string;
  senderId: string;
}

export interface LiveScore {
  value: number;
  trend: 'up' | 'down' | 'stable';
  label: string;
  color: string;
}

// ─── Patterns de détection rapide ────────────────────────────────────────────

const NEG_PATTERNS = [
  /tu es nul|c'est ta faute|idiot|stupide|ferme.la|shut up|hate|déteste/gi,
  /jamais|toujours tort|ta gueule|je m'en fous/gi,
  /\bcon\b|\bconne\b|imbécile|crétin|sale/gi,
  /tu comprends rien|t'es impossible|j'en ai marre de toi/gi,
];

const POS_PATTERNS = [
  /je t'aime|t'aime|je t'adore/gi,
  /merci|pardon|excuse[z-]?|désolé/gi,
  /je comprends|je suis là|câlin|bisous|❤|💕|😘|🥰/gi,
  /super|génial|formidable|tu es belle|tu es beau|fier de toi|je suis fier/gi,
  /on va y arriver|ensemble|on en parle|discutons/gi,
];

/**
 * Score temps réel léger (sans LLM) sur une fenêtre glissante de messages —
 * utilisable en continu pendant la conversation sans coût de calcul notable.
 */
export function computeLiveScore(messages: AnalysisMessage[], windowSize = 20): LiveScore {
  if (messages.length === 0) {
    return { value: 70, trend: 'stable', label: '💬 En attente', color: '#7fa18e' };
  }

  const recent = messages.slice(-windowSize);
  const text = recent.map((m) => m.content).join(' ');

  let neg = 0;
  let pos = 0;
  for (const p of NEG_PATTERNS) neg += (text.match(p) ?? []).length;
  for (const p of POS_PATTERNS) pos += (text.match(p) ?? []).length;

  const raw = Math.max(10, Math.min(100, 65 + pos * 4 - neg * 6));
  const value = Math.round(raw);

  const half = Math.floor(recent.length / 2);
  let trend: 'up' | 'down' | 'stable' = 'stable';
  if (half >= 2) {
    const firstHalf = recent.slice(0, half).map((m) => m.content).join(' ');
    const secondHalf = recent.slice(half).map((m) => m.content).join(' ');
    let n1 = 0, p1 = 0, n2 = 0, p2 = 0;
    for (const pat of NEG_PATTERNS) {
      n1 += (firstHalf.match(pat) ?? []).length;
      n2 += (secondHalf.match(pat) ?? []).length;
    }
    for (const pat of POS_PATTERNS) {
      p1 += (firstHalf.match(pat) ?? []).length;
      p2 += (secondHalf.match(pat) ?? []).length;
    }
    const score1 = p1 - n1;
    const score2 = p2 - n2;
    trend = score2 > score1 + 0.5 ? 'up' : score2 < score1 - 0.5 ? 'down' : 'stable';
  }

  let label: string;
  let color: string;
  if (value >= 80) {
    label = '💚 Très bien';
    color = '#5fe39a';
  } else if (value >= 65) {
    label = '💛 Bien';
    color = '#e8d479';
  } else if (value >= 45) {
    label = '🟠 Tensions';
    color = '#e8a479';
  } else {
    label = '🔴 Difficile';
    color = '#e8746f';
  }

  return { value, trend, label, color };
}

function regexFallback(messages: AnalysisMessage[]): AnalysisResult {
  const text = messages.map((m) => m.content).join(' ').toLowerCase();

  let negCount = 0;
  let posCount = 0;
  for (const p of NEG_PATTERNS) negCount += (text.match(p) || []).length;
  for (const p of POS_PATTERNS) posCount += (text.match(p) || []).length;

  const global = Math.max(20, Math.min(100, 65 + posCount * 3 - negCount * 5));

  const redFlags: RedFlag[] = [];
  if (text.includes('jamais') || text.includes('toujours'))
    redFlags.push({
      texte: 'Généralisation excessive',
      severite: 'modere',
      contexte: 'Utilisation de termes absolus',
    });
  if (negCount > 2)
    redFlags.push({
      texte: 'Ton négatif détecté',
      severite: negCount > 5 ? 'eleve' : 'modere',
      contexte: 'Plusieurs expressions négatives',
    });

  const greenFlags: GreenFlag[] = [];
  if (text.includes('merci') || text.includes('pardon') || text.includes('désolé'))
    greenFlags.push({ texte: 'Gratitude et excuses', contexte: 'Communication saine' });
  if (posCount > 2)
    greenFlags.push({ texte: 'Expressions positives', contexte: 'Bonne dynamique' });

  return {
    scores: {
      global,
      respect: Math.max(20, global - negCount * 2),
      empathie: Math.max(20, global + posCount - 5),
      honnetete: global,
      limites: Math.max(20, 70 - negCount * 3),
      positivite: Math.max(20, 50 + posCount * 5),
    },
    redFlags,
    greenFlags,
    resume: `Analyse basique (modèle IA non chargé). Score global : ${global}/100. ${negCount > 0 ? 'Des tensions ont été détectées.' : 'La communication semble saine.'}`,
    isAI: false,
  };
}

/**
 * Analyse complète de la conversation : scores, red/green flags, résumé.
 * Utilise le LLM local si disponible, sinon le repli par règles.
 */
export async function analyzeConversation(
  messages: AnalysisMessage[],
  myId: string
): Promise<AnalysisResult> {
  if (!llmService.isAvailable()) {
    return regexFallback(messages);
  }

  const transcript = messages
    .slice(-50)
    .map((m) => `${m.senderId === myId ? 'Moi' : 'Partenaire'}: ${m.content}`)
    .join('\n');

  const prompt = `Tu es un expert en psychologie relationnelle. Analyse cette conversation de couple et réponds UNIQUEMENT avec un JSON valide.

Conversation:
${transcript}

Réponds avec ce JSON exact:
{
  "scores": {"global":0,"respect":0,"empathie":0,"honnetete":0,"limites":0,"positivite":0},
  "redFlags": [{"texte":"","severite":"faible|modere|eleve","contexte":""}],
  "greenFlags": [{"texte":"","contexte":""}],
  "resume": ""
}

Les scores sont sur 100. Réponds en français. JSON uniquement.`;

  try {
    const raw = await llmService.generateRaw(prompt, 800);
    if (!raw) return regexFallback(messages);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return regexFallback(messages);
    const parsed = JSON.parse(jsonMatch[0]);
    return { ...parsed, isAI: true };
  } catch {
    return regexFallback(messages);
  }
}

/**
 * Génère des conseils de résolution de conflit à partir des derniers
 * messages échangés. Nécessite le LLM local — pas de repli par règles
 * pertinent pour ce cas (conseil libre, pas un score).
 */
export async function analyzeConflict(messages: AnalysisMessage[], myId: string): Promise<string> {
  if (!llmService.isAvailable()) {
    return "Le modèle IA local n'est pas encore prêt — les conseils personnalisés seront disponibles une fois son chargement terminé.";
  }

  const last30 = messages.slice(-30);
  const transcript = last30
    .map((m) => `${m.senderId === myId ? 'Moi' : 'Partenaire'}: ${m.content}`)
    .join('\n');

  const prompt = `Tu es un thérapeute de couple bienveillant. Analyse ces derniers messages et donne 3 conseils pratiques et personnalisés pour résoudre la tension. Réponds en français, de manière chaleureuse et constructive, en 200 mots max.

Messages:
${transcript}

Conseils:`;

  try {
    const raw = await llmService.generateRaw(prompt, 400);
    return raw?.trim() || 'Aucun conseil disponible pour le moment.';
  } catch {
    return 'Une erreur est survenue lors de la génération des conseils. Réessaie plus tard.';
  }
}
