#!/usr/bin/env node
/**
 * Derive normal, height, roughness and AO maps from a basecolor image.
 * Deterministic, wrap-around (tile-safe), no API calls.
 *
 *   node derive-maps.mjs <basecolor> [--out <dir>] [--slug <slug>]
 *        [--strength 8] [--blur 1] [--roughness-mode invert|direct]
 *        [--roughness-range 0.35,0.95] [--ao-radius 8] [--ao-strength 1]
 */
import { mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const DERIVE_DEFAULTS = Object.freeze({
  /** normal map bumpiness; typical 4–16 */
  strength: 8,
  /** 3x3 box blur passes applied to luminance before use */
  blur: 1,
  /** invert: bright = smooth (dry surfaces). direct: dark = smooth (wet surfaces, puddles). */
  roughnessMode: "invert",
  /** [min, max] roughness after remapping */
  roughnessRange: [0.35, 0.95],
  /** radius in pixels of the cavity blur used for AO */
  aoRadius: 8,
  /** how dark cavities get; 0 disables */
  aoStrength: 1,
});

function boxBlurWrap(src, w, h, radius, passes = 1) {
  let a = Float32Array.from(src);
  let b = new Float32Array(a.length);
  const taps = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += a[row + ((k + w) % w)];
      for (let x = 0; x < w; x++) {
        b[row + x] = sum / taps;
        sum += a[row + ((x + radius + 1) % w)] - a[row + ((x - radius + w) % w)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += b[((k + h) % h) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / taps;
        sum += b[((y + radius + 1) % h) * w + x] - b[((y - radius + h) % h) * w + x];
      }
    }
  }
  return a;
}

function normalize01(arr) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of arr) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  return arr.map((v) => (v - min) / span);
}

function to8(arr) {
  const out = Buffer.alloc(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(arr[i] * 255)));
  return out;
}

export function slugFromBasecolor(path) {
  return basename(path).replace(/_(basecolor|diffuse|albedo)\.\w+$/i, "").replace(/\.\w+$/, "");
}

/**
 * @param {string} basecolorPath
 * @param {{outDir?: string, slug?: string} & Partial<typeof DERIVE_DEFAULTS>} opts
 */
export async function deriveMaps(basecolorPath, opts = {}) {
  const { outDir = dirname(basecolorPath), slug = slugFromBasecolor(basecolorPath), ...rest } = opts;
  const o = { ...DERIVE_DEFAULTS, ...rest };
  const { data, info } = await sharp(basecolorPath).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  const lum = new Float32Array(w * h);
  for (let i = 0; i < lum.length; i++) lum[i] = data[i] / 255;

  const height = normalize01(o.blur > 0 ? boxBlurWrap(lum, w, h, 1, o.blur) : lum);

  // Tangent-space normal, OpenGL convention (green = up), from the wrap-around height gradient.
  const normal = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = height[y * w + ((x - 1 + w) % w)];
      const r = height[y * w + ((x + 1) % w)];
      const u = height[((y - 1 + h) % h) * w + x];
      const d = height[((y + 1) % h) * w + x];
      const nx = -((r - l) / 2) * o.strength;
      const ny = ((d - u) / 2) * o.strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 3;
      normal[i] = Math.round((nx / len) * 127.5 + 127.5);
      normal[i + 1] = Math.round((ny / len) * 127.5 + 127.5);
      normal[i + 2] = Math.round((1 / len) * 127.5 + 127.5);
    }
  }

  let rough = o.roughnessMode === "direct" ? lum : lum.map((v) => 1 - v);
  if (o.blur > 0) rough = boxBlurWrap(rough, w, h, 1, o.blur);
  rough = normalize01(rough);
  const [lo, hi] = o.roughnessRange;
  rough = rough.map((v) => lo + v * (hi - lo));

  const wide = boxBlurWrap(height, w, h, o.aoRadius, 1);
  const ao = new Float32Array(w * h);
  for (let i = 0; i < ao.length; i++) {
    const cavity = Math.max(0, wide[i] - height[i]);
    ao[i] = Math.max(0, Math.min(1, 1 - cavity * o.aoStrength * 3));
  }

  mkdirSync(outDir, { recursive: true });
  const files = {
    normal: join(outDir, `${slug}_normal.png`),
    height: join(outDir, `${slug}_height.png`),
    roughness: join(outDir, `${slug}_roughness.jpg`),
    ao: join(outDir, `${slug}_ao.jpg`),
  };
  const grey = (buf) => sharp(buf, { raw: { width: w, height: h, channels: 1 } });
  await Promise.all([
    sharp(normal, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 9 }).toFile(files.normal),
    grey(to8(height)).png({ compressionLevel: 9 }).toFile(files.height),
    grey(to8(rough)).jpeg({ quality: 85 }).toFile(files.roughness),
    grey(to8(ao)).jpeg({ quality: 85 }).toFile(files.ao),
  ]);
  return { files, params: o, width: w, height: h };
}

/** Parse the derive-related CLI flags shared with generate.mjs. */
export function deriveOptsFromArgs(v) {
  const o = {};
  if (v.strength !== undefined) o.strength = Number(v.strength);
  if (v.blur !== undefined) o.blur = Number(v.blur);
  if (v["roughness-mode"] !== undefined) {
    if (!["invert", "direct"].includes(v["roughness-mode"])) {
      throw new Error("--roughness-mode must be invert or direct");
    }
    o.roughnessMode = v["roughness-mode"];
  }
  if (v["roughness-range"] !== undefined) {
    const parts = v["roughness-range"].split(",").map(Number);
    if (parts.length !== 2 || parts.some(Number.isNaN)) throw new Error("--roughness-range must be like 0.35,0.95");
    o.roughnessRange = parts;
  }
  if (v["ao-radius"] !== undefined) o.aoRadius = Number(v["ao-radius"]);
  if (v["ao-strength"] !== undefined) o.aoStrength = Number(v["ao-strength"]);
  return o;
}

export const DERIVE_ARG_OPTIONS = {
  strength: { type: "string" },
  blur: { type: "string" },
  "roughness-mode": { type: "string" },
  "roughness-range": { type: "string" },
  "ao-radius": { type: "string" },
  "ao-strength": { type: "string" },
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { out: { type: "string" }, slug: { type: "string" }, ...DERIVE_ARG_OPTIONS },
  });
  const [basecolor] = positionals;
  if (!basecolor) {
    console.error("usage: derive-maps.mjs <basecolor> [--out dir] [--slug slug] [derive flags]");
    process.exit(2);
  }
  const result = await deriveMaps(resolve(basecolor), {
    outDir: values.out ? resolve(values.out) : undefined,
    slug: values.slug,
    ...deriveOptsFromArgs(values),
  });
  console.log(JSON.stringify(result, null, 2));
}
