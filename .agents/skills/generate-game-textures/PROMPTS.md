# Prompt recipes

The preambles are code, not prose: `scripts/lib/prompts.mjs` (`MATERIAL_PREAMBLE`, `DECAL_PREAMBLE`, `REPAIR_PROMPT`). Edit them there. `--prompt` is appended after the preamble as `Surface: …` or `Decal: …`, so it should only describe the material or the sprite.

## What the material preamble already says

Top-down orthographic, frame filled by the surface only, no objects/people/horizon/vignette/text, uniform overcast lighting, no baked shadows or highlights, seamlessly tileable, and that the image is a *PBR albedo*: flat overcast daylight at the material's natural mid-tone brightness, no night mood or colour grading baked in. The setting (run-down urban crime district; grimy, weathered, rain-darkened, muted desaturated palette) is stated as a property of the surface, not of the light. Repeating any of it in `--prompt` wastes tokens and can over-steer.

The mood is deliberately **not** in the texture. A basecolor is multiplied by the scene lighting, so one that already looks like night ends up near black in the game; the noir look comes from the scene's lights and post, and the texture has to stay lighting-neutral. Describe what the surface is (`rain-darkened`, `sooty`, `oil-stained`) rather than how it is lit (`at night`, `in shadow`, `under sodium lamps`).

## Albedo brightness

The model still tends to paint too dark. Every draft and final prints `albedo mean N sRGB` (the mean of the image's linear luminance, expressed as sRGB 0–255). Compare it with the family's range and pass `--albedo-mean <N>` at `--final` to rescale the basecolor to that mean before the maps are derived. It is off by default: nothing changes unless you ask.

| Material family | Target mean (sRGB) |
| --- | --- |
| Dark wood, oiled or wet planks | 90–120 |
| Concrete, plaster, pale stone | 110–140 |
| Asphalt, tar, wet road | 60–80 |
| Brick, rust, dark painted metal | 80–110 |
| Gravel, mud, soil | 70–100 |

The rescale works in linear light with one gain for the whole image (hue and saturation stay put) and rolls highlights off with a soft knee instead of clipping them per channel; when brightening, the gain is solved so the *post-knee* mean lands on the target. The gain is capped at twice the no-clip gain: if the target is still out of reach the script warns, records `limited: true` and lands where it can. If `clippedFraction` in the sidecar goes above ~0.05, the image had a bright range the target does not suit; lower the target or fix the prompt.

The same step runs without the API on an existing set:

```bash
node .agents/skills/generate-game-textures/scripts/derive-maps.mjs \
  app/public/textures/<slug>/<slug>_basecolor.jpg --albedo-mean 105
```

This rewrites `<slug>_basecolor.jpg` in place and re-derives the four maps (they depend on it). It prefers the untouched API output kept in the skill's `out/<slug>/final.png` (written by every `--final`); when that is gone it rescales the current JPEG and records `source: "basecolor"` so you know it was a second-generation edit. Derive flags not given on the command line default to what the sidecar recorded, so a normalise-only run keeps the set's `--strength`. The sidecar's `derive.albedoMean` records `target`, `before`, `after`, `gain`, `clippedFraction`, `limited`, `source` and `appliedAt`.

## Style anchors

`refs/style/asphalt-wet.png` and `refs/style/wood-weathered.png` are 512px crops of `mockup-001.png`. They carry grime level and the muted, desaturated palette, not subject, and not exposure: the mockup is a lit night scene, so the anchors are darker than any albedo should be. The preamble tells the model to keep the daylight albedo brightness; if a material still comes back dark, that is the anchor pulling exposure down, and `--albedo-mean` is the fix, not a brighter prompt. If a generated material starts to contain crates or cones, that is the anchor leaking subject: use `--no-style` for that material and describe the palette in words instead ("cold desaturated grey-blue, faint warm tint in the wear").

Replace or add anchors by dropping PNGs into `refs/style/`; every file there is attached to every material call, so keep it to two or three.

## Material recipes

| Slug idea | `--prompt` | Derive flags |
| --- | --- | --- |
| `wet-asphalt` | wet cracked asphalt, thin film of rain, faint oil sheen, scattered grit and small puddles | `--roughness-mode direct --strength 6` |
| `concrete-sidewalk` | weathered concrete slabs with hairline cracks, dark rain stains, sparse moss in the joints | default |
| `brick-soot` | old red brick wall darkened by soot, crumbling mortar, damp streaks | `--strength 12 --ao-strength 1.4` |
| `corrugated-rust` | corrugated steel sheet, rust blooms along the ridges, flaking grey paint | `--strength 14 --roughness-mode invert --roughness-range 0.45,1` |
| `planks-weathered` | rough sawn wooden planks, grey-brown, water-darkened grain, rusty nail heads | `--strength 10 --albedo-mean 105` |
| `gravel-wet` | wet gravel and mud, mixed pebble sizes, dark puddled hollows | `--roughness-mode direct --ao-radius 12` |
| `manhole-street` | asphalt with a single centred cast-iron manhole cover, wet | `--roughness-mode direct` (not tileable in the usual sense; use as a one-off decal-like tile) |

Describe **what the surface is made of and what happened to it**, not how it should be lit. Age and wear words (`weathered`, `stained`, `flaking`, `damp`) do more than adjectives like `realistic`. Avoid `dark` as a lighting word (`dark alley`, `dimly lit`); `dark oiled brown` as a pigment is fine, and `--albedo-mean` sets the brightness anyway.

## Decal recipes

Decals always request `background: transparent`. Say what the sprite *is* and how big its footprint is relative to the frame.

| Slug idea | `--prompt` |
| --- | --- |
| `bullet-hole-concrete` | single bullet impact hole in concrete, chipped rim, dark centre, small radiating cracks, filling about a third of the frame |
| `blood-splatter-01` | dark red blood splatter, one main pool with fine directional spray, already soaking in |
| `oil-stain` | irregular black oil stain with a thin rainbow sheen at the edges |
| `poster-torn` | torn paper poster remnant, rain-soaked, unreadable print, curled corners |
| `scorch-mark` | circular scorch mark from a grenade blast, black centre fading to grey soot |

The model still struggles with legible text; ask for "unreadable" or "illegible" print rather than specific words.

## Seams

Ask for tileable (the preamble does). Then trust the number: the seam ratio compares the wrap-around edge difference with the image's own pixel-to-pixel variation. ~1.0–1.5 tiles cleanly, 1.8+ is visible when repeated, 3+ is a hard seam. `--final` repairs above the threshold with one masked edit on the half-offset image. If it is still above 2 after repair, the pattern is likely too directional or too large-scale; ask for a smaller-scale, more uniform surface rather than repairing again.

## Subject references

`--ref` passes a photo or an existing texture as a subject. Pair it with a prompt that says what to keep: "same brick size and colour as the reference, but wet and sootier". Reference images are processed at high fidelity and cost input tokens; one or two is plenty.
