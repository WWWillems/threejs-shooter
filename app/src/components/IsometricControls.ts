import type * as THREE from "three";
import { WeaponSystem } from "./Weapon";
import type { Weapon } from "./Weapon";
import type { CollisionDetector } from "./CollisionInterface";
import { InputManager } from "./InputManager";
import { CameraController } from "./CameraController";
import { PlayerController } from "./PlayerController";
import { DebugVisualizer } from "./DebugVisualizer";
import type { PickupManager } from "./PickupManager";
import type { NetworkClient } from "../net/NetworkClient";
import type { WorldColliders } from "../environment/WorldColliders";

/** What the Local player's systems need from the rest of the game. */
export interface ControlsWorld {
  /** Static world + live crates + movement-only obstacles, from the shared map. */
  world: WorldColliders;
  /** Everything a cosmetic bullet stops on: the world plus players. */
  bulletStops: CollisionDetector;
  /** Remote player meshes, for the debug overlay's hitboxes. */
  remotePlayerMeshes: () => Iterable<THREE.Object3D>;
}

/**
 * Main game controls class using composition pattern to integrate all systems
 */
export class IsometricControls {
  // Core game objects
  public camera: THREE.Camera;
  public scene: THREE.Scene;
  public player: THREE.Mesh;

  // Component systems using composition
  private inputManager: InputManager;
  private cameraController: CameraController;
  private weaponSystem: WeaponSystem;
  private playerController: PlayerController;
  private debugVisualizer: DebugVisualizer;
  private pickupManager?: PickupManager;

  // Track if controls are enabled
  private enabled = true;
  private playerNickname = "Player";

  constructor(
    camera: THREE.Camera,
    domElement: HTMLCanvasElement,
    player: THREE.Mesh,
    net: NetworkClient,
    scene: THREE.Scene,
    { world, bulletStops, remotePlayerMeshes }: ControlsWorld
  ) {
    this.camera = camera;
    this.player = player;
    this.scene = scene;

    // Initialize component systems
    this.inputManager = new InputManager(domElement);
    this.cameraController = new CameraController(camera, player);
    this.weaponSystem = new WeaponSystem(this.scene, this.player, net);
    this.playerController = new PlayerController(
      player,
      this.scene,
      this.inputManager,
      world,
      bulletStops,
      this.cameraController,
      this.weaponSystem,
      net
    );

    // Store reference to the player controller in player's userData
    this.player.userData.controller = this.playerController;

    this.debugVisualizer = new DebugVisualizer(
      this.scene,
      world,
      player,
      remotePlayerMeshes
    );

    // Set up debug visualization toggle
    document.addEventListener("keydown", (event) => {
      if (event.code === "KeyB") {
        this.debugVisualizer.toggleDebugMode();
      }
    });
  }

  /**
   * Enable player controls
   */
  public enableControls(): void {
    this.enabled = true;
    this.inputManager.enableKeyboardInput();
    this.inputManager.enableMouseInput();
  }

  /**
   * Disable player controls
   */
  public disableControls(): void {
    this.enabled = false;
    this.inputManager.disableKeyboardInput();
    this.inputManager.disableMouseInput();
  }

  /**
   * Check if controls are currently enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update all game systems - called every frame
   */
  public update(): void {
    if (!this.enabled) return;

    // Update player controller (handles movement, physics and input)
    this.playerController.update();

    // Update debug visualization if enabled
    if (this.debugVisualizer.isDebugMode()) {
      this.debugVisualizer.updateDebugVisualization();
    }
  }

  /**
   * Get ammo info for HUD
   */
  public getAmmoInfo() {
    return this.playerController.getAmmoInfo();
  }

  /**
   * Get weapon inventory for HUD
   */
  public getInventory(): Weapon[] {
    return this.playerController.getInventory();
  }

  /**
   * Get current weapon index for HUD
   */
  public getCurrentWeaponIndex(): number {
    return this.playerController.getCurrentWeaponIndex();
  }

  /**
   * Get player health information
   */
  public getHealth(): { current: number; max: number; isDead: boolean } {
    return this.playerController.getHealth();
  }

  /**
   * Get player height (for collision detection)
   */
  public getPlayerHeight(): number {
    return this.playerController.getPlayerHeight();
  }

  /**
   * Get the player controller
   */
  public getPlayerController(): PlayerController {
    return this.playerController;
  }

  /**
   * Switch to a specific weapon by index
   */
  public switchToWeapon(index: number): void {
    this.weaponSystem.switchToWeapon(index);
  }

  /**
   * Drop the current weapon
   * @returns The dropped weapon or null if no weapon was dropped
   */
  public dropCurrentWeapon(): Weapon | null {
    return this.weaponSystem.dropCurrentWeapon();
  }

  /**
   * Set the pickup manager
   */
  public setPickupManager(pickupManager: PickupManager): void {
    this.pickupManager = pickupManager;

    // Pass the pickup manager to the weapon system
    if (this.weaponSystem) {
      this.weaponSystem.setPickupManager(pickupManager);
    }
  }

  /**
   * Get the input manager
   */
  public getInputManager(): InputManager {
    return this.inputManager;
  }

  /**
   * Get player nickname
   */
  public getPlayerNickname(): string {
    return this.playerNickname;
  }

  /**
   * Set player nickname
   */
  public setPlayerNickname(nickname: string): void {
    this.playerNickname = nickname;
  }
}
