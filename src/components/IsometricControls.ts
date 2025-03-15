import type * as THREE from "three";
import { WeaponSystem } from "./Weapon";
import type { Weapon } from "./Weapon";
import { Car } from "./Car";
import type { CollisionDetector } from "./CollisionInterface";
import { InputManager } from "./InputManager";
import { CollisionSystem } from "./CollisionSystem";
import { CameraController } from "./CameraController";
import { PlayerController } from "./PlayerController";
import { DebugVisualizer } from "./DebugVisualizer";
import { StreetLight } from "./StreetLight";
import { WoodenCrate } from "./WoodenCrate";
import type { PickupManager } from "./PickupManager";
import type { RemotePlayerManager } from "./RemotePlayerManager";

/**
 * Main game controls class using composition pattern to integrate all systems
 */
export class IsometricControls implements CollisionDetector {
  // Core game objects
  public camera: THREE.Camera;
  public scene: THREE.Scene;
  public player: THREE.Mesh;

  // Component systems using composition
  private inputManager: InputManager;
  private collisionSystem: CollisionSystem;
  private cameraController: CameraController;
  private weaponSystem: WeaponSystem;
  private playerController: PlayerController;
  private debugVisualizer: DebugVisualizer;
  private pickupManager?: PickupManager;
  private remotePlayerManager?: RemotePlayerManager;

  // Track if controls are enabled
  private enabled = true;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLCanvasElement,
    player: THREE.Mesh,
    remotePlayerManager?: RemotePlayerManager
  ) {
    this.camera = camera;
    this.player = player;
    this.scene = player.parent as THREE.Scene;
    this.remotePlayerManager = remotePlayerManager;

    // Initialize component systems
    this.inputManager = new InputManager(domElement);
    this.collisionSystem = new CollisionSystem(
      remotePlayerManager,
      this.player
    );
    this.cameraController = new CameraController(camera, player);
    this.weaponSystem = new WeaponSystem(this.scene, this.player);
    this.playerController = new PlayerController(
      player,
      this.scene,
      this.inputManager,
      this.collisionSystem,
      this.cameraController,
      this.weaponSystem
    );

    // Store reference to the player controller in player's userData
    this.player.userData.controller = this.playerController;

    this.debugVisualizer = new DebugVisualizer(
      this.scene,
      this.collisionSystem,
      player,
      remotePlayerManager
    );

    // Set up debug visualization toggle
    document.addEventListener("keydown", (event) => {
      if (event.code === "KeyB") {
        this.debugVisualizer.toggleDebugMode();
      }
    });
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
      // Pass current player height to debug visualizer
      this.debugVisualizer.setPlayerHeight(
        this.playerController.getPlayerHeight()
      );
      this.debugVisualizer.updateDebugVisualization();
    }
  }

  /**
   * Implement CollisionDetector interface method
   */
  public checkForBulletCollision(bulletPosition: THREE.Vector3): boolean {
    return this.collisionSystem.checkForBulletCollision(bulletPosition);
  }

  /**
   * Add a car to the scene and collision system
   */
  public addCarToScene(position: THREE.Vector3): THREE.Group {
    const car = Car.addToScene(this.scene, position);
    this.collisionSystem.addCar(car);
    return car;
  }

  /**
   * Add a street light to the scene and collision system
   */
  public addStreetLightToScene(position: THREE.Vector3): THREE.Group {
    const streetLight = StreetLight.addToScene(this.scene, position);
    this.collisionSystem.addStreetLight(streetLight);
    return streetLight;
  }

  /**
   * Add a wooden crate to the scene and collision system
   */
  public addWoodenCrateToScene(
    position: THREE.Vector3,
    size = 1.5,
    rotation = 0
  ): THREE.Group {
    const crate = WoodenCrate.addToScene(
      this.scene,
      position,
      size,
      rotation,
      this.pickupManager
    );
    this.collisionSystem.addWoodenCrate(crate, size);
    return crate;
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
   * Get car colliders for collision detection
   */
  public getCarColliders() {
    return this.collisionSystem.getCarColliders();
  }

  /**
   * Get the player controller
   */
  public getPlayerController(): PlayerController {
    return this.playerController;
  }

  /**
   * Get the collision system
   */
  public getCollisionSystem(): CollisionSystem {
    return this.collisionSystem;
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
   * Get current gun (for backwards compatibility)
   */
  get gun(): THREE.Group {
    return this.weaponSystem.getCurrentWeapon().model;
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
   * Update the collision system with a new RemotePlayerManager
   */
  public updateCollisionSystem(remotePlayerManager: RemotePlayerManager): void {
    this.remotePlayerManager = remotePlayerManager;
    this.collisionSystem = new CollisionSystem(
      remotePlayerManager,
      this.player
    );

    // Update references to the new collision system
    this.playerController.updateCollisionSystem(this.collisionSystem);
    this.debugVisualizer.updateCollisionSystem(this.collisionSystem);
    this.debugVisualizer.updateRemotePlayerManager(remotePlayerManager);

    // Ensure the player's userData.controller is updated
    this.player.userData.controller = this.playerController;
  }
}
