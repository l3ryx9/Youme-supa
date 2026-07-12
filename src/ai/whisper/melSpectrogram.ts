/**
 * Calcul du log-mel spectrogramme requis par Whisper (80 canaux mel).
 *
 * Paramètres fixes de Whisper (whisper-tiny) : 16 kHz, n_fft=400, hop=160,
 * fenêtre de Hann, 80 bandes mel, log naturel puis normalisation.
 * Référence : implémentation officielle openai/whisper `audio.py`.
 *
 * Implémentation pure JS (DFT directe, pas de FFT optimisée) — suffisante
 * pour des segments courts (messages vocaux de quelques secondes) mais plus
 * lente qu'une vraie FFT pour de longs enregistrements.
 */

const SAMPLE_RATE = 16000;
const N_FFT = 400;
const HOP_LENGTH = 160;
const N_MELS = 80;
const MAX_SAMPLES = SAMPLE_RATE * 30; // Whisper travaille sur des fenêtres de 30s (padding/troncature)

function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return w;
}

/** DFT réelle directe (retourne magnitude^2 pour les bins 0..N_FFT/2). */
function powerSpectrum(frame: Float32Array): Float32Array {
  const n = frame.length;
  const half = Math.floor(n / 2) + 1;
  const power = new Float32Array(half);
  for (let k = 0; k < half; k++) {
    let re = 0;
    let im = 0;
    const angleStep = (-2 * Math.PI * k) / n;
    for (let t = 0; t < n; t++) {
      const angle = angleStep * t;
      re += frame[t] * Math.cos(angle);
      im += frame[t] * Math.sin(angle);
    }
    power[k] = re * re + im * im;
  }
  return power;
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/** Construit la banque de filtres mel (N_MELS x (N_FFT/2 + 1)), triangulaire, normalisée "slaney". */
function buildMelFilterbank(): Float32Array[] {
  const numBins = Math.floor(N_FFT / 2) + 1;
  const fMin = 0;
  const fMax = SAMPLE_RATE / 2;
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);

  const melPoints = Array.from({ length: N_MELS + 2 }, (_, i) => melMin + ((melMax - melMin) * i) / (N_MELS + 1));
  const hzPoints = melPoints.map(melToHz);
  const binPoints = hzPoints.map((hz) => Math.floor(((N_FFT + 1) * hz) / SAMPLE_RATE));

  const filters: Float32Array[] = [];
  for (let m = 1; m <= N_MELS; m++) {
    const filter = new Float32Array(numBins);
    const left = binPoints[m - 1];
    const center = binPoints[m];
    const right = binPoints[m + 1];

    for (let k = left; k < center; k++) {
      if (k >= 0 && k < numBins && center !== left) filter[k] = (k - left) / (center - left);
    }
    for (let k = center; k < right; k++) {
      if (k >= 0 && k < numBins && right !== center) filter[k] = (right - k) / (right - center);
    }
    filters.push(filter);
  }
  return filters;
}

let cachedFilterbank: Float32Array[] | null = null;
function getFilterbank(): Float32Array[] {
  if (!cachedFilterbank) cachedFilterbank = buildMelFilterbank();
  return cachedFilterbank;
}

/**
 * @param samples Audio mono, Float32 dans [-1, 1], échantillonné à 16 kHz.
 * @returns log-mel spectrogramme aplati, shape logique [N_MELS, nFrames].
 */
export function computeLogMelSpectrogram(samples: Float32Array): { data: Float32Array; nFrames: number } {
  const padded =
    samples.length >= MAX_SAMPLES ? samples.subarray(0, MAX_SAMPLES) : padWithZeros(samples, MAX_SAMPLES);

  const window = hannWindow(N_FFT);
  const filterbank = getFilterbank();
  const nFrames = Math.floor((padded.length - N_FFT) / HOP_LENGTH) + 1;

  const melEnergies: Float32Array[] = [];
  for (let f = 0; f < nFrames; f++) {
    const start = f * HOP_LENGTH;
    const frame = new Float32Array(N_FFT);
    for (let i = 0; i < N_FFT; i++) {
      frame[i] = (padded[start + i] ?? 0) * window[i];
    }
    const power = powerSpectrum(frame);

    const melFrame = new Float32Array(N_MELS);
    for (let m = 0; m < N_MELS; m++) {
      let sum = 0;
      const filter = filterbank[m];
      for (let k = 0; k < filter.length; k++) {
        sum += filter[k] * power[k];
      }
      melFrame[m] = sum;
    }
    melEnergies.push(melFrame);
  }

  let maxLog = -Infinity;
  const logMel = melEnergies.map((frame) =>
    Float32Array.from(frame, (v) => {
      const log10v = Math.log10(Math.max(v, 1e-10));
      if (log10v > maxLog) maxLog = log10v;
      return log10v;
    })
  );

  const clipped = logMel.map((frame) =>
    Float32Array.from(frame, (v) => (Math.max(v, maxLog - 8) + 4) / 4)
  );

  const data = new Float32Array(N_MELS * nFrames);
  for (let m = 0; m < N_MELS; m++) {
    for (let f = 0; f < nFrames; f++) {
      data[m * nFrames + f] = clipped[f][m];
    }
  }

  return { data, nFrames };
}

function padWithZeros(samples: Float32Array, targetLength: number): Float32Array {
  const out = new Float32Array(targetLength);
  out.set(samples.subarray(0, Math.min(samples.length, targetLength)));
  return out;
}
