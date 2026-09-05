# @threejs-shooter/app

Vite + Three.js browser client. Part of the `threejs-shooter` monorepo; install from the repo root with `npm install`.

## Development

```bash
npm run dev:app           # from the repo root, http://localhost:5173
```

Set `VITE_SERVER_URL` to point at a game server (defaults to `http://localhost:3000`).

## Build

```bash
npm run build:app         # tsc && vite build -> app/dist (gitignored)
```

## Structure

```
app/
├── public/             # Static assets
├── src/
│   ├── api/            # socket.io-client connection and REST helpers
│   ├── components/     # Game components (player, weapons, pickups, HUD, ...)
│   ├── core/           # Scene, game loop, ground, player
│   ├── environment/    # Map layout and environment builder
│   ├── events/         # Client-side event emitter and networked entities
│   ├── utils/          # Utility functions
│   ├── main.ts         # Entry point
│   └── style.css       # Global styles
├── index.html
├── package.json
└── tsconfig.json
```

Socket event names and payload types come from `@threejs-shooter/shared`.
See the root [README](../README.md) for controls and the overall layout.
