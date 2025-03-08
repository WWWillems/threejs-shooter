# Three.js Shooter Game

A 3D first-person shooter game built with Three.js and Vite.

## Features (Planned)

- 3D environment with modern rendering
- First-person controls
- Shooter mechanics with physics
- Enemy AI
- Sound effects
- Score tracking

## Prerequisites

- Node.js (v14.x or higher)
- npm (v6.x or higher)

## Getting Started

1. Clone the repository:
```bash
git clone https://github.com/yourusername/threejs-shooter.git
cd threejs-shooter
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

## Development

This project uses:
- [Vite](https://vitejs.dev/) - Next generation frontend tooling
- [Three.js](https://threejs.org/) - JavaScript 3D library
- [TypeScript](https://www.typescriptlang.org/) - Typed JavaScript

## Project Structure

```
threejs-shooter/
├── public/             # Static assets
├── src/
│   ├── components/     # Game components
│   ├── models/         # 3D models
│   ├── utils/          # Utility functions
│   ├── main.ts         # Main entry point
│   └── style.css       # Global styles
├── index.html          # HTML entry point
├── package.json        # Project dependencies
├── tsconfig.json       # TypeScript configuration
└── README.md           # This file
```

## Controls

- WASD - Move
- Mouse - Look around
- Left Click - Shoot
- Spacebar - Jump
- Shift - Run

## License

MIT 