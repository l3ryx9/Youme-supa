/**
 * Utilitaires audio partagés — encodage Base64 et construction/lecture de
 * fichiers WAV PCM 16 bits mono 16 kHz.
 *
 * Base64 est ré-implémenté ici (pas de `atob`/`btoa` global fiable sur
 * Hermes/React Native) afin de pouvoir accumuler des chunks PCM bruts issus
 * de `react-native-live-audio-stream` sans dépendre du découpage par 3 octets
 * des chunks reçus (une simple concaténation de chaînes Base64 serait invalide).
 */

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const byteLength = Math.floor((clean.length * 6) / 8) - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0);
  const bytes = new Uint8Array(byteLength);

  let bitBuffer = 0;
  let bitCount = 0;
  let outIndex = 0;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '=') break;
    const value = BASE64_CHARS.indexOf(c);
    if (value === -1) continue;

    bitBuffer = (bitBuffer << 6) | value;
    bitCount += 6;

    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[outIndex++] = (bitBuffer >> bitCount) & 0xff;
    }
  }

  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    result += b1 === undefined ? '=' : BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    result += b2 === undefined ? '=' : BASE64_CHARS[b2 & 0x3f];
  }
  return result;
}

export interface PcmAccumulator {
  chunks: Uint8Array[];
  totalBytes: number;
}

export function createPcmAccumulator(): PcmAccumulator {
  return { chunks: [], totalBytes: 0 };
}

export function appendBase64Chunk(acc: PcmAccumulator, base64Chunk: string): void {
  const bytes = base64ToBytes(base64Chunk);
  acc.chunks.push(bytes);
  acc.totalBytes += bytes.length;
}

export function concatPcmBytes(acc: PcmAccumulator): Uint8Array {
  const out = new Uint8Array(acc.totalBytes);
  let offset = 0;
  for (const chunk of acc.chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Construit un fichier WAV complet (header 44 octets + données PCM16 mono). */
export function buildWavFile(pcmBytes: Uint8Array, sampleRate: number, numChannels = 1): Uint8Array {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBytes.length;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const wav = new Uint8Array(44 + dataSize);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcmBytes, 44);
  return wav;
}

function writeString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Lit un fichier WAV PCM16 (mono ou stéréo — converti en mono) et retourne
 * les échantillons normalisés en Float32 [-1, 1], prêts pour le calcul du
 * spectrogramme mel de Whisper.
 */
export function decodeWavPcm16(wavBytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);

  let dataOffset = 12;
  let dataSize = 0;
  while (dataOffset < wavBytes.length - 8) {
    const chunkId = String.fromCharCode(
      wavBytes[dataOffset],
      wavBytes[dataOffset + 1],
      wavBytes[dataOffset + 2],
      wavBytes[dataOffset + 3]
    );
    const chunkSize = view.getUint32(dataOffset + 4, true);
    if (chunkId === 'data') {
      dataOffset += 8;
      dataSize = chunkSize;
      break;
    }
    dataOffset += 8 + chunkSize;
  }

  const numSamples = Math.floor(dataSize / 2 / numChannels);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    let sum = 0;
    for (let c = 0; c < numChannels; c++) {
      const sampleOffset = dataOffset + (i * numChannels + c) * 2;
      sum += view.getInt16(sampleOffset, true);
    }
    samples[i] = sum / numChannels / 32768;
  }

  return { samples, sampleRate };
}
