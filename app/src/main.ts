import { setCharacterTeam } from './components/CharacterVisual';
import "./style.css";
import * as THREE from "three";
import { IsometricControls } from "./components/IsometricControls";
import { HUD } from "./components/HUD";
import { PickupManager } from "./components/PickupManager";
import { CrateSync } from "./components/CrateSync";
import { FlashOverlay } from "./components/FlashOverlay";
import { GrenadeClouds } from "./components/GrenadeClouds";
import { GrenadeRenderer } from "./components/GrenadeRenderer";
import { MainMenu } from "./components/MainMenu";
import { MatchPhaseUi } from "./components/MatchPhaseUi";
import { RemotePlayerManager } from "./components/RemotePlayerManager";
import { PlayerCollider } from "./components/PlayerCollider";
import type { CollisionDetector } from "./components/CollisionInterface";
import { GAME_EVENTS, TICK_RATE, type Team } from "@threejs-shooter/shared";
import { GameScene } from "./core/Scene";
import { CityAtmosphere } from "./environment/CityAtmosphere";
import { Ground } from "./core/Ground";
import { Player } from "./core/Player";
import { WorldInteractions } from "./components/WorldInteractions";
import { EnvironmentBuilder } from "./environment/EnvironmentBuilder";
import { WorldColliders } from "./environment/WorldColliders";
import { GameLoop } from "./core/GameLoop";
import { NetworkClient } from "./net/NetworkClient";
import { Replication } from "./net/Replication";
import { loadClientLevel } from "./levelLoader";
import { sfx } from "./audio/sfx";

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
const map = loadClientLevel();
const world = new WorldColliders(map);

// The local player has no position of its own until the server assigns a team
// and a spawn (see the GAME.STATE handler below).

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
const cityAtmosphere=new CityAtmosphere(scene,map,player);
new CrateSync(net, world, environmentBuilder, map);

// Grenades are server-simulated; this draws them from the snapshot stream,
// the clouds smoke and gas leave behind, and the white-out when we are flashed.
const flashOverlay = new FlashOverlay(document.body);
const grenadeRenderer = new GrenadeRenderer(scene, net, replication, flashOverlay);
const grenadeClouds = new GrenadeClouds(scene, replication, camera);

// MatchPhaseUi updates this alongside the server's phase. World interactions
// must use the same combat gate as weapons and grenades, including round-end.
let combatAllowed = false;
const interactions = new WorldInteractions(map, environmentBuilder, world, net, player, camera,
  () => inWorld && combatAllowed && !controls.getPlayerController().getHealth().isDead);
controls.getInputManager().onInteract(()=>interactions.interact());
remotePlayerManager.setConcealmentTest(position=>interactions.obscuresNameplate(position) || grenadeClouds.obscures(position));

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
  player,
  () => gameScene.render(),
  dt => {
    cityAtmosphere.update(dt);
    interactions.update(dt);
    grenadeClouds.update(dt);
    flashOverlay.update(dt);
  }
);

const playerPosition = () => ({
  x: player.position.x,
  y: player.position.y,
  z: player.position.z,
});

// True once the server has placed us in the world (see the GAME.STATE handler).
let inWorld = false;
// True during the round countdown: everyone stands still at spawn.
let frozen = false;
// The team the server last put us on, to notice a re-join that switched sides.
let currentTeam: Team | null = null;

// Controls run only once we are in the world and the match is not frozen.
const applyControlsState = () => {
  if (inWorld && !frozen) controls.enableControls();
  else controls.disableControls();
};

// Round clock, countdown and round-end board; drives the freeze and combat gate.
new MatchPhaseUi(document.body, net, {
  setFrozen: (value) => {
    frozen = value;
    applyControlsState();
  },
  setCombatAllowed: (allowed) => {
    combatAllowed = allowed;
    controls.getPlayerController().setCombatAllowed(allowed);
  },
  hideDeathOverlay: () => hud.hideDeathOverlay(),
});

// Report our position to the server at the tick rate while alive, so every
// snapshot the server sends carries a fresh report (see Replication).
setInterval(() => {
  const playerController = controls.getPlayerController();
  if (inWorld && !playerController.getHealth().isDead) {
    net.send(GAME_EVENTS.PLAYER.POSITION, {
      position: playerPosition(),
      rotation: player.rotation.y,
      pose: playerController.getPresentationPose(),
    });
  }
}, 1000 / TICK_RATE);

// Create the main menu. Start Game sends the join intent; the player only
// enters the world once the server has answered with a team and a spawn.
const mainMenu = new MainMenu(document.body, (nickname) => {
  sfx.unlock();
  sfx.setListener(camera, player);

  playerSystem.setNickname(nickname);
  hud.updateNickname(nickname);

  // NetworkClient re-joins automatically after a reconnect
  net.join(nickname);
});

net.on(GAME_EVENTS.GAME.STATE, ({ selfId, players }) => {
  const self = players.find((p) => p.id === selfId);
  if (!self?.position) return;

  // Stand where the server put us: on our team's spawn street. On a re-join
  // after a reconnect this is a fresh spawn, possibly on the other team.
  controls.getPlayerController().spawnAt(self.position, self.rotation, self.hp);
  controls.getPlayerController().applyServerArmor(self.armor ?? 0);
  flashOverlay.clear();
  const firstSync = !inWorld;
  if (firstSync) {
    inWorld = true;
    playerSystem.addToScene(scene);
  }
  applyControlsState();
  // The same message also arrives on every round reset; the toast is for
  // joins (and re-joins that landed us on the other team) only.
  if (firstSync || self.team !== currentTeam) hud.showTeamAssigned(self.team);
  currentTeam = self.team;
  setCharacterTeam(player,self.team);
});

net.on(GAME_EVENTS.USER.JOIN_REJECTED, ({ reason }) => {
  switch (reason) {
    case "room-full":
      mainMenu.showError("Server full (5 v 5). Try again in a moment.");
      break;
    default: {
      const unhandled: never = reason;
      mainMenu.showError(`Could not join: ${String(unhandled)}`);
    }
  }
  mainMenu.show();
});

// Start the game loop immediately
gameLoop.start();
