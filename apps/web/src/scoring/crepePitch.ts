/**
 * CREPE pitch detector in the browser (ml5/marl port).
 * Live guide + scoring use this when the model loads; pitchy is the fallback.
 */
import * as tf from "@tensorflow/tfjs";

const MODEL_URL =
  "https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models/models/pitch-detection/crepe/model.json";

const CENTS = (() => {
  const t = new Float32Array(360);
  for (let i = 0; i < 360; i++) t[i] = (i / 359) * 7180 + 1997.3794084376191;
  return t;
})();

let modelPromise: Promise<tf.LayersModel> | null = null;

export function preloadCrepe(): Promise<tf.LayersModel> {
  if (!modelPromise) {
    modelPromise = tf
      .setBackend("webgl")
      .catch(() => tf.setBackend("cpu"))
      .then(() => tf.ready())
      .then(() => tf.loadLayersModel(MODEL_URL));
  }
  return modelPromise;
}

export type CrepeResult = { hz: number | null; confidence: number };

const scratch = new Float32Array(8192);

/**
 * Low-pass below the 8 kHz Nyquist of the 16 kHz target, then decimate.
 * Without this, every harmonic above 8 kHz folds back down into the voice band
 * and CREPE is fed a signal with phantom low partials in it.
 */
function antiAlias(src: Float32Array, n: number, sampleRate: number): Float32Array {
  const fc = 7200 / sampleRate;
  const c = Math.tan(Math.PI * fc);
  const a0 = 1 + Math.SQRT2 * c + c * c;
  const b0 = (c * c) / a0;
  const b1 = (2 * c * c) / a0;
  const b2 = (c * c) / a0;
  const a1 = (2 * (c * c - 1)) / a0;
  const a2 = (1 - Math.SQRT2 * c + c * c) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const xi = src[i] ?? 0;
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    scratch[i] = yi;
  }
  return scratch;
}

function resampleTo16k(original: Float32Array, sampleRate: number): Float32Array {
  const out = new Float32Array(1024);
  const multiplier = sampleRate / 16000;
  const needed = Math.min(original.length, Math.ceil(1024 * multiplier) + 2);
  const src = sampleRate > 16000 ? antiAlias(original, needed, sampleRate) : original;
  for (let i = 0; i < 1024; i++) {
    const x = i * multiplier;
    const left = Math.floor(x);
    const frac = x - left;
    const a = src[left] ?? 0;
    const b = src[left + 1] ?? a;
    out[i] = (1 - frac) * a + frac * b;
  }
  return out;
}

export function crepeFromBuffer(model: tf.LayersModel, buf: Float32Array, sampleRate: number): CrepeResult {
  const resampled = resampleTo16k(buf, sampleRate);
  let result: CrepeResult = { hz: null, confidence: 0 };
  tf.tidy(() => {
    const frame = tf.tensor1d(resampled);
    const mean = tf.mean(frame);
    const zeromean = tf.sub(frame, mean);
    const norm = tf.norm(zeromean);
    const std = tf.div(norm, Math.sqrt(1024));
    const safeStd = tf.maximum(std, 1e-6);
    const normalized = tf.div(zeromean, safeStd);
    const input = normalized.reshape([1, 1024]);
    const activation = (model.predict(input) as tf.Tensor).reshape([360]);
    const confidence = activation.max().dataSync()[0] ?? 0;
    const center = activation.argMax().dataSync()[0] ?? 0;
    if (confidence < 0.4) {
      result = { hz: null, confidence };
      return;
    }

    const start = Math.max(0, center - 4);
    const end = Math.min(360, center + 5);
    const weights = activation.slice([start], [end - start]);
    const w = weights.dataSync();
    let productSum = 0;
    let weightSum = 0;
    for (let i = 0; i < w.length; i++) {
      const wi = w[i] ?? 0;
      productSum += wi * (CENTS[start + i] ?? 0);
      weightSum += wi;
    }
    if (weightSum <= 0) {
      result = { hz: null, confidence };
      return;
    }
    const predictedCent = productSum / weightSum;
    const hz = 10 * 2 ** (predictedCent / 1200);
    result = { hz: Number.isFinite(hz) ? hz : null, confidence };
  });
  return result;
}
