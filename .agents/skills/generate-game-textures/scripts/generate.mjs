#!/usr/bin/env node
/**
 * Generate a game texture with gpt-image-2.
 *
 *   node generate.mjs --slug <slug> --prompt "<what the surface is>" [--kind material|decal]
 *        [--draft | --final] [--size 1024x1024] [--variants N]
 *        [--ref <image>]... [--no-style] [--no-repair] [--seam-threshold 1.8]
 *        [--max-calls 4] [--dry-run] [derive flags, see derive-maps.mjs]
 *
 * Draft (default): quality low, N variants, written to the skill's out/ folder
 *   with a 2x2 tile check and a seam score. Costs little; iterate on the prompt here.
 * Final: quality high, one image, seam repaired if needed, written into
 *   app/public/textures/<slug>/ (material) or app/public/decals/ (decal),
 *   PBR maps derived, sidecar <slug>.texture.json written.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { loadApiKey, REPO_ROOT, SKILL_DIR } from "./lib/env.mjs";
import { CallBudget, MODEL, editImage, formatUsage, generateImage, mimeFor } from "./lib/openai.mjs";
import { REPAIR_PROMPT, buildPrompt } from "./lib/prompts.mjs";
import { offsetHalf, seamMask, seamScore, tileCheck } from "./lib/seam.mjs";
import { DERIVE_ARG_OPTIONS, deriveMaps, deriveOptsFromArgs } from "./derive-maps.mjs";

const USAGE = `usage: generate.mjs --slug <slug> --prompt "<text>" [options]

  --kind material|decal     material (tileable PBR set, default) or decal (transparent PNG)
  --draft                   quality low, allows --variants; output in skill out/ (default)
  --final                   quality high, one image, written into app/public/
  --size WxH                default 1024x1024; multiples of 16, <=3840, ratio <=3:1
  --variants N              draft only, default 1
  --ref <image>             subject reference (repeatable); any ref switches to images.edit
  --no-style                do not attach refs/style/* (default: attached for materials only)
  --style                   force style refs on (e.g. for a decal)
  --no-repair               skip the seam repair edit even if the seam check fails
  --seam-threshold N        seam ratio above which repair runs (default 1.8)
  --max-calls N             hard cap on API calls this invocation (default 4)
  --dry-run                 print the plan and full prompt; no API calls
  --out-root <dir>          write finals under <dir>/app/public instead of the repo (testing)
  derive flags              --strength --blur --roughness-mode --roughness-range --ao-radius --ao-strength`;

const { values: a } = parseArgs({
  allowNegative: true,
  options: {
    slug: { type: "string" },
    kind: { type: "string", default: "material" },
    prompt: { type: "string" },
    ref: { type: "string", multiple: true, default: [] },
    style: { type: "boolean" },
    draft: { type: "boolean", default: false },
    final: { type: "boolean", default: false },
    size: { type: "string", default: "1024x1024" },
    variants: { type: "string", default: "1" },
    repair: { type: "boolean", default: true },
    "seam-threshold": { type: "string", default: "1.8" },
    "max-calls": { type: "string", default: "4" },
    "dry-run": { type: "boolean", default: false },
    "out-root": { type: "string" },
    help: { type: "boolean", default: false },
    ...DERIVE_ARG_OPTIONS,
  },
});

if (a.help) {
  console.log(USAGE);
  process.exit(0);
}

function fail(msg) {
  console.error(`error: ${msg}\n\n${USAGE}`);
  process.exit(2);
}

if (!a.slug || !/^[a-z0-9][a-z0-9-]*$/.test(a.slug)) fail("--slug is required: lowercase letters, digits, dashes");
if (!a.prompt?.trim()) fail("--prompt is required");
if (!["material", "decal"].includes(a.kind)) fail("--kind must be material or decal");
if (a.draft && a.final) fail("choose --draft or --final, not both");

const kind = /** @type {"material"|"decal"} */ (a.kind);
const mode = a.final ? "final" : "draft";
const quality = mode === "final" ? "high" : "low";
const variants = mode === "final" ? 1 : Math.max(1, Number(a.variants) || 1);
const seamThreshold = Number(a["seam-threshold"]);
const budget = new CallBudget(Math.max(1, Number(a["max-calls"]) || 4));
const deriveOpts = deriveOptsFromArgs(a);
const outRoot = a["out-root"] ? resolve(a["out-root"]) : REPO_ROOT;

const [w, h] = a.size.split("x").map(Number);
if (!w || !h || w % 16 || h % 16 || w > 3840 || h > 3840) fail("--size must be WxH, multiples of 16, each <= 3840");
if (Math.max(w, h) / Math.min(w, h) > 3) fail("--size aspect ratio must not exceed 3:1");
if (w * h < 655_360 || w * h > 8_294_400) fail("--size total pixels must be within 655,360..8,294,400");
if (kind === "material" && w !== h) console.warn("warning: non-square material; RepeatWrapping assumes square tiles in most of the game code");

const useStyle = a.style ?? kind === "material";
const styleDir = join(SKILL_DIR, "refs", "style");
const styleRefs = useStyle
  ? readdirSync(styleDir)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .sort()
      .map((f) => join(styleDir, f))
  : [];
const subjectRefs = a.ref.map((r) => resolve(r));
const refs = [...subjectRefs, ...styleRefs].map((p) => ({
  name: basename(p),
  type: mimeFor(p),
  data: readFileSync(p),
}));

const fullPrompt = buildPrompt(kind, a.prompt);
const scratchDir = join(SKILL_DIR, "out", a.slug);
const finalDir = kind === "material" ? join(outRoot, "app", "public", "textures", a.slug) : join(outRoot, "app", "public", "decals");
const rel = (p) => relative(outRoot, p);

console.log(`${MODEL} · ${kind} · ${mode} · ${a.size} · quality ${quality} · variants ${variants}`);
console.log(`refs: ${refs.length ? refs.map((r) => r.name).join(", ") : "none (images.generate)"}`);
console.log(`prompt:\n${fullPrompt}\n`);

if (a["dry-run"]) {
  console.log(`would write ${mode === "final" ? finalDir : scratchDir}`);
  process.exit(0);
}

const apiKey = loadApiKey();
const requests = [];

async function produce(n) {
  const common = { apiKey, prompt: fullPrompt, size: a.size, quality, n, budget };
  if (kind === "decal") common.background = "transparent";
  const result = refs.length ? await editImage({ ...common, images: refs, label: "reference" }) : await generateImage(common);
  requests.push({ step: refs.length ? "edit" : "generate", requestId: result.requestId, usage: result.usage });
  console.log(`${refs.length ? "edit" : "generate"} ok · request ${result.requestId} · ${formatUsage(result.usage)}`);
  return result.images;
}

mkdirSync(scratchDir, { recursive: true });

if (mode === "draft") {
  const images = await produce(variants);
  for (const [i, img] of images.entries()) {
    const n = i + 1;
    const draftPath = join(scratchDir, `draft-${n}.png`);
    await sharp(img).png().toFile(draftPath);
    let line = `draft ${n}: ${draftPath}`;
    if (kind === "material") {
      const score = await seamScore(img);
      const checkPath = join(scratchDir, `draft-${n}_tilecheck.png`);
      await tileCheck(img, checkPath);
      line += `\n  seam ratio ${score.ratio.toFixed(2)} (${score.ratio > seamThreshold ? "would repair" : "tiles ok"}) · tile check ${checkPath}`;
    }
    console.log(line);
  }
  console.log("\nReview the draft(s), tune the prompt, then re-run with --final.");
  process.exit(0);
}

let [image] = await produce(1);
let seam = null;

if (kind === "material") {
  const before = await seamScore(image);
  seam = { threshold: seamThreshold, before: before.ratio, after: null, repaired: false };
  console.log(`seam ratio ${before.ratio.toFixed(2)} (threshold ${seamThreshold})`);
  if (before.ratio > seamThreshold && before.absolute > 4 && a.repair) {
    const shifted = await offsetHalf(image);
    const mask = await seamMask(w, h);
    const repaired = await editImage({
      apiKey,
      prompt: REPAIR_PROMPT,
      images: [{ name: "tile.png", type: "image/png", data: shifted }],
      mask,
      size: a.size,
      quality,
      budget,
      label: "seam repair",
    });
    requests.push({ step: "repair", requestId: repaired.requestId, usage: repaired.usage });
    console.log(`repair ok · request ${repaired.requestId} · ${formatUsage(repaired.usage)}`);
    image = repaired.images[0];
    const after = await seamScore(image);
    seam.after = after.ratio;
    seam.repaired = true;
    console.log(`seam ratio after repair ${after.ratio.toFixed(2)}`);
  }
}

mkdirSync(finalDir, { recursive: true });
const files = {};
let derive = null;

if (kind === "material") {
  files.basecolor = join(finalDir, `${a.slug}_basecolor.jpg`);
  await sharp(image).jpeg({ quality: 85 }).toFile(files.basecolor);
  files.tilecheck = join(scratchDir, `final_tilecheck.png`);
  await tileCheck(image, files.tilecheck);
  const derived = await deriveMaps(files.basecolor, { outDir: finalDir, slug: a.slug, ...deriveOpts });
  Object.assign(files, derived.files);
  derive = derived.params;
} else {
  files.decal = join(finalDir, `${a.slug}.png`);
  await sharp(image).png({ compressionLevel: 9 }).toFile(files.decal);
}

const sidecarPath = join(finalDir, `${a.slug}.texture.json`);
const sidecar = {
  slug: a.slug,
  kind,
  model: MODEL,
  createdAt: new Date().toISOString(),
  size: a.size,
  quality,
  prompt: a.prompt,
  fullPrompt,
  styleRefs: styleRefs.map((p) => relative(SKILL_DIR, p)),
  subjectRefs,
  requests,
  seam,
  derive,
  files: Object.fromEntries(Object.entries(files).map(([k, p]) => [k, rel(p)])),
};
writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);

console.log(`\nwritten (absolute paths, for Blender):`);
for (const [k, p] of Object.entries(files)) console.log(`  ${k.padEnd(10)} ${p}`);
console.log(`  sidecar    ${sidecarPath}`);
console.log(`\nAPI calls used: ${budget.used}/${budget.max}`);
