/**
 * Prompt preambles. This file is the single source of truth; PROMPTS.md
 * documents recipes that go *after* these preambles.
 */

export const MATERIAL_PREAMBLE = [
  "Top-down orthographic photograph of a flat surface material, to be used as a video game texture.",
  "The frame is filled edge to edge by the surface only: no objects, no people, no horizon, no vignette, no border, no text, no watermark.",
  "Uniform diffuse overcast lighting; no directional shadows and no specular hotspots baked into the image.",
  "Seamlessly tileable: the left edge continues into the right edge and the top edge into the bottom edge with no visible seam.",
  "This is a PBR albedo: evenly lit under flat overcast daylight at the material's natural mid-tone brightness, the colour it has in daylight; no night mood, no colour grading, no blue or orange tint from lighting baked in.",
  "Setting: a run-down urban crime district; the surface itself is grimy, weathered, rain-darkened and worn, in a muted, desaturated palette.",
].join(" ");

export const DECAL_PREAMBLE = [
  "A single isolated game decal sprite on a fully transparent background, centered, viewed straight on.",
  "No ground, no scene, no cast shadow outside the sprite, no text or watermark unless the description asks for it.",
  "Crisp edges suitable for alpha blending.",
  "Mood: gritty rainy urban noir; desaturated, worn.",
].join(" ");

export const REPAIR_PROMPT = [
  "This tileable texture has been offset by half its width and height, so its former outer edges now meet along the centre vertical and horizontal lines.",
  "Repaint only the masked cross so the seams disappear and the surface is continuous, matching the surrounding material exactly in colour, scale, lighting and grain.",
].join(" ");

/**
 * @param {"material"|"decal"} kind
 * @param {string} userPrompt
 */
export function buildPrompt(kind, userPrompt) {
  switch (kind) {
    case "material":
      return `${MATERIAL_PREAMBLE}\n\nSurface: ${userPrompt.trim()}`;
    case "decal":
      return `${DECAL_PREAMBLE}\n\nDecal: ${userPrompt.trim()}`;
    default: {
      const never = /** @type {never} */ (kind);
      throw new Error(`Unknown kind: ${never}`);
    }
  }
}
