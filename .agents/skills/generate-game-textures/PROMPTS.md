# Prompt recipes

The preambles are code, not prose: `scripts/lib/prompts.mjs` (`MATERIAL_PREAMBLE`, `DECAL_PREAMBLE`, `REPAIR_PROMPT`). Edit them there. `--prompt` is appended after the preamble as `Surface: …` or `Decal: …`, so it should only describe the material or the sprite.

## What the material preamble already says

Top-down orthographic, frame filled by the surface only, no objects/people/horizon/vignette/text, uniform overcast lighting, no baked shadows or highlights, seamlessly tileable, rainy noir palette. Repeating any of it in `--prompt` wastes tokens and can over-steer.

## Style anchors

`refs/style/asphalt-wet.png` and `refs/style/wood-weathered.png` are 512px crops of `mockup-001.png`. They carry palette and grime level, not subject. If a generated material starts to contain crates or cones, that is the anchor leaking: use `--no-style` for that material and describe the palette in words instead ("cold desaturated grey-blue, sodium-orange tint in the highlights").

Replace or add anchors by dropping PNGs into `refs/style/`; every file there is attached to every material call, so keep it to two or three.

## Material recipes

| Slug idea | `--prompt` | Derive flags |
| --- | --- | --- |
| `wet-asphalt` | wet cracked asphalt, thin film of rain, faint oil sheen, scattered grit and small puddles | `--roughness-mode direct --strength 6` |
| `concrete-sidewalk` | weathered concrete slabs with hairline cracks, dark rain stains, sparse moss in the joints | default |
| `brick-soot` | old red brick wall darkened by soot, crumbling mortar, damp streaks | `--strength 12 --ao-strength 1.4` |
| `corrugated-rust` | corrugated steel sheet, rust blooms along the ridges, flaking grey paint | `--strength 14 --roughness-mode invert --roughness-range 0.45,1` |
| `planks-weathered` | rough sawn wooden planks, grey-brown, water-darkened grain, rusty nail heads | `--strength 10` |
| `gravel-wet` | wet gravel and mud, mixed pebble sizes, dark puddled hollows | `--roughness-mode direct --ao-radius 12` |
| `manhole-street` | asphalt with a single centred cast-iron manhole cover, wet | `--roughness-mode direct` (not tileable in the usual sense; use as a one-off decal-like tile) |

Describe **what the surface is made of and what happened to it**, not how it should be lit. Age and wear words (`weathered`, `stained`, `flaking`, `damp`) do more than adjectives like `realistic`.

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
