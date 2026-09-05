---
name: generate-game-textures
description: Generate tileable PBR surface materials and transparent decal sprites for the game with gpt-image-2, matched to the noir art direction, and hand them to Three.js and Blender (via Blender MCP). Use when the user asks for a texture, material, surface, tileable or seamless image, decal, sprite, impact mark, "make it look like the mockup", or a Blender material built from generated textures.
---

# Generate game textures

Two kinds of output, nothing else:

- **Texture set** (`--kind material`): a seamless albedo from gpt-image-2 plus normal, roughness, height and AO derived from it. Lands in `app/public/textures/<slug>/`.
- **Decal** (`--kind decal`): one transparent PNG sprite. Lands in `app/public/decals/<slug>.png`.

Per-model UV textures are out of scope; do not try to paint a specific mesh's unwrap with this skill.

## Setup (once per machine)

```bash
cd .agents/skills/generate-game-textures/scripts && npm install
```

`OPENAI_API_KEY` must be in the environment or in `<repo>/.env` (gitignored). Never write the key anywhere else.

## Workflow

Run scripts from the repo root with `node .agents/skills/generate-game-textures/scripts/generate.mjs …`.

1. **Draft** (default, `quality: low`, cheap):
   `generate.mjs --slug wet-asphalt --prompt "wet cracked asphalt, oil sheen, scattered grit" --variants 2`
   Drafts and a 2x2 `*_tilecheck.png` go to the skill's `out/<slug>/`. Show the user the draft and the tile check; report the seam ratio.
2. **Iterate on the prompt** with more drafts. Read [PROMPTS.md](PROMPTS.md) for recipes and what the preamble already says (do not repeat it in `--prompt`).
3. **Final** only after the user approves a draft: add `--final`. One `high` image, seam repaired via mask edit if the ratio exceeds `--seam-threshold` (1.8), maps derived, `<slug>.texture.json` sidecar written next to the files.
4. **Use it**:
   - Three.js: load with `THREE.TextureLoader`, `RepeatWrapping`, same pattern as `app/src/components/WoodenCrate.ts`.
   - Blender: follow [BLENDER.md](BLENDER.md) through the Blender MCP; pass the absolute paths the script prints.

References: `--ref photo.jpg` (repeatable) adds subject references. `refs/style/*` (crops of `mockup-001.png`) are attached automatically for materials; `--no-style` drops them, `--style` forces them for a decal. Any reference switches the call to `images.edit`.

Use `--dry-run` to print the full prompt and target paths without spending anything.

## Conventions

- Slug: lowercase, digits, dashes. Files: `<slug>_basecolor.jpg`, `<slug>_roughness.jpg`, `<slug>_ao.jpg` (JPEG q85), `<slug>_normal.png`, `<slug>_height.png` (lossless).
- 1024x1024 default. `--size 2048x2048` for hero surfaces only. Square for anything that repeats.
- Derived-map tuning lives in the sidecar (`derive`) and can be re-run without the API:
  `node …/scripts/derive-maps.mjs app/public/textures/<slug>/<slug>_basecolor.jpg --strength 12 --roughness-mode direct`
  Wet surfaces want `--roughness-mode direct` (dark puddles = smooth); dry ones the default `invert`.
- Existing folders (`crate/`, `concrete/`, `grass/`) predate this skill and use other names. Leave them alone; migrating them is a separate change.
- `out/` is scratch and gitignored. Only finals go into `app/public/`.

## Guardrails

- Never run `--final` before the user has seen a draft, unless they explicitly ask to skip it.
- Hard cap of 4 API calls per invocation (`--max-calls`). If the cap trips, stop and report; do not loop.
- `moderation_blocked` and other `image_generation_user_error`s mean the prompt must change; do not retry as-is.
- Print the `usage:` line the script emits so the user sees what each call cost.
- The API returns PNG; the script does all format conversion locally. Do not re-encode outputs by hand.
