import "./style.css";
import * as THREE from "three";
import { IsometricControls } from "./components/IsometricControls";
import { HUD } from "./components/HUD";
import { PickupManager } from "./components/PickupManager";
import { StartOverlay } from "./components/StartOverlay";
import { RemotePlayerManager } from "./components/RemotePlayerManager";
import { EventEmitter } from "./events/eventEmitter";
import { GAME_EVENTS } from "@threejs-shooter/shared";
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

// Create the player without adding to scene initially
const playerSystem = new Player(scene, false);
const player = playerSystem.getMesh();

// Initialize controls
const controls = new IsometricControls(
  camera,
  renderer.domElement,
  player,
  undefined,
  scene
);

// Disable player input initially
controls.disableControls();

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
  []
);

// Setup event emission for player position
const eventEmitter = EventEmitter.getInstance();

// Store EventEmitter in scene.userData for access elsewhere
scene.userData.eventEmitter = eventEmitter;

setInterval(() => {
  // Get player controller
  const playerController = controls.getPlayerController();

  // Only emit position updates if the player is alive
  if (playerController && !playerController.getHealth().isDead) {
    eventEmitter.emit(GAME_EVENTS.PLAYER.POSITION, {
      position: {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
      },
      rotation: player.rotation.y,
    });
  }
}, 100);

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

  // Emit USER.JOINED event with nickname
  eventEmitter.emit(GAME_EVENTS.USER.JOINED, {
    position: {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
    },
    name: nickname,
  });
});

// Start the game loop immediately
gameLoop.start();
