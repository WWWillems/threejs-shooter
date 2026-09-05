# @threejs-shooter/server

Express + socket.io game server. Part of the `threejs-shooter` monorepo; install from the repo root with `npm install`.

## Development

```bash
npm run dev:server        # from the repo root (tsx watch ./src/index.ts)
```

Listens on `PORT` (default `3000`). `GET /leaderboard` returns the current leaderboard.

## Build

```bash
npm run build:server      # from the repo root (pkgroll -> dist/index.mjs)
```

`dist/index.mjs` is committed on purpose: the server machine runs it directly without a build step.
`@threejs-shooter/shared` is a devDependency so pkgroll inlines it; the bundle only imports runtime
dependencies (`express`, `socket.io`, `cors`, `http`).

## Deploying

### One-time migration (repo moved from `threejs-shooter-server` into this monorepo)

The server machine used to clone `WWWillems/threejs-shooter-server`. That repo is archived; the code now lives in `server/` of `WWWillems/threejs-shooter`.

```bash
ssh <server>
cd /path/to/deployments
git clone git@github.com:WWWillems/threejs-shooter.git
cd threejs-shooter
npm ci --omit=dev -w server          # runtime deps only; shared is already bundled into dist
pm2 delete <old-process-name>        # stop the process pointing at the old clone
pm2 start server/dist/index.mjs --name threejs-shooter-server --cwd server
pm2 save
```

Node 22 is expected (`.nvmrc` at the repo root).

### Routine deploy (unchanged)

1. `npm run build:server` locally.
2. Commit `server/dist/index.mjs` and push to `origin master`.
3. `ssh <server>`, `cd threejs-shooter && git pull && npm ci --omit=dev -w server`, then `pm2 restart threejs-shooter-server`.
