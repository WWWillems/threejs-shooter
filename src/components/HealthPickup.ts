import * as THREE from "three";
import { Pickup } from "./Pickup";
import type { PlayerController } from "./PlayerController";

/**
 * Health pickup class
 */
export class HealthPickup extends Pickup {
  private healAmount: number;

  constructor(scene: THREE.Scene, position: THREE.Vector3, healAmount = 25) {
    super(scene, position);
    this.healAmount = healAmount;

    // Add heal amount to userData
    this.mesh.userData.healAmount = healAmount;
    this.mesh.userData.isHealthPickup = true;
  }

  protected createMesh(): THREE.Object3D {
    // Create a health pickup mesh (red cross)
    const group = new THREE.Group();

    // Base
    const baseGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 16);
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = 0.1;
    group.add(base);

    // Cross vertical part
    const verticalGeometry = new THREE.BoxGeometry(0.2, 0.8, 0.2);
    const crossMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const verticalPart = new THREE.Mesh(verticalGeometry, crossMaterial);
    verticalPart.position.y = 0.5;
    group.add(verticalPart);

    // Cross horizontal part
    const horizontalGeometry = new THREE.BoxGeometry(0.8, 0.2, 0.2);
    const horizontalPart = new THREE.Mesh(horizontalGeometry, crossMaterial);
    horizontalPart.position.y = 0.5;
    group.add(horizontalPart);

    // Add animation
    this.addHoverAnimation(group);

    return group;
  }

  protected getPickupType(): string {
    return "health";
  }

  public collect(playerController: PlayerController): void {
    // Apply healing to player
    playerController.heal(this.healAmount);

    // Create effect
    this.createCollectionEffect(0xff0000);

    // Remove pickup
    this.remove();
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
      if (!group.parent) return false; // If no longer in scene, remove animation

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
