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
