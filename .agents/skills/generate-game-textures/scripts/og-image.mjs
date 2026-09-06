#!/usr/bin/env node
/**
 * One-off promotional Open Graph hero image for "Bang bang".
 *
 * This is NOT one of the skill's two supported kinds (material/decal) — it
 * (ab)uses the same gpt-image-2 client and call-budget guard from ./lib to
 * produce a single wide key-art banner, then composites the game's real
 * logo on top with sharp. Do not extend generate.mjs's kind system for
 * this; it stays a standalone script.
 *
 *   node og-image.mjs [--draft | --final] [--variants N] [--dry-run] [--max-calls 4]
 *
 * Draft: quality low, N variants, written to this skill's out/og-image/.
 * Final: quality high, one image, composited with the logo, written to
 *   app/public/og-image.jpg (1200x630) for the <meta property="og:image">.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { loadApiKey, REPO_ROOT, SKILL_DIR } from "./lib/env.mjs";
import { CallBudget, MODEL, editImage, formatUsage, mimeFor } from "./lib/openai.mjs";

const USAGE = `usage: og-image.mjs [--draft | --final] [options]

  --draft            quality low, allows --variants; preview only (default)
  --final            quality high, one image, composited and written to app/public/og-image.jpg
  --variants N       draft only, default 2
  --lock <file>      use this image (e.g. an approved draft) as the primary reference instead
                     of the raw gameplay mockup, asking for the same composition at higher fidelity
  --recomposite      no API call; redo the crop + logo composite from this skill's saved
                     out/og-image/final.png (fast iteration on logo placement/vignette)
  --max-calls N      hard cap on API calls this invocation (default 4)
  --dry-run          print the plan and full prompt; no API calls`;

const { values: a } = parseArgs({
  options: {
    draft: { type: "boolean", default: false },
    final: { type: "boolean", default: false },
    variants: { type: "string", default: "2" },
    lock: { type: "string" },
    recomposite: { type: "boolean", default: false },
    "max-calls": { type: "string", default: "4" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (a.help) {
  console.log(USAGE);
  process.exit(0);
}
if (a.draft && a.final) {
  console.error(`error: choose --draft or --final, not both\n\n${USAGE}`);
  process.exit(2);
}

const scratchDir = join(SKILL_DIR, "out", "og-image");
const mode = a.final ? "final" : "draft";
const quality = mode === "final" ? "high" : "low";
const variants = mode === "final" ? 1 : Math.max(1, Number(a.variants) || 2);
const budget = new CallBudget(Math.max(1, Number(a["max-calls"]) || 4));

// Generation size: multiple of 16 on each side, close to the 1200x630 OG
// ratio (1.905:1); we crop to the exact OG size after generation.
const SIZE = "1536x800";

const PROMPT = [
  "Wide cinematic key-art poster for a gritty pulp-noir top-down isometric multiplayer shooter video game.",
  "Rain-soaked nighttime urban back-alley lot: glowing warm sodium streetlamps cutting through drifting fog and drizzle, wet asphalt reflecting the lights, scattered stacked wooden crates, a chain-link fence, a distant grimy brick warehouse with a lit rooftop sign.",
  "Two rival gunslingers in long trench coats and fedora silhouettes face off center-frame at a tense standoff distance, pistols drawn; one rim-lit cold blue, the other rim-lit warm red.",
  "Motion-blurred rain streaks, drifting gunsmoke, dramatic high-contrast comic-book noir illustration with bold inked outlines, strong rim lighting and cinematic depth of field.",
  "Clear, uncluttered negative space in the upper-left third of the frame reserved for a logo overlay: absolutely no text, no logo, no UI, no HUD, no health bars, no nameplates, no watermark baked into the image.",
  "Moody desaturated blue-and-orange noir palette, high drama, poster-quality lighting.",
].join(" ");

const LOCK_PROMPT_SUFFIX =
  " Keep this exact composition, camera angle, character poses and lighting layout; render it at higher fidelity and detail.";

const mockupPath = join(REPO_ROOT, "mockup-001.png");
const refs = a.lock
  ? [{ name: "locked-composition.png", type: mimeFor(a.lock), data: readFileSync(a.lock) }]
  : [{ name: "mockup-001.png", type: mimeFor(mockupPath), data: readFileSync(mockupPath) }];
const prompt = a.lock ? `${PROMPT}${LOCK_PROMPT_SUFFIX}` : PROMPT;

console.log(`${MODEL} · og-image · ${mode} · ${SIZE} · quality ${quality} · variants ${variants}`);
console.log(`refs: ${refs.map((r) => r.name).join(", ")}`);
console.log(`prompt:\n${prompt}\n`);

if (a["dry-run"]) {
  console.log(`would write ${mode === "final" ? join(REPO_ROOT, "app", "public", "og-image.jpg") : scratchDir}`);
  process.exit(0);
}

/**
 * `app/public/logo.png` draws its lettering as fully transparent cutouts
 * inside a solid navy silhouette, meant to be matted against a light page
 * background — it reads as "white text" only because the page behind it is
 * light. Composited straight onto a dark photo, those cutouts just show the
 * dark photo through and the logo nearly disappears. Flood-fill from the
 * image edges to tell "outside the silhouette" (stays transparent) apart
 * from "enclosed hole" (a letter) and paint the letters opaque off-white,
 * so the logo is legible on any background.
 */
async function litLogo(path, targetHeight) {
  const { data, info } = await sharp(path).trim().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const out = Buffer.from(data);
  const isTransparent = (x, y) => data[(y * w + x) * c + 3] < 10;
  const visited = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) {
    if (isTransparent(x, 0)) stack.push([x, 0]);
    if (isTransparent(x, h - 1)) stack.push([x, h - 1]);
  }
  for (let y = 0; y < h; y++) {
    if (isTransparent(0, y)) stack.push([0, y]);
    if (isTransparent(w - 1, y)) stack.push([w - 1, y]);
  }
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const idx = y * w + x;
    if (visited[idx] || !isTransparent(x, y)) continue;
    visited[idx] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (isTransparent(x, y) && !visited[idx]) {
        const o = idx * c;
        out[o] = 250;
        out[o + 1] = 249;
        out[o + 2] = 244;
        out[o + 3] = 255;
      }
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: c } })
    .resize({ height: targetHeight })
    .png()
    .toBuffer();
}

const OG_W = 1200;
const OG_H = 630;

/** Crop `image` to the 1200x630 OG size and stamp the lit logo on top. */
async function composite(image) {
  const background = await sharp(image).resize(OG_W, OG_H, { fit: "cover", position: "centre" }).toBuffer();

  // Soft dark vignette in the upper-left third so the logo reads over any
  // busy part of the art underneath it. Shape-only SVG (no text), safe to
  // rasterize with librsvg regardless of installed fonts.
  const vignette = Buffer.from(
    `<svg width="${OG_W}" height="${OG_H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="g" cx="0" cy="0" r="1" gradientTransform="matrix(620 0 0 420 0 0)">
          <stop offset="0%" stop-color="black" stop-opacity="0.55" />
          <stop offset="70%" stop-color="black" stop-opacity="0.25" />
          <stop offset="100%" stop-color="black" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="${OG_W}" height="${OG_H}" fill="url(#g)" />
    </svg>`
  );

  const logoPath = join(REPO_ROOT, "app", "public", "logo.png");
  const logo = await litLogo(logoPath, 300);
  const logoMeta = await sharp(logo).metadata();

  // A soft warm-white glow behind the logo, like the sodium lamps in the
  // scene lighting it from within — plain blur, no font/text rendering.
  const glow = await sharp(logo)
    .resize(Math.round(logoMeta.width * 1.15), Math.round(logoMeta.height * 1.15))
    .blur(14)
    .toBuffer();

  const composited = await sharp(background)
    .composite([
      { input: vignette, top: 0, left: 0 },
      { input: glow, top: 47, left: 55 },
      { input: logo, top: 56, left: 64 },
    ])
    .jpeg({ quality: 88 })
    .toBuffer();

  const outPath = join(REPO_ROOT, "app", "public", "og-image.jpg");
  writeFileSync(outPath, composited);
  console.log(`og image written: ${outPath} (${OG_W}x${OG_H}, logo ${logoMeta.width}x${logoMeta.height})`);
}

if (a.recomposite) {
  await composite(readFileSync(join(scratchDir, "final.png")));
  process.exit(0);
}

const apiKey = loadApiKey();
mkdirSync(scratchDir, { recursive: true });

const result = await editImage({
  apiKey,
  prompt,
  images: refs,
  size: SIZE,
  quality,
  n: variants,
  budget,
  label: "og-image",
});
console.log(`edit ok · request ${result.requestId} · ${formatUsage(result.usage)}`);

if (mode === "draft") {
  for (const [i, img] of result.images.entries()) {
    const draftPath = join(scratchDir, `draft-${i + 1}.png`);
    await sharp(img).png().toFile(draftPath);
    console.log(`draft ${i + 1}: ${draftPath}`);
  }
  console.log("\nReview the draft(s), tune the prompt in this script, then re-run with --final.");
  process.exit(0);
}

// --final: keep the untouched background (re-composite later with
// --recomposite, free of charge) and stamp the logo onto the OG crop.
const [image] = result.images;
const finalScratch = join(scratchDir, "final.png");
await sharp(image).png().toFile(finalScratch);
console.log(`background (untouched): ${finalScratch}`);

await composite(image);
console.log(`API calls used: ${budget.used}/${budget.max}`);
