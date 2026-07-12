/**
 * onnxUtils — Utilitaires mathématiques pour l'inférence ONNX
 *
 * Fonctions pures utilisées par LLMService, EmotionAnalysisService
 * et WhisperService pour post-traiter les sorties des modèles ONNX.
 */

// ─── Softmax ──────────────────────────────────────────────────────────────────

/**
 * Applique la fonction softmax à un tableau de logits.
 * Retourne un tableau de probabilités qui somment à 1.
 *
 * Utilise la soustraction du maximum pour la stabilité numérique.
 */
export function softmax(logits: number[] | Float32Array): Float32Array {
  const arr = logits instanceof Float32Array ? logits : new Float32Array(logits);
  const max = Math.max(...arr);
  const exps = arr.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

// ─── Argmax ───────────────────────────────────────────────────────────────────

/**
 * Retourne l'indice de la valeur maximale dans un tableau.
 * Utilisé pour décoder le token le plus probable dans Whisper.
 */
export function argmax(arr: number[] | Float32Array | BigInt64Array): number {
  let maxIdx = 0;
  let maxVal = -Infinity;

  for (let i = 0; i < arr.length; i++) {
    const val = Number(arr[i]);
    if (val > maxVal) {
      maxVal = val;
      maxIdx = i;
    }
  }

  return maxIdx;
}

// ─── Top-P sampling ───────────────────────────────────────────────────────────

/**
 * Échantillonnage Top-P (nucleus sampling) pour la génération de texte.
 *
 * Sélectionne un token aléatoirement parmi les tokens dont la probabilité
 * cumulée atteint `p`. Permet d'équilibrer diversité et cohérence.
 *
 * @param logits  - Logits bruts du modèle (non normalisés)
 * @param p       - Seuil de probabilité cumulée (ex: 0.9)
 * @param temperature - Température pour adoucir/durcir la distribution
 * @returns       Indice du token sélectionné
 */
export function sampleTopP(
  logits: number[] | Float32Array,
  p = 0.9,
  temperature = 1.0,
): number {
  const arr = logits instanceof Float32Array ? Array.from(logits) : [...logits];

  // Appliquer la température
  const scaled = temperature !== 1.0
    ? arr.map((x) => x / temperature)
    : arr;

  // Calculer les probabilités
  const probs = softmax(scaled);

  // Créer les paires (index, probabilité) et trier par probabilité décroissante
  const indexed = Array.from(probs)
    .map((prob, idx) => ({ idx, prob }))
    .sort((a, b) => b.prob - a.prob);

  // Sélectionner les tokens dont la somme cumulée atteint p
  let cumsum = 0;
  const nucleus: Array<{ idx: number; prob: number }> = [];

  for (const item of indexed) {
    nucleus.push(item);
    cumsum += item.prob;
    if (cumsum >= p) break;
  }

  // Renormaliser les probabilités du nucleus
  const nucleusSum = nucleus.reduce((acc, item) => acc + item.prob, 0);
  const normalized = nucleus.map((item) => ({
    idx: item.idx,
    prob: item.prob / nucleusSum,
  }));

  // Tirage aléatoire pondéré
  const rand = Math.random();
  let running = 0;

  for (const { idx, prob } of normalized) {
    running += prob;
    if (rand <= running) return idx;
  }

  // Fallback : retourner le token le plus probable
  return normalized[0].idx;
}

// ─── Utilitaires tenseurs ─────────────────────────────────────────────────────

/**
 * Convertit un tableau de BigInt64 en tableau de nombres.
 * Nécessaire car ONNX Runtime retourne les token IDs en BigInt64.
 */
export function bigInt64ToNumbers(arr: BigInt64Array): number[] {
  return Array.from(arr).map((v) => Number(v));
}

/**
 * Crée un BigInt64Array à partir d'un tableau de nombres.
 * Utilisé pour préparer les input_ids pour l'inférence ONNX.
 */
export function numbersToBigInt64(arr: number[]): BigInt64Array {
  return BigInt64Array.from(arr.map((v) => BigInt(v)));
}
