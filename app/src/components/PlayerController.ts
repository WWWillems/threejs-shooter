import * as THREE from "three";
import { setCharacterCrouch } from "./CharacterVisual";
import type { InputManager } from "./InputManager";
import type { CollisionDetector } from "./CollisionInterface";
import type { WorldColliders } from "../environment/WorldColliders";
import { PlayerCollider } from "./PlayerCollider";
import type { CameraController } from "./CameraController";
import type { WeaponSystem } from "./Weapon";
import { WeaponType } from "./Weapon";
import type { Weapon } from "./Weapon";
import { GAME_EVENTS, GRENADE, type Vec3 } from "@threejs-shooter/shared";
import type { NetworkClient } from "../net/NetworkClient";

/**
 * Utility class for handling common player behaviors
 */
export class PlayerUtils {
  /**
   * Apply death animation to a player mesh
   * @param playerMesh The player mesh to animate
   */
  public static handlePlayerDeath(playerMesh: THREE.Object3D): void {
    // Make player fall over on the floor
    // Rotate 90 degrees around the X axis to lay flat on the ground
    playerMesh.rotation.x = Math.PI / 2;
    // Lower position to ground level
    playerMesh.position.y = 0.5;
  }
}

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
  private readonly groundPlane = new THREE.Plane(
    new THREE.Vector3(0, 1, 0),
    0
  );
  /** Point on the ground under the crosshair; null before the first mouse move. */
  private aimTarget: THREE.Vector3 | null = null;
  /** Local clock (ms) of the last grenade throw, for the client-side cooldown. */
  private lastGrenadeThrowAt = -Infinity;

  constructor(
    private player: THREE.Mesh,
    private scene: THREE.Scene,
    private inputManager: InputManager,
    private readonly world: WorldColliders,
    /** What cosmetic bullets stop on: the world plus other players. */
    private readonly bulletStops: CollisionDetector,
    private cameraController: CameraController,
    private weaponSystem: WeaponSystem,
    private net: NetworkClient,
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
    this.setupNetworkListeners();
  }

  /**
   * HP, death and respawn are owned by the server; we apply what it tells us.
   */
  private setupNetworkListeners(): void {
    this.net.on(GAME_EVENTS.COMBAT.HIT, ({ targetId, damage, hp }) => {
      if (targetId !== this.net.selfId) return;
      this.applyServerHit(damage, hp);
    });

    this.net.on(GAME_EVENTS.PLAYER.RESPAWN, ({ playerId, position, rotation, hp }) => {
      if (playerId !== this.net.selfId) return;
      this.applyServerRespawn(position, rotation, hp);
    });
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

    // Track mouse state for automatic weapons
    this.inputManager.onMouseDown(() => {
      this.weaponSystem.setMouseDown(true);
    });

    this.inputManager.onMouseUp(() => {
      this.weaponSystem.setMouseDown(false);
    });

    this.inputManager.onReload(() => {
      this.weaponSystem.reload();
    });

    this.inputManager.onThrowGrenade(() => {
      this.throwGrenade();
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
    // Skip updates if player is dead
    if (this.isDead) return;

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
    const cameraFocusY =
      this.player.position.y +
      (this.isCrouching ? (this.normalHeight - this.crouchHeight) / 2 : 0);
    this.cameraController.updateCameraPosition(cameraFocusY);
    // Recalculate after the camera moves so a stationary crosshair remains
    // accurate while the player is moving.
    this.camera.updateMatrixWorld();
    this.updatePlayerRotation(this.inputManager.getMousePosition());

    // Update bullets with collision detection
    this.weaponSystem.updateBullets(delta, this.bulletStops);

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
    if (!this.blockedAt(newPositionX, playerHeight)) {
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
    if (!this.blockedAt(newPositionZ, playerHeight)) {
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
    const targetPoint = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(this.groundPlane, targetPoint)) {
      return;
    }
    this.aimTarget = targetPoint.clone();
    this.weaponSystem.setAimTarget(targetPoint);

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
    setCharacterCrouch(this.player, true);
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
    setCharacterCrouch(this.player, false);
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
   * Apply a server-resolved hit on the local player.
   */
  private applyServerHit(damage: number, hp: number): void {
    this.currentHealth = hp;

    // Show damage notification in HUD
    const hud = this.scene.userData.hud;
    if (hud) {
      hud.showNotification(
        "damage-taken",
        "Damage Taken",
        `Took ${damage} damage`,
        "💥"
      );
    }

    if (hp <= 0 && !this.isDead) {
      this.isDead = true;

      // Force player to stop moving
      this.velocity.set(0, 0, 0);

      // Apply death animation
      PlayerUtils.handlePlayerDeath(this.player);

      // Dispatch death event (HUD shows the overlay)
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

  /** Adopt an HP value the server reported (e.g. after a health pickup). */
  public applyServerHp(hp: number): void {
    if (this.isDead) return;
    this.currentHealth = Math.min(this.maxHealth, Math.max(0, hp));
  }

  /**
   * Send a grenade throw intent towards the crosshair. The grenade itself is
   * simulated by the server and shows up in world snapshots.
   */
  private throwGrenade(): void {
    if (this.isDead) return;
    const now = performance.now();
    if (now - this.lastGrenadeThrowAt < GRENADE.throwCooldown * 1000) return;
    this.lastGrenadeThrowAt = now;

    // Release from chest height, just in front of the player
    const origin = this.player.position.clone();
    origin.y += 0.5;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.player.quaternion
    );
    origin.addScaledVector(forward, 0.8);

    const direction = this.aimTarget
      ? this.aimTarget.clone().sub(origin).setY(0)
      : forward;
    if (direction.lengthSq() < 1e-6) direction.copy(forward);
    direction.normalize();

    this.net.send(GAME_EVENTS.GRENADE.THROW, {
      position: { x: origin.x, y: origin.y, z: origin.z },
      direction: { x: direction.x, y: direction.y, z: direction.z },
    });
  }

  /**
   * Ask the server to bring us back. The actual respawn lands via
   * PLAYER.RESPAWN with the server-chosen spawn point.
   */
  public requestRespawn(): void {
    if (!this.isDead) return;
    this.net.send(GAME_EVENTS.PLAYER.RESPAWN, {});
  }

  private applyServerRespawn(position: Vec3, rotation: number, hp: number): void {
    this.currentHealth = hp;
    this.isDead = false;

    // Re-enable input
    this.inputManager.enableKeyboardInput();
    this.inputManager.enableMouseInput();

    // Stand up at the server-chosen spawn point
    this.player.position.set(position.x, position.y, position.z);
    this.player.quaternion.identity();
    this.player.rotation.set(0, rotation, 0);
    this.player.updateMatrix();
    this.velocity.set(0, 0, 0);

    document.dispatchEvent(new CustomEvent("player-respawn"));
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
      default: {
        const unhandled: never = weaponType;
        weaponName = unhandled;
        break;
      }
    }

    const weapon = inventory.find((w) => w.name === weaponName);

    if (weapon) {
      // Add ammo to the weapon's total bullets
      weapon.totalBullets += amount;
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

  /** Would standing at `position` (feet-to-head `playerHeight`) overlap the world? */
  private blockedAt(position: THREE.Vector3, playerHeight: number): boolean {
    return this.world.blocksMovement(
      PlayerCollider.movementBox(position, playerHeight)
    );
  }

  /**
   * Get the player's weapon system
   * @returns The weapon system
   */
  public getWeaponSystem() {
    return this.weaponSystem;
  }
}
