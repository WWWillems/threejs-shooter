# Bang bang - A vibe coded Three.js multiplayer shooter

An isometric multiplayer shooter built with Three.js on the client and socket.io on the server.
This repository is an npm-workspaces monorepo containing the client, the server and the shared
event contract between them.

## Layout

```
threejs-shooter/
├── app/       @threejs-shooter/app     Vite + Three.js browser client
├── server/    @threejs-shooter/server  Express + socket.io game server (dist/ is committed)
├── shared/    @threejs-shooter/shared  GAME_EVENTS constants and event payload types
├── .cursor/   Cursor rules (AI context)
└── .agents/   Agent skills
```

- `app` depends on `shared` for the socket event names and payload types.
- `server` bundles `shared` into `server/dist/index.mjs` via pkgroll, so the deployed bundle is self-contained.
- `shared` is source-only TypeScript; there is no build step for it.

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- npm 10+

## Getting started

```bash
npm install          # installs all workspaces from the root
npm run dev:server   # socket.io server on http://localhost:3000
npm run dev:app      # Vite dev server on http://localhost:5173
```

The client reads the server URL from `VITE_SERVER_URL` and falls back to `http://localhost:3000`.

## Building levels

The development-only editor is available at `/editor.html`:

```bash
npm run dev:editor
```

It edits the checked-in JSON documents under `shared/levels/`. The editor can export a level
for review; install that export with the validator/normalizer:

```bash
npm run import:level -- ./path/to/export.json [level-id]
```

Gameplay loads the same active level on both ends. Use `VITE_LEVEL_ID` for the client and
`LEVEL_ID` for the server; both default to `default`. The server must be restarted after
changing its level environment variable.

## Generating game textures

The `generate-game-textures` skill creates tileable PBR surface materials and transparent
decals using `gpt-image-2`. It also derives normal, roughness, height, and ambient-occlusion
maps from the generated basecolor image.

Set the OpenAI key in the root `.env` file:

```env
OPENAI_API_KEY=your_key_here
```

Install the skill's image-processing dependency once:

```bash
cd .agents/skills/generate-game-textures/scripts
npm install
cd ../../../..
```

Generate inexpensive drafts first:

```bash
node .agents/skills/generate-game-textures/scripts/generate.mjs \
  --slug wet-asphalt \
  --prompt "wet cracked asphalt, thin rain film, faint oil sheen, scattered grit" \
  --variants 2
```

Drafts and tile previews are written to `.agents/skills/generate-game-textures/out/`.
After reviewing a draft, generate the final texture set:

```bash
node .agents/skills/generate-game-textures/scripts/generate.mjs \
  --slug wet-asphalt \
  --prompt "wet cracked asphalt, thin rain film, faint oil sheen, scattered grit" \
  --final \
  --roughness-mode direct \
  --strength 6
```

Final materials are written to `app/public/textures/<slug>/`. Transparent decals use:

```bash
node .agents/skills/generate-game-textures/scripts/generate.mjs \
  --kind decal \
  --slug bullet-hole-concrete \
  --prompt "single bullet impact hole in concrete, chipped rim, dark centre" \
  --final
```

Use `--ref /path/to/reference.png` to generate from a subject reference. Material style
references from `mockup-001.png` are included automatically; use `--no-style` to omit them.
Use `--dry-run` to inspect the prompt and output paths without calling the API.

For Blender material setup through Blender MCP, see
[`.agents/skills/generate-game-textures/BLENDER.md`](.agents/skills/generate-game-textures/BLENDER.md).
The Blender setup reads the same files from `app/public/` and does not pack them into the
`.blend` file.

## Building

```bash
npm run build        # builds app and server
npm run build:app    # tsc + vite build -> app/dist (gitignored)
npm run build:server # pkgroll -> server/dist/index.mjs (committed)
```

## Deploying the server

See [server/README.md](server/README.md).

## Controls

- WASD - Move
- Mouse - Aim
- Left Click - Shoot
- R - Reload
- 1 / 2 / 3 - Select weapon, Q / E - Previous / next weapon
- Tab - Leaderboard

## History

`app/` and `server/` used to be separate repositories. Their pre-merge history is preserved
as the tags `archive/standalone-app` (this repo) and `archive/standalone-server`
(`WWWillems/threejs-shooter-server`, archived).

## License

MIT
