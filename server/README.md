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

### Routine deploy

The routine can be run as one command from a clean local checkout:

```bash
npm run deploy:server
```

The helper defaults to the `bang-bang-api` SSH host or alias from `~/.ssh/config`.
It verifies that the checkout is on `master` and clean, builds the committed server
bundle, pushes it, then checks out `master`, runs `git pull --ff-only`,
`npm ci --omit=dev -w server`, and `pm2 restart threejs-shooter-server` remotely.
Set `DEPLOY_HOST` to override the default.

You can override the remote path or PM2 process name when needed:

```bash
DEPLOY_HOST=bang-bang-api \
DEPLOY_PATH=/var/www/bang-bang-game \
DEPLOY_PROCESS=threejs-shooter-server \
npm run deploy:server
```
