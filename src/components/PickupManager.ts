import * as THREE from "three";
import type { PlayerController } from "./PlayerController";
import { WeaponType } from "./Weapon";
import { HealthPickup } from "./HealthPickup";
import { AmmoPickup } from "./AmmoPickup";
import type { HUD } from "./HUD";
import type { CollisionSystem } from "./CollisionSystem";

/**
 * Pickup manager class to handle all pickups in the game
 */
export class PickupManager {
  private scene: THREE.Scene;
  private pickups: Array<HealthPickup | AmmoPickup> = [];
  private playerController: PlayerController;
  private player: THREE.Object3D;
  private collectionDistance = 1.5;
  private hud: HUD | null = null;
  private collisionSystem: CollisionSystem | null = null;
  private groundSize = 100; // Size of the ground plane
  private lastSpawnTime = 0;
  private spawnInterval = 10; // Base interval in seconds between spawns
  private maxPickups = 10; // Maximum number of pickups allowed at once
  private minSpawnInterval = 5; // Minimum spawn interval in seconds
  private maxSpawnInterval = 15; // Maximum spawn interval in seconds

  constructor(
    scene: THREE.Scene,
    player: THREE.Object3D,
    playerController: PlayerController,
    hud?: HUD,
    collisionSystem?: CollisionSystem
  ) {
    this.scene = scene;
    this.player = player;
    this.playerController = playerController;
    this.hud = hud || null;
    this.collisionSystem = collisionSystem || null;

    // Initialize animations array
    if (!window.__pickupAnimations) {
      window.__pickupAnimations = [];
    }
  }

  /**
   * Set the collision system for pickup spawning
   */
  public setCollisionSystem(collisionSystem: CollisionSystem): void {
    this.collisionSystem = collisionSystem;
  }

  /**
   * Create a health pickup at the specified position
   */
  public createHealthPickup(
    position: THREE.Vector3,
    healAmount = 25
  ): HealthPickup {
    const pickup = new HealthPickup(this.scene, position, healAmount);
    this.pickups.push(pickup);
    return pickup;
  }

  /**
   * Create an ammo pickup at the specified position
   */
  public createAmmoPickup(
    position: THREE.Vector3,
    weaponType: WeaponType,
    ammoAmount = 30
  ): AmmoPickup {
    const pickup = new AmmoPickup(this.scene, position, weaponType, ammoAmount);
    this.pickups.push(pickup);
    return pickup;
  }

  /**
   * Update pickups - check for collection and expiration
   */
  public update(delta: number): void {
    // Make a copy of the array to avoid issues if we modify it during iteration
    const currentPickups = [...this.pickups];

    for (let i = currentPickups.length - 1; i >= 0; i--) {
      const pickup = currentPickups[i];

      // Check if pickup has expired
      if (pickup.hasExpired()) {
        pickup.remove();
        this.pickups.splice(i, 1);
        continue;
      }

      // Check if player is close enough to collect the pickup
      const distance = this.player.position.distanceTo(
        pickup.getMesh().position
      );
      if (distance < this.collectionDistance) {
        // Collect the pickup and show notification
        this.collectPickup(pickup, i);
      }
    }

    // Update pickup animations
    if (window.__pickupAnimations && window.__pickupAnimations.length > 0) {
      // Update animations and remove any that return false
      window.__pickupAnimations = window.__pickupAnimations.filter((anim) =>
        anim(delta)
      );
    }

    // Check if it's time to spawn a new pickup
    this.checkRandomSpawn(delta);
  }

  /**
   * Collect a pickup and show a notification
   */
  private collectPickup(
    pickup: HealthPickup | AmmoPickup,
    index: number
  ): void {
    // Call the pickup's collect method
    pickup.collect(this.playerController);

    // Remove from pickups array
    this.pickups.splice(index, 1);

    // Show notification if HUD is available
    if (this.hud) {
      if (pickup instanceof HealthPickup) {
        // Get heal amount from pickup's userData
        const healAmount = pickup.getMesh().userData.healAmount || 0;
        this.hud.showHealthPickupNotification(healAmount);
      } else if (pickup instanceof AmmoPickup) {
        // Get ammo info from pickup's userData
        const userData = pickup.getMesh().userData;
        if (userData.weaponType && userData.ammoAmount) {
          this.hud.showAmmoPickupNotification(
            userData.weaponType,
            userData.ammoAmount
          );
        }
      }
    }
  }

  /**
   * Check if we should spawn a random pickup
   */
  private checkRandomSpawn(delta: number): void {
    // Update spawn timer
    this.lastSpawnTime += delta;

    // Check if it's time to spawn a new pickup and if we're under the max limit
    if (
      this.lastSpawnTime >= this.spawnInterval &&
      this.pickups.length < this.maxPickups
    ) {
      this.spawnRandomPickup();

      // Reset timer with random interval
      this.lastSpawnTime = 0;
      this.spawnInterval =
        this.minSpawnInterval +
        Math.random() * (this.maxSpawnInterval - this.minSpawnInterval);
    }
  }

  /**
   * Generate a random position on the ground that doesn't collide with objects
   */
  private getValidSpawnPosition(): THREE.Vector3 | null {
    // Try up to 30 positions before giving up
    for (let i = 0; i < 30; i++) {
      // Generate random position within ground boundaries
      const halfSize = this.groundSize / 2;
      const x = Math.random() * this.groundSize - halfSize;
      const z = Math.random() * this.groundSize - halfSize;
      const position = new THREE.Vector3(x, 0.5, z); // 0.5 to position slightly above ground

      // Keep pickups away from player spawn to give them time to navigate
      if (position.distanceTo(this.player.position) < 10) {
        continue;
      }

      // Check if position is valid (no collision)
      if (this.isValidSpawnPosition(position)) {
        return position;
      }
    }

    // Could not find a valid position
    return null;
  }

  /**
   * Check if a position is valid for spawning a pickup (no collision with objects)
   */
  private isValidSpawnPosition(position: THREE.Vector3): boolean {
    // If no collision system is available, allow spawning anywhere
    if (!this.collisionSystem) {
      return true;
    }

    // Create a temporary position slightly above ground to check for collisions
    // We check collision as if there was a small object at this position
    const testPosition = position.clone();
    testPosition.y = 0.1; // Start just above ground

    // Use the collision system to check if this position collides with any objects
    return !this.collisionSystem.checkPlayerCollision(testPosition, 1);
  }

  /**
   * Spawn a random pickup at a random valid position
   */
  private spawnRandomPickup(): void {
    // Get a valid spawn position
    const position = this.getValidSpawnPosition();
    if (!position) {
      // Could not find a valid position
      return;
    }

    // Randomly choose between health and ammo pickup (50/50 chance)
    if (Math.random() < 0.5) {
      // Health pickup with random amount between 10 and 50
      const healAmount = Math.floor(10 + Math.random() * 40);
      this.createHealthPickup(position, healAmount);
    } else {
      // Ammo pickup with random weapon type
      const weaponTypes = Object.values(WeaponType);
      const weaponType =
        weaponTypes[Math.floor(Math.random() * weaponTypes.length)];
      const ammoAmount = Math.floor(20 + Math.random() * 60);
      this.createAmmoPickup(position, weaponType, ammoAmount);
    }
  }
}

// Add type declaration to window object
declare global {
  interface Window {
    __pickupAnimations?: ((delta: number) => boolean)[];
  }
}
