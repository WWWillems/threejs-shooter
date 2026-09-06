# Noir art pass

`noir-assets.blend` is the editable Blender workshop. It contains the pickup,
trench-coat character, shop, pine, shrub, tied trash bag, oil barrel and yellow
forklift, with review cameras. Original
`crate.blend` and `traffic-cone.blend` assets are retained.

The source is `scripts/build-noir-assets.py`, executed using Blender MCP's
`execute_blender_code` tool. Set `NOIR_REPO_ROOT` for a checkout at another path.
It creates a separate scene, combines parts by material, and exports only the
selected model from the active scene to `app/public/models/noir-*.glb`.

`scripts/add-yard-props.py` appends the three yard props to the workshop and
exports them. Run it once on the base workshop; it is an authoring operation,
not a build step. `scripts/texture-yard-props.py` attaches their approved
generated PBR sets, saves the workshop and renders `yard-props-preview.png`.

`scripts/add-noir-buildings.py` creates the standalone warehouse and tenement
workshop, exports `noir-warehouse.glb` and `noir-tenement.glb`, and renders
`noir-buildings-preview.png`. Their material slots use the generated
`brick-soot`, `corrugated-rust`, and `weathered-concrete` texture sets.

- Coordinates in the authoring helpers are game coordinates: Y up, -Z forward.
- Models are at metre scale. The character is centred on its existing hitbox;
  props are based on the ground. Roofs, leaves and trim are cosmetic extensions.
- GLBs contain geometry and material slots, with no embedded images.
- `core/models.ts` caches assets, enables shadows and attaches the wood/plaster,
  building, and generated prop materials. Blender material suffixes
  (`.001`) are normalized by the loader.
- Instances share cached resources; detach them rather than disposing shared
  geometry/materials. Character collision/controller meshes remain independent.
- Texture files stay external and relative in Blender. The generated asphalt is
  in `app/public/textures/wet-asphalt`; its sidecar records generation and map tuning.

The yard props use `trash-bag-plastic`, `oil-barrel-steel` and `forklift-yellow`
texture sets. Shared `sim/props.ts` defines their collision bounds: barrels and
forklifts stop projectiles; bags only block movement. The forklift's lowered
forks have a separate low collider. All three are available in the level editor
and placed in the default level. They are static props with no destruction logic.

The ground combines this PBR texture set with one 768px planar reflection,
masked by roughness and distorted by the normal map. `core/Scene.ts` owns the
light intensities, exposure, reflection environment and subtle bloom. The scene
caps device pixel ratio at 1.25 to keep these effects affordable on Retina screens.

Validated with Node 22: `yarn typecheck`, `yarn test` (91 tests), `yarn build:app`
and `yarn build:server`.
The Blender preview is a model/material review; the browser is the lighting reference.

## Animated character and held weapons

`noir-character.blend` is a separate editable character workshop, keeping the
building/yard workshops independent. The exported `noir-character.glb` contains
an 18-bone skin and Idle, Walk, Run, CrouchIdle, CrouchWalk, Jump, Fall, Land and
Death actions. Each player clones the skeleton and owns an AnimationMixer.
The ground-based character is offset beneath the existing controller hitbox;
visual animation never supplies gameplay position or damage collision.

Run `rig-noir-character.py`, `model-noir-weapons.py`, `refine-noir-character.py`
and `preview-noir-character.py` through Blender MCP in that order, starting
from a Blender file without the character workshop. The last step attaches
the approved `noir-coat-wool` PBR set and writes a review render. Texture paths
remain external and relative. The model loader sets matching UV repetition.

Held pistol, rifle and shotgun GLBs have exact `Muzzle` nodes and separate
`Slide`, `Magazine` or `Pump` assemblies. `WeaponSocket` follows the character's
right hand; two-bone support-arm IK keeps the left hand on the weapon. Runtime
presentation adds recoil, equip/reload motion, a brief emissive muzzle flash,
a short-lived light and smoke. Shared weapon rates/ammo/damage remain unchanged.

Open `/character.html` to inspect poses, orbit the model and try each weapon.
The production build includes this workshop alongside the game and level editor.
Tests load the actual GLB to check clip coverage, independent skeletons, crouch,
death/reset and finite animated bounds; network tests cover cosmetic pose state.

### Interactive yard kit

`noir-interactives.blend` is an isolated workshop authored through Blender MCP by
`scripts/model-interactive-yard.py`. It contains tire stacks, an open fire drum,
a red/ivory explosive fuel drum, a timber barricade, smoke generator, alarm and
warning beacons, and a lift gate. The gate frame and moving panel export separately
as `noir-lift-gate-frame.glb` and `noir-lift-gate-panel.glb`; the panel travels 3 m
upward while the guide posts stay fixed. All exports use ground origins and Y-up.

The kit reuses approved utility-pole timber, barrel steel and galvanized-steel
textures. Tire rubber and hazard markings are mesh materials. Fire and smoke are
runtime effects, not baked lights or images. Re-running the authoring script replaces
only its own workshop, exports the nine GLBs, and saves an assembled preview.

### Loot arsenal

`noir-arsenal.blend`, authored with `scripts/model-noir-arsenal.py` through Blender
MCP, holds the rocket launcher, flamethrower, precision rifle and arc gun. The four
`noir-<weapon>.glb` exports share the existing grip origin and -Z firing axis, with
explicit muzzle nodes and detachable magazines; the precision rifle also has a
moving bolt. Blender renders the matching transparent inventory icons into
`app/public/icons/`. The standalone character workshop includes all seven weapons.

### Reference-sheet teams

`noir-team-a.blend` and `noir-team-b.blend` are isolated Blender MCP workshops.
Run `model-team-characters.py` with `TEAM='A'` or `TEAM='B'`, then
`review-team-characters.py` after both exports exist. The review step canonicalizes
weapon sockets, keeps nine unique animation clips, attaches external approved PBR
maps and renders the previews. Team A uses the existing wool; Team B uses approved
`gang-charcoal-canvas` with subtle normal strength. Both share the original 18-bone
hierarchy and animation contract. Geometry budgets: A 8,604 triangles; B 6,964.
The game chooses A for blue and B for red. The character workshop has a team selector.

### Loot and projectile kit

`model-noir-loot.py` builds the isolated `Noir loot workshop`, saves
`noir-loot.blend`, renders `noir-loot-preview.png`, and exports twelve GLBs:
seven weapon-specific ammo packs, medical satchel, armor vest, rocket, bullet,
and arc cell. These assets use 66–1,296 triangles each and 2–6 material primitives.
Projectiles face game -Z; pickup roots stay at the authoritative spawn position
while their visual children hover. Cached GLB geometry/materials are shared.
The vest reuses approved charcoal canvas; the small metal and enamel details
use named flat PBR materials, requiring no new image generation.

Character refinement scripts are `refine-team-a-character.py` and
`refine-team-b-professional.py`; run them through Blender MCP sequentially.
A preserves its base rig generator; B refines the already loaded B workshop.
Use `preview-refined-team-a.py` and `preview-team-b-professional.py` to review.
Both exports retain nine clips and eighteen bones; A is 12,268 triangles and
B is 14,903 triangles. The original base generator is not the final geometry.
