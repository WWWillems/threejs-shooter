import * as THREE from "three";
import { Pickup } from "./Pickup";
import type { PlayerController } from "./PlayerController";
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
    weaponType = WeaponType.DEFAULT,
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
    // Create an ammo pickup mesh (ammo box)
    const group = new THREE.Group();

    // Base box
    const boxGeometry = new THREE.BoxGeometry(0.5, 0.3, 0.8);
    const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    box.position.y = 0.15;
    group.add(box);

    // Accent stripe
    const stripeGeometry = new THREE.BoxGeometry(0.52, 0.1, 0.82);
    const stripeMaterial = new THREE.MeshStandardMaterial({
      color: this.getColorForWeaponType(this.pickupData.weaponType),
    });
    const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial);
    stripe.position.y = 0.2;
    group.add(stripe);

    // Add bullet detail on top
    const bulletGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8);
    const bulletMaterial = new THREE.MeshStandardMaterial({ color: 0xcccc00 });

    for (let i = 0; i < 3; i++) {
      const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
      bullet.rotation.x = Math.PI / 2;
      bullet.position.set(0.1 * (i - 1), 0.35, 0.1);
      group.add(bullet);
    }

    // Add animation
    this.addHoverAnimation(group);

    return group;
  }

  protected getPickupType(): string {
    return `ammo_${this.weaponType}`;
  }

  public collect(playerController: PlayerController): void {
    // Apply ammo to player weapon
    playerController.addAmmo(this.weaponType, this.ammoAmount);

    // Create effect with yellow color for ammo
    this.createCollectionEffect(0xcccc00);

    // Remove pickup
    this.remove();
  }

  private getColorForWeaponType(weaponType?: WeaponType): number {
    if (!weaponType) {
      return 0xffffff; // White for default/undefined weapon type
    }

    // Return different colors based on weapon type
    switch (weaponType) {
      case WeaponType.PISTOL:
        return 0x4444ff; // Blue
      case WeaponType.SHOTGUN:
        return 0xff4444; // Red
      case WeaponType.RIFLE:
        return 0x44ff44; // Green
      case WeaponType.SNIPER:
        return 0x8800ff; // Purple
      default:
        return 0xffffff; // White
    }
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
