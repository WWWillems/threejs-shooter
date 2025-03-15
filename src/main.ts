import "./style.css";
import * as THREE from "three";
import { IsometricControls } from "./components/IsometricControls";
import { HUD } from "./components/HUD";
import { PickupManager } from "./components/PickupManager";

import { RemotePlayerManager } from "./components/RemotePlayerManager";
import { EventEmitter } from "./events/eventEmitter";
import { GAME_EVENTS } from "./events/constants";
import { GameScene } from "./core/Scene";
import { Ground } from "./core/Ground";
import { Player } from "./core/Player";
import { EnvironmentBuilder } from "./environment/EnvironmentBuilder";
import { GameLoop } from "./core/GameLoop";

// Initialize the core game systems
const gameScene = new GameScene();
const scene = gameScene.scene;
const camera = gameScene.camera;
const renderer = gameScene.renderer;

// Add lighting to the scene
gameScene.addLights();

// Create the ground
const ground = new Ground(scene);

// Create the player
const playerSystem = new Player(scene);
const player = playerSystem.getMesh();

// Initialize controls
const controls = new IsometricControls(camera, renderer.domElement, player);

// Initialize HUD
const hud = new HUD(document.body, controls);

// Store HUD reference in scene.userData
scene.userData.hud = hud;

// Initialize RemotePlayerManager
const remotePlayerManager = new RemotePlayerManager(scene, hud);

// Update controls with RemotePlayerManager
controls.updateCollisionSystem(remotePlayerManager);

// Set collision detector for RemotePlayerManager
remotePlayerManager.setCollisionDetector(controls.getCollisionSystem());

// Initialize pickup manager
const pickupManager = new PickupManager(
  scene,
  player,
  controls.getPlayerController(),
  hud,
  controls.getCollisionSystem()
);

// Set pickup manager in controls
controls.setPickupManager(pickupManager);

// Build the environment
const environmentBuilder = new EnvironmentBuilder(scene, controls);
environmentBuilder.buildEnvironment();

// Store decoration cubes for animation
// These will be handled by the environment builder in the future
// For now, we'll keep them separate for the animation
const cube1 = createCube(1, 0xff4444, -8, 1.5, -12);
const cube2 = createCube(1, 0x44ff44, 10, 1.5, 14);
const cube3 = createCube(1, 0x4444ff, 15, 1.5, -10);
scene.add(cube1, cube2, cube3);

const decorationCubes = [cube1, cube2, cube3];

// Create a helper function for cubes
function createCube(
  size: number,
  color: number,
  x: number,
  y: number,
  z: number
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(size, size, size);
  const material = new THREE.MeshStandardMaterial({ color });
  const cube = new THREE.Mesh(geometry, material);
  cube.position.set(x, y, z);
  cube.castShadow = true;
  cube.receiveShadow = true;
  return cube;
}

// Initialize the game loop
const gameLoop = new GameLoop(
  scene,
  camera,
  renderer,
  controls,
  hud,
  pickupManager,
  remotePlayerManager,
  player,
  decorationCubes
);

// Start the game loop
gameLoop.start();

// Setup event emission for player position
const eventEmitter = EventEmitter.getInstance();

setInterval(() => {
  eventEmitter.emit(GAME_EVENTS.PLAYER.POSITION, {
    position: {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
    },
    rotation: player.rotation.y,
  });
}, 100);

//socket.emit("ping", "Ja hallo zeg");
