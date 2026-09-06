import * as THREE from "three";
import { Pickup } from "./Pickup";
import { attachModel } from "../core/models";
import { WeaponType } from "./Weapon";

/**
 * Ammo pickup class
 */
export class AmmoPickup extends Pickup {
  private ammoAmount: number;
  private weaponType: WeaponType;

  constructor(
    scene: THREE.Scene,
    position: THREE.Vector3,
    weaponType: WeaponType,
    ammoAmount = 30
  ) {
    // Pass the weapon type to parent constructor through data object
    super(scene, position, { weaponType, ammoAmount });

    // Initialize properties after super call
    this.ammoAmount = ammoAmount;
    this.weaponType = weaponType;

    // Add ammo pickup flag
    this.mesh.userData.isAmmoPickup = true;
  }

  protected createMesh(): THREE.Object3D {
    const group = new THREE.Group();
    attachModel(group, `noir-ammo-${this.pickupData.weaponType}`);

    // Add animation
    const root = new THREE.Group();
    root.add(group);
    this.addHoverAnimation(group);

    return root;
  }

  protected getPickupType(): string {
    return `ammo_${this.pickupData.weaponType}`;
  }

  protected collectionEffectColor(): number {
    return 0xcccc00;
  }

  private addHoverAnimation(group: THREE.Group): void {
    // Store initial Y position
    const originalY = group.position.y;

    // Add animation data to userData
    group.userData.animation = {
      originalY,
      time: Math.random() * Math.PI * 2, // Random start point for animation
    };

    // Add to global animation array if it exists
    if (!window.__pickupAnimations) {
      window.__pickupAnimations = [];
    }

    // Create animation function
    const animatePickup = (delta: number) => {
      if (!group.parent?.parent) return false; // If no longer in scene, remove animation

      // Check if animation data exists
      if (!group.userData || !group.userData.animation) return false;

      // Update animation time
      group.userData.animation.time += delta * 2;

      // Apply hover effect
      group.position.y =
        originalY + Math.sin(group.userData.animation.time) * 0.2;
      group.rotation.y += delta * 1.5;

      return true;
    };

    // Add to animations array
    window.__pickupAnimations.push(animatePickup);
  }
}
