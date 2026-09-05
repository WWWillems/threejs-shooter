/**
 * Thin client for the OpenAI Images API (generations + edits) using Node's
 * native fetch. No SDK dependency on purpose.
 */

const API = "https://api.openai.com/v1";
export const MODEL = "gpt-image-2";

/** USD per 1M tokens. Approximate; override via env if pricing changes. */
const PRICE = {
  outPerM: Number(process.env.GGT_PRICE_OUT_PER_M ?? 40),
  inImagePerM: Number(process.env.GGT_PRICE_IN_IMAGE_PER_M ?? 10),
  inTextPerM: Number(process.env.GGT_PRICE_IN_TEXT_PER_M ?? 5),
};

/** Hard cap on API calls per invocation so a retry loop cannot run away. */
export class CallBudget {
  constructor(max) {
    this.max = max;
    this.used = 0;
  }
  take(label) {
    if (this.used >= this.max) {
      throw new Error(
        `API call cap (${this.max}) reached before "${label}". Narrow the request or raise --max-calls.`
      );
    }
    this.used += 1;
  }
}

export function formatUsage(usage) {
  if (!usage) return "usage: not reported";
  const text = usage.input_tokens_details?.text_tokens ?? 0;
  const image = usage.input_tokens_details?.image_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  const usd =
    (text * PRICE.inTextPerM + image * PRICE.inImagePerM + out * PRICE.outPerM) / 1_000_000;
  return `usage: text-in ${text}, image-in ${image}, out ${out} tokens (~$${usd.toFixed(3)})`;
}

async function request(path, init, apiKey) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
  });
  const requestId = res.headers.get("x-request-id");
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json.error ?? {};
    let detail = "";
    if (err.code === "moderation_blocked") {
      const md = err.moderation_details ?? {};
      detail = ` (blocked at ${md.moderation_stage ?? "unknown"} stage: ${(md.categories ?? []).join(", ") || "n/a"}; rewrite the prompt, do not retry as-is)`;
    }
    throw new Error(
      `Images API ${res.status} ${err.code ?? err.type ?? ""}: ${err.message ?? res.statusText}${detail} [request ${requestId}]`
    );
  }
  return { json, requestId };
}

function toResult(json, requestId) {
  return {
    images: (json.data ?? []).map((d) => Buffer.from(d.b64_json, "base64")),
    usage: json.usage ?? null,
    requestId,
  };
}

/**
 * @param {object} p
 * @param {string} p.apiKey
 * @param {string} p.prompt
 * @param {string} p.size e.g. "1024x1024"
 * @param {"low"|"medium"|"high"} p.quality
 * @param {number} [p.n]
 * @param {"transparent"|"opaque"} [p.background]
 * @param {CallBudget} p.budget
 */
export async function generateImage({ apiKey, prompt, size, quality, n = 1, background, budget }) {
  budget.take("generate");
  const body = { model: MODEL, prompt, size, quality, n, output_format: "png" };
  if (background) body.background = background;
  const { json, requestId } = await request(
    "/images/generations",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    apiKey
  );
  return toResult(json, requestId);
}

/**
 * Edit / reference-image generation. One image + optional mask edits that
 * image; several images are used as references for a new image.
 *
 * @param {object} p
 * @param {string} p.apiKey
 * @param {string} p.prompt
 * @param {{name:string,type:string,data:Buffer}[]} p.images
 * @param {Buffer} [p.mask] RGBA PNG, alpha 0 where the model may paint
 * @param {string} p.size
 * @param {"low"|"medium"|"high"} p.quality
 * @param {number} [p.n]
 * @param {"transparent"|"opaque"} [p.background]
 * @param {CallBudget} p.budget
 * @param {string} [p.label]
 */
export async function editImage({
  apiKey,
  prompt,
  images,
  mask,
  size,
  quality,
  n = 1,
  background,
  budget,
  label = "edit",
}) {
  budget.take(label);
  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", quality);
  form.append("n", String(n));
  form.append("output_format", "png");
  if (background) form.append("background", background);
  const field = images.length === 1 ? "image" : "image[]";
  for (const img of images) {
    form.append(field, new Blob([img.data], { type: img.type }), img.name);
  }
  if (mask) form.append("mask", new Blob([mask], { type: "image/png" }), "mask.png");
  const { json, requestId } = await request("/images/edits", { method: "POST", body: form }, apiKey);
  return toResult(json, requestId);
}

export function mimeFor(filename) {
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      throw new Error(`Unsupported reference image type: .${ext} (use png, jpg or webp)`);
  }
}
