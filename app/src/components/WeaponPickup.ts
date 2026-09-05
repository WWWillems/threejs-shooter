import * as THREE from "three";
import { Pickup } from "./Pickup";
import type { PlayerController } from "./PlayerController";
import type { Weapon } from "./Weapon";

/**
 * Weapon pickup class for dropped weapons
 */
export class WeaponPickup extends Pickup {
  private weapon: Weapon;
  private weaponModel: THREE.Object3D | null = null;

  constructor(
    scene: THREE.Scene,
    position: THREE.Vector3,
    weapon: Weapon,
    model: THREE.Object3D
  ) {
    // Store the model for use in createMesh
    // We need to do this before calling super
    // because super will call createMesh
    const data = {
      weaponName: weapon.name,
      bulletsInMagazine: weapon.bulletsInMagazine,
      totalBullets: weapon.totalBullets,
    };

    // Save the model before calling super
    WeaponPickup.prototype.weaponModel = model;

    // Pass the weapon data to parent constructor through data object
    super(scene, position, data);

    // Initialize properties after super call
    this.weapon = { ...weapon }; // Clone the weapon object

    // Add weapon pickup identification to userData
    this.mesh.userData.isWeaponPickup = true;
    this.mesh.userData.weaponName = weapon.name;
    this.mesh.userData.bulletsInMagazine = weapon.bulletsInMagazine;
    this.mesh.userData.totalBullets = weapon.totalBullets;

    // Add hover animation
    this.addHoverAnimation(this.mesh);
  }

  // Override createMesh to use the model provided in constructor
  protected createMesh(): THREE.Object3D {
    // Return the saved model
    if (this.weaponModel) {
      return this.weaponModel;
    }

    // Fallback - should never reach here if called by super constructor
    console.warn("WeaponPickup: Model not available in createMesh!");
    return new THREE.Group();
  }

  protected getPickupType(): string {
    return `weapon_${this.pickupData.weaponName || "unknown"}`;
  }

  public collect(playerController: PlayerController): void {
    // Store the weapon name before adding it
    const weaponName = this.weapon.name;

    // Add weapon to player inventory and get the result
    const weaponAdded = playerController.addWeapon(this.weapon);

    // If weapon was added successfully, automatically select it
    if (weaponAdded) {
      // Get the inventory and find the index of the weapon we just added
      const inventory = playerController.getInventory();
      const weaponIndex = inventory.findIndex((w) => w.name === weaponName);

      // If found in inventory, switch to it
      if (weaponIndex !== -1) {
        playerController.selectWeapon(weaponIndex);
      }
    }

    // Create effect with blue color for weapon pickup
    this.createCollectionEffect(0x3399ff);

    // Remove pickup
    this.remove();
  }

  /**
   * Add a hover animation to the pickup mesh
   */
  private addHoverAnimation(mesh: THREE.Object3D): void {
    // Store the original position
    const originalY = mesh.position.y;
    const startTime = performance.now();

    // Create animation function
    const animateHover = (delta: number): boolean => {
      const time = performance.now() - startTime;

      // Enhanced vertical hover animation with sine wave
      mesh.position.y = originalY + Math.sin(time * 0.002) * 0.15;

      // Slow, continuous rotation around Y axis (makes it spin in place)
      mesh.rotation.y += delta * 0.8;

      // Small wobble effect for more dynamic appearance
      const wobbleAmount = 0.02;
      mesh.rotation.x = Math.sin(time * 0.0015) * wobbleAmount;
      mesh.rotation.z += Math.sin(time * 0.001) * wobbleAmount * delta;

      return true; // Keep the animation running
    };

    // Add animation to global animation list
    if (window.__pickupAnimations) {
      window.__pickupAnimations.push(animateHover);
    }
  }
}
