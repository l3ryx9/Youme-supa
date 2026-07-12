/**
 * Utilitaires numériques partagés pour l'inférence ONNX locale.
 */

export function softmax(logits: Float32Array | number[]): Float32Array {
  const arr = Array.from(logits);
  const max = Math.max(...arr);
  const exps = arr.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return Float32Array.from(exps.map((v) => v / (sum || 1)));
}

export function argmax(values: Float32Array | number[]): number {
  let bestIndex = 0;
  let bestValue = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > bestValue) {
      bestValue = values[i];
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Échantillonnage top-p (nucleus sampling) avec température.
 * Utilisé pour la génération de texte du LLM afin d'éviter les répétitions
 * tout en restant déterministe-ish à basse température.
 */
export function sampleTopP(
  logits: Float32Array | number[],
  temperature: number,
  topP: number
): number {
  if (temperature <= 0) return argmax(logits);

  const scaled = Array.from(logits).map((v) => v / temperature);
  const probs = Array.from(softmax(scaled));

  const indexed = probs
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p - a.p);

  let cumulative = 0;
  const kept: { p: number; i: number }[] = [];
  for (const item of indexed) {
    if (cumulative >= topP && kept.length > 0) break;
    kept.push(item);
    cumulative += item.p;
  }

  const total = kept.reduce((s, k) => s + k.p, 0) || 1;
  let r = Math.random() * total;
  for (const item of kept) {
    r -= item.p;
    if (r <= 0) return item.i;
  }
  return kept[0]?.i ?? argmax(logits);
}
