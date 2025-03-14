import type * as THREE from "three";
import type { PlayerController } from "./PlayerController";
import type { WeaponType } from "./Weapon";
import { HealthPickup } from "./HealthPickup";
import { AmmoPickup } from "./AmmoPickup";
import type { HUD } from "./HUD";

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

  constructor(
    scene: THREE.Scene,
    player: THREE.Object3D,
    playerController: PlayerController,
    hud?: HUD
  ) {
    this.scene = scene;
    this.player = player;
    this.playerController = playerController;
    this.hud = hud || null;

    // Initialize animations array
    if (!window.__pickupAnimations) {
      window.__pickupAnimations = [];
    }
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
}

// Add type declaration to window object
declare global {
  interface Window {
    __pickupAnimations?: ((delta: number) => boolean)[];
  }
}
