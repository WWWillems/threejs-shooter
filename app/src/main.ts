import "./style.css";
import * as THREE from "three";
import { IsometricControls } from "./components/IsometricControls";
import { HUD } from "./components/HUD";
import { PickupManager } from "./components/PickupManager";
import { CrateSync } from "./components/CrateSync";
import { GrenadeRenderer } from "./components/GrenadeRenderer";
import { StartOverlay } from "./components/StartOverlay";
import { RemotePlayerManager } from "./components/RemotePlayerManager";
import { PlayerCollider } from "./components/PlayerCollider";
import type { CollisionDetector } from "./components/CollisionInterface";
import { GAME_EVENTS, TICK_RATE, generateMap } from "@threejs-shooter/shared";
import { GameScene } from "./core/Scene";
import { Ground } from "./core/Ground";
import { Player } from "./core/Player";
import { EnvironmentBuilder } from "./environment/EnvironmentBuilder";
import { WorldColliders } from "./environment/WorldColliders";
import { GameLoop } from "./core/GameLoop";
import { NetworkClient } from "./net/NetworkClient";
import { Replication } from "./net/Replication";

// Connect to the game server
const net = NetworkClient.connect(
  import.meta.env.VITE_SERVER_URL || "http://localhost:3000"
);

// Buffer the server's snapshot stream for smooth interpolated rendering
const replication = new Replication();
net.on(GAME_EVENTS.WORLD.SNAPSHOT, (snapshot) => {
  replication.push(snapshot, performance.now());
});

// Initialize the core game systems
const gameScene = new GameScene();
const scene = gameScene.scene;
const camera = gameScene.camera;
const renderer = gameScene.renderer;

// Add lighting to the scene
gameScene.addLights();

// Create the ground
const ground = new Ground(scene);

// Create the player without adding to scene initially
const playerSystem = new Player(scene, false);
const player = playerSystem.getMesh();

// The shared map: the server simulates exactly this world. Colliders come
// from it directly, never from meshes.
const map = generateMap();
const world = new WorldColliders(map);

// Cosmetic bullets stop on the world and on any player. Evaluated per frame,
// after `remotePlayerManager` (declared below) exists.
const bulletStops: CollisionDetector = {
  checkForBulletCollision: (point) =>
    world.stopsBullet(point) ||
    PlayerCollider.containsPoint(player, point) ||
    remotePlayerManager.containsPoint(point),
};

// Initialize controls
const controls = new IsometricControls(
  camera,
  renderer.domElement,
  player,
  net,
  scene,
  {
    world,
    bulletStops,
    remotePlayerMeshes: (): THREE.Object3D[] =>
      [...remotePlayerManager.getPlayers().values()].map((p) => p.mesh),
  }
);

// Disable player input initially
controls.disableControls();

// Initialize HUD
const hud = new HUD(document.body, controls, net);

// Store HUD reference in scene.userData
scene.userData.hud = hud;

// Initialize RemotePlayerManager
const remotePlayerManager = new RemotePlayerManager(
  scene,
  hud,
  net,
  replication,
  bulletStops
);

// Pickups are server-owned; this renders them and sends claim intents
const pickupManager = new PickupManager(
  scene,
  player,
  controls.getPlayerController(),
  net,
  hud
);

// Set pickup manager in controls (dropped weapons)
controls.setPickupManager(pickupManager);

// Render the shared map, then mirror crate HP and destruction from the server
const environmentBuilder = new EnvironmentBuilder(scene, map);
environmentBuilder.buildEnvironment();
new CrateSync(net, world, environmentBuilder, map);

// Grenades are server-simulated; this draws them from the snapshot stream
const grenadeRenderer = new GrenadeRenderer(scene, net, replication);

// Initialize the game loop
const gameLoop = new GameLoop(
  scene,
  camera,
  renderer,
  controls,
  hud,
  pickupManager,
  remotePlayerManager,
  grenadeRenderer,
  player
);

const playerPosition = () => ({
  x: player.position.x,
  y: player.position.y,
  z: player.position.z,
});

// Report our position to the server at the tick rate while alive, so every
// snapshot the server sends carries a fresh report (see Replication).
setInterval(() => {
  const playerController = controls.getPlayerController();
  if (playerController && !playerController.getHealth().isDead) {
    net.send(GAME_EVENTS.PLAYER.POSITION, {
      position: playerPosition(),
      rotation: player.rotation.y,
    });
  }
}, 1000 / TICK_RATE);

// Create the start overlay
const startOverlay = new StartOverlay(document.body, (nickname) => {
  // This will be called when the Start Game button is clicked

  // Add player mesh to the scene when the game starts
  playerSystem.addToScene(scene);

  // Enable player controls when the game starts
  controls.enableControls();

  // Set player nickname
  playerSystem.setNickname(nickname);

  // Update HUD with nickname
  hud.updateNickname(nickname);

  // Join the game; NetworkClient re-joins automatically after a reconnect
  net.join(nickname, playerPosition);
});

// Start the game loop immediately
gameLoop.start();
