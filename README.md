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
