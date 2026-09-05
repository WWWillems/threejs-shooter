/**
 * Albedo brightness measurement and normalisation. No API calls.
 *
 * A PBR basecolor has to be a lighting-neutral mid-tone: the scene lighting
 * darkens it, so a basecolor that already carries a night mood ends up near
 * black. The image model tends to bake mood into the pixels anyway, so this
 * module rescales a basecolor so its mean luminance hits a target while
 * keeping hue and saturation, working in linear light.
 *
 * "Mean" throughout is the mean of the image's linear (Rec. 709) luminance,
 * expressed as an sRGB value 0–255. That is the number the `--albedo-mean`
 * flag takes and the sidecar records.
 */
import sharp from "sharp";

/** Above this linear value the soft clip starts compressing towards 1. */
export const ALBEDO_KNEE = 0.8;
/** When brightening, never exceed this multiple of the no-clip gain. */
export const MAX_EXTRA_GAIN = 2;

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  SRGB_TO_LINEAR[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** @param {number} v linear 0..1 → sRGB 0..255 (not rounded) */
export function linearToSrgb(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, c * 255));
}

/** @param {number} s sRGB 0..255 → linear 0..1 */
export function srgbToLinear(s) {
  const v = Math.max(0, Math.min(255, s)) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/**
 * Smooth, monotone compression of values above the knee towards 1, so that a
 * gain that would blow out the highlights rolls them off instead of clipping.
 */
function softClip(v, knee) {
  if (v <= knee) return v;
  return knee + (1 - knee) * Math.tanh((v - knee) / (1 - knee));
}

/** Decode any image sharp can read into linear RGB floats (3 channels). */
async function decodeLinear(input) {
  const { data, info } = await sharp(input).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const n = width * height;
  const lin = new Float32Array(n * 3);
  if (channels === 3) {
    for (let i = 0; i < lin.length; i++) lin[i] = SRGB_TO_LINEAR[data[i]];
  } else if (channels === 1) {
    for (let i = 0; i < n; i++) lin[i * 3] = lin[i * 3 + 1] = lin[i * 3 + 2] = SRGB_TO_LINEAR[data[i]];
  } else {
    throw new Error(`albedo: unexpected channel count ${channels}`);
  }
  return { lin, width, height };
}

function meanLuminance(lin) {
  let sum = 0;
  for (let i = 0; i < lin.length; i += 3) sum += 0.2126 * lin[i] + 0.7152 * lin[i + 1] + 0.0722 * lin[i + 2];
  return sum / (lin.length / 3);
}

/**
 * Mean luminance after applying `gain` with hue-preserving soft clipping,
 * without materialising the output.
 */
function meanAfterGain(lin, gain, knee) {
  let sum = 0;
  for (let i = 0; i < lin.length; i += 3) {
    const r = lin[i] * gain;
    const g = lin[i + 1] * gain;
    const b = lin[i + 2] * gain;
    const m = Math.max(r, g, b);
    const s = m > knee ? softClip(m, knee) / m : 1;
    sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) * s;
  }
  return sum / (lin.length / 3);
}

/**
 * Measure a basecolor's mean luminance.
 * @param {string|Buffer} input path or image buffer
 * @returns {Promise<{mean: number, linear: number}>} `mean` in sRGB 0–255
 */
export async function measureAlbedoMean(input) {
  const { lin } = await decodeLinear(input);
  const linear = meanLuminance(lin);
  return { mean: linearToSrgb(linear), linear };
}

/**
 * Rescale a basecolor in linear light so its mean luminance hits `targetMean`
 * (sRGB 0–255). Hue and saturation are preserved: every pixel's linear RGB is
 * multiplied by one gain, and pixels the gain would push past the knee are
 * rolled off along their own chromaticity rather than clipped per channel.
 * When brightening, the gain is solved by bisection so the *post-clip* mean
 * lands on the target; when darkening no clipping can occur and the gain is
 * exact.
 *
 * @param {string|Buffer} input path or image buffer
 * @param {number} targetMean sRGB 0–255
 * @param {{knee?: number}} [opts]
 * @returns {Promise<{png: Buffer, width: number, height: number, before: number, after: number, gain: number, clipped: number, limited: boolean}>}
 *   `png` is a lossless PNG of the result; `before`/`after` are means in sRGB;
 *   `clipped` is the fraction of pixels that went through the soft clip;
 *   `limited` is true when the target was out of reach and `after` misses it.
 */
export async function normalizeAlbedo(input, targetMean, { knee = ALBEDO_KNEE } = {}) {
  if (!(targetMean > 0 && targetMean < 255)) throw new Error("albedo target mean must be within 1..254 sRGB");
  const { lin, width, height } = await decodeLinear(input);
  const beforeLin = meanLuminance(lin);
  if (beforeLin <= 0) throw new Error("albedo: image is black, cannot normalise");
  const targetLin = srgbToLinear(targetMean);

  const naiveGain = targetLin / beforeLin;
  let gain = naiveGain;
  let limited = false;
  if (gain > 1) {
    // Soft clipping lowers the mean below targetLin at the naive gain; search
    // upwards for the gain whose clipped mean hits the target. The mean
    // plateaus under the clip ceiling, so the search is capped at twice the
    // naive gain: past that the target is wrong for this image, and blowing
    // the whole texture out to chase it would be worse than missing it.
    let lo = gain;
    let hi = gain * MAX_EXTRA_GAIN;
    if (meanAfterGain(lin, hi, knee) < targetLin) {
      limited = true;
      gain = hi;
    } else {
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (meanAfterGain(lin, mid, knee) < targetLin) lo = mid;
        else hi = mid;
      }
      gain = hi;
    }
  }

  const out = Buffer.alloc(width * height * 3);
  let clipped = 0;
  let sum = 0;
  for (let i = 0; i < lin.length; i += 3) {
    let r = lin[i] * gain;
    let g = lin[i + 1] * gain;
    let b = lin[i + 2] * gain;
    const m = Math.max(r, g, b);
    if (m > knee) {
      const s = softClip(m, knee) / m;
      r *= s;
      g *= s;
      b *= s;
      clipped++;
    }
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    out[i] = Math.round(linearToSrgb(r));
    out[i + 1] = Math.round(linearToSrgb(g));
    out[i + 2] = Math.round(linearToSrgb(b));
  }
  const png = await sharp(out, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
  return {
    png,
    width,
    height,
    before: linearToSrgb(beforeLin),
    after: linearToSrgb(sum / (lin.length / 3)),
    gain,
    clipped: clipped / (lin.length / 3),
    limited,
  };
}
