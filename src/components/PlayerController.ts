import * as THREE from "three";
import type { InputManager } from "./InputManager";
import type { CollisionSystem } from "./CollisionSystem";
import type { CameraController } from "./CameraController";
import type { WeaponSystem } from "./Weapon";
import { WeaponType } from "./Weapon";
import type { Weapon } from "./Weapon";

/**
 * Player movement settings
 */
interface PlayerMovementSettings {
  speed: number;
  crouchSpeed: number;
  runSpeed: number;
  jumpStrength: number;
  gravity: number;
}

/**
 * Player dimensions
 */
interface PlayerDimensions {
  normalHeight: number;
  crouchHeight: number;
}

/**
 * Controls player character state and movement
 */
export class PlayerController {
  // Player state
  private moveForward = false;
  private moveBackward = false;
  private moveLeft = false;
  private moveRight = false;
  private canJump = false;
  private isCrouching = false;
  private isRunning = false;

  // Physics
  private velocity = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private prevTime = performance.now();

  // Health system
  private maxHealth = 100;
  private currentHealth = 100;
  private isDead = false;

  // Movement settings
  private speed: number;
  private crouchSpeed: number;
  private runSpeed: number;
  private jumpStrength: number;
  private gravity: number;

  // Player dimensions
  private normalHeight: number;
  private crouchHeight: number;

  // Store a reference to the camera
  private camera: THREE.Camera;

  constructor(
    private player: THREE.Mesh,
    private scene: THREE.Scene,
    private inputManager: InputManager,
    private collisionSystem: CollisionSystem,
    private cameraController: CameraController,
    private weaponSystem: WeaponSystem,
    movementSettings?: Partial<PlayerMovementSettings>,
    dimensions?: Partial<PlayerDimensions>
  ) {
    // Set movement settings with defaults
    this.speed = movementSettings?.speed || 10.0;
    this.crouchSpeed = movementSettings?.crouchSpeed || 5.0;
    this.runSpeed = movementSettings?.runSpeed || 20.0;
    this.jumpStrength = movementSettings?.jumpStrength || 5.0;
    this.gravity = movementSettings?.gravity || 30.0;

    // Set player dimensions with defaults
    this.normalHeight = dimensions?.normalHeight || 2;
    this.crouchHeight = dimensions?.crouchHeight || 1;

    // Get the camera from the CameraController
    this.camera = this.cameraController.camera;

    // Store reference to this controller in player's userData
    this.player.userData.controller = this;

    // Setup input callbacks
    this.setupInputCallbacks();
  }

  /**
   * Setup event listeners for input controls
   */
  private setupInputCallbacks(): void {
    // Mouse movement for rotation
    this.inputManager.onMouseMove((mousePos) => {
      this.updatePlayerRotation(mousePos);
      this.weaponSystem.updateWeaponPosition(this.isCrouching);
    });

    // Weapon controls
    this.inputManager.onShoot(() => {
      this.weaponSystem.shoot(this.scene);
    });

    this.inputManager.onReload(() => {
      this.weaponSystem.reload();
    });

    this.inputManager.onWeaponSwitch((index) => {
      if (index >= 0) {
        this.weaponSystem.switchToWeapon(index);
      } else if (index === -1) {
        this.weaponSystem.previousWeapon();
      } else if (index === -2) {
        this.weaponSystem.nextWeapon();
      }
    });
  }

  /**
   * Update player state and position
   */
  public update(): void {
    const time = performance.now();
    const delta = (time - this.prevTime) / 1000;

    // Check input state
    this.moveForward = this.inputManager.isKeyPressed("KeyW");
    this.moveBackward = this.inputManager.isKeyPressed("KeyS");
    this.moveLeft = this.inputManager.isKeyPressed("KeyA");
    this.moveRight = this.inputManager.isKeyPressed("KeyD");

    // Handle crouching
    const wasCrouching = this.isCrouching;
    this.isCrouching =
      this.inputManager.isKeyPressed("ControlLeft") ||
      this.inputManager.isKeyPressed("ControlRight");

    // Handle running (only if not crouching)
    this.isRunning =
      !this.isCrouching &&
      (this.inputManager.isKeyPressed("ShiftLeft") ||
        this.inputManager.isKeyPressed("ShiftRight"));

    // Handle jumping
    if (this.canJump && this.inputManager.isKeyPressed("Space")) {
      this.velocity.y = this.jumpStrength;
      this.canJump = false;
    }

    // Update crouching state if changed
    if (wasCrouching !== this.isCrouching) {
      if (this.isCrouching) {
        this.crouch();
      } else {
        this.standUp();
      }
    }

    // Check if reloading is complete
    if (this.weaponSystem.isReloading()) {
      if (this.weaponSystem.checkReloadProgress(time)) {
        this.weaponSystem.completeReload();
      }
    }

    // Update player rotation based on mouse position
    this.updatePlayerRotation(this.inputManager.getMousePosition());

    // Update weapon position
    this.weaponSystem.updateWeaponPosition(this.isCrouching);

    // Apply gravity
    this.velocity.y -= this.gravity * delta;

    // Direction calculation for movement
    this.calculateMovementDirection();

    // Apply movement speed based on state
    this.applyMovement(delta);

    // Update camera position to follow player
    this.cameraController.updateCameraPosition(this.isCrouching);

    // Update bullets with collision detection
    this.weaponSystem.updateBullets(delta, this.collisionSystem);

    this.prevTime = time;
  }

  /**
   * Calculate movement direction based on input and camera angle
   */
  private calculateMovementDirection(): void {
    this.direction.set(0, 0, 0);

    // Create vectors for camera-aligned movement
    const cameraAngle = Math.PI / 4; // 45 degrees, matching the camera's angle

    // Define movement directions based on camera perspective
    const forwardDir = new THREE.Vector3(
      -Math.sin(cameraAngle),
      0,
      -Math.cos(cameraAngle)
    );

    const rightDir = new THREE.Vector3(
      Math.cos(cameraAngle),
      0,
      -Math.sin(cameraAngle)
    );

    // Apply movement based on camera-aligned directions
    if (this.moveForward) {
      this.direction.add(forwardDir);
    }
    if (this.moveBackward) {
      this.direction.sub(forwardDir);
    }
    if (this.moveRight) {
      this.direction.add(rightDir);
    }
    if (this.moveLeft) {
      this.direction.sub(rightDir);
    }

    // Normalize direction if moving diagonally
    if (this.direction.lengthSq() > 0) {
      this.direction.normalize();
    }
  }

  /**
   * Apply movement with collision detection
   */
  private applyMovement(delta: number): void {
    // Apply movement speed based on state
    let currentSpeed = this.speed;
    if (this.isCrouching) {
      currentSpeed = this.crouchSpeed;
    } else if (this.isRunning) {
      currentSpeed = this.runSpeed;
    }

    // Set velocity from direction
    this.velocity.x = this.direction.x * currentSpeed;
    this.velocity.z = this.direction.z * currentSpeed;

    // Store original position for collision detection
    const originalPosition = this.player.position.clone();

    // Test X movement
    const newPositionX = new THREE.Vector3(
      originalPosition.x + this.velocity.x * delta,
      originalPosition.y,
      originalPosition.z
    );

    // Get current player height for collision detection
    const playerHeight = this.isCrouching
      ? this.crouchHeight
      : this.normalHeight;

    // Apply X movement only if there's no collision
    if (
      !this.collisionSystem.checkPlayerCollision(newPositionX, playerHeight)
    ) {
      this.player.position.x = newPositionX.x;
    }

    // Apply Y movement (gravity/jumping)
    this.player.position.y += this.velocity.y * delta;

    // Test Z movement
    const newPositionZ = new THREE.Vector3(
      this.player.position.x,
      this.player.position.y,
      originalPosition.z + this.velocity.z * delta
    );

    // Apply Z movement only if there's no collision
    if (
      !this.collisionSystem.checkPlayerCollision(newPositionZ, playerHeight)
    ) {
      this.player.position.z = newPositionZ.z;
    }

    // Simple ground collision detection
    if (this.player.position.y < playerHeight / 2) {
      // Player should not go below y=playerHeight/2 (half player height above ground)
      this.velocity.y = 0;
      this.player.position.y = playerHeight / 2;
      this.canJump = true;
    }
  }

  /**
   * Update player rotation to face mouse position
   */
  private updatePlayerRotation(mousePosition: THREE.Vector2): void {
    // Create raycaster for mouse position
    const raycaster = new THREE.Raycaster();

    // Use the camera directly instead of looking it up from the scene
    raycaster.setFromCamera(mousePosition, this.camera);

    // Find the point of intersection with the ground plane
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const targetPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, targetPoint);

    // Calculate the direction the player should face
    const direction = new THREE.Vector3()
      .subVectors(targetPoint, this.player.position)
      .setY(0) // Ensure we only rotate in the XZ plane
      .normalize();

    // Skip if the direction is too small (mouse is directly over player)
    if (direction.lengthSq() < 0.001) return;

    // Calculate the angle to rotate the player
    const angle = Math.atan2(direction.x, direction.z);

    // Rotate the player to face the mouse
    // Add PI (180 degrees) to make the player face toward the mouse instead of away from it
    this.player.rotation.y = angle + Math.PI;
  }

  /**
   * Change player to crouching position
   */
  private crouch(): void {
    if (this.player.geometry instanceof THREE.BoxGeometry) {
      this.player.geometry.dispose();
      const newGeometry = new THREE.BoxGeometry(1, this.crouchHeight, 1);
      this.player.geometry = newGeometry;
    }

    this.player.position.y -= (this.normalHeight - this.crouchHeight) / 2;

    // Update weapon position when crouching
    this.weaponSystem.updateWeaponPosition(true);
  }

  /**
   * Change player to standing position
   */
  private standUp(): void {
    if (this.player.geometry instanceof THREE.BoxGeometry) {
      this.player.geometry.dispose();
      const newGeometry = new THREE.BoxGeometry(1, this.normalHeight, 1);
      this.player.geometry = newGeometry;
    }

    this.player.position.y += (this.normalHeight - this.crouchHeight) / 2;

    // Update weapon position when standing up
    this.weaponSystem.updateWeaponPosition(false);
  }

  /**
   * Get current weapon ammo info for HUD
   */
  public getAmmoInfo() {
    return this.weaponSystem.getAmmoInfo();
  }

  /**
   * Get weapon inventory for HUD
   */
  public getInventory() {
    return this.weaponSystem.getInventory();
  }

  /**
   * Get current weapon index for HUD
   */
  public getCurrentWeaponIndex(): number {
    return this.weaponSystem.getCurrentWeaponIndex();
  }

  /**
   * Get current crouch state
   */
  public getCrouchState(): boolean {
    return this.isCrouching;
  }

  /**
   * Get current player height
   */
  public getPlayerHeight(): number {
    return this.isCrouching ? this.crouchHeight : this.normalHeight;
  }

  /**
   * Take damage from an attack
   */
  public takeDamage(amount: number): void {
    if (this.isDead) return;

    this.currentHealth = Math.max(0, this.currentHealth - amount);

    // Show damage notification in HUD
    const hud = this.scene.userData.hud;
    if (hud) {
      hud.showNotification(
        "damage-taken",
        "Damage Taken",
        `Took ${amount} damage`,
        "💥"
      );
    }

    if (this.currentHealth <= 0) {
      this.isDead = true;
      // Handle player death - make player fall to the floor
      console.log("Player died!");

      // Force player to stop moving
      this.velocity.set(0, 0, 0);

      // Make player fall to the floor
      this.player.position.y = 0.5; // Set player close to ground

      // Dispatch death event
      const deathEvent = new CustomEvent("player-death");
      document.dispatchEvent(deathEvent);

      // Disable input
      this.inputManager.disableKeyboardInput();
      this.inputManager.disableMouseInput();
    }
  }

  /**
   * Get the player's current health
   */
  public getHealth(): { current: number; max: number; isDead: boolean } {
    return {
      current: this.currentHealth,
      max: this.maxHealth,
      isDead: this.isDead,
    };
  }

  public heal(amount: number): void {
    if (this.isDead) return;

    this.currentHealth = Math.min(this.maxHealth, this.currentHealth + amount);
  }

  public resurrect(): void {
    this.currentHealth = this.maxHealth;
    this.isDead = false;

    // Re-enable input
    this.inputManager.enableKeyboardInput();
    this.inputManager.enableMouseInput();

    // Reset position (stand up)
    this.player.position.y = 1;
  }

  /**
   * Add ammo to a specific weapon type
   * @param weaponType The type of weapon to add ammo to
   * @param amount The amount of ammo to add
   */
  public addAmmo(weaponType: WeaponType, amount: number): void {
    // Get the weapon inventory
    const inventory = this.weaponSystem.getInventory();

    // Find the weapon by name (case insensitive)
    // Since WeaponType enum values are lowercase but Weapon names are capitalized,
    // we need to convert the enum value to match the expected weapon name format
    let weaponName: string;

    switch (weaponType) {
      case WeaponType.PISTOL:
        weaponName = "Pistol";
        break;
      case WeaponType.RIFLE:
        weaponName = "Assault Rifle";
        break;
      case WeaponType.SHOTGUN:
        weaponName = "Shotgun";
        break;
      case WeaponType.SNIPER:
        weaponName = "Sniper";
        break;
      default:
        weaponName = weaponType;
    }

    const weapon = inventory.find((w) => w.name === weaponName);

    if (weapon) {
      // Add ammo to the weapon's total bullets
      weapon.totalBullets += amount;
      console.log(
        `Added ${amount} ammo to ${weaponName}. Total: ${weapon.totalBullets}`
      );
    } else {
      console.warn(`No weapon found with name: ${weaponName}`);
    }
  }

  /**
   * Add a weapon to the player's inventory
   * @param weapon The weapon to add
   * @returns True if weapon was added successfully, false otherwise
   */
  public addWeapon(weapon: Weapon): boolean {
    // Delegate to the weapon system to add the weapon to inventory
    return this.weaponSystem.addWeapon(weapon);
  }

  /**
   * Select a weapon by index
   * @param index The index of the weapon to select
   */
  public selectWeapon(index: number): void {
    this.weaponSystem.switchToWeapon(index);
  }

  /**
   * Update the collision system reference
   */
  public updateCollisionSystem(collisionSystem: CollisionSystem): void {
    this.collisionSystem = collisionSystem;
  }
}
