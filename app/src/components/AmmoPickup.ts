import * as THREE from "three";
import { Pickup } from "./Pickup";
import { WEAPONS } from "@threejs-shooter/shared";
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
      color: WEAPONS[this.pickupData.weaponType!].color,
    });
    const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial);
    stripe.position.y = 0.2;
    group.add(stripe);

    const id=this.pickupData.weaponType!;
    const detail=new THREE.MeshStandardMaterial({color:WEAPONS[id].color,metalness:.4,roughness:.45});
    if(id===WeaponType.FLAMETHROWER) {
      const can=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,.3,12),detail);can.position.y=.4;group.add(can);
    } else if(id===WeaponType.ARC) {
      for(const x of [-.1,.1]){const cell=new THREE.Mesh(new THREE.BoxGeometry(.09,.25,.12),detail);cell.position.set(x,.4,0);group.add(cell);}
    } else {
      for (let i=0;i<(id===WeaponType.ROCKET?1:3);i++) {
        const radius=id===WeaponType.ROCKET?.085:.035;
        const bullet=new THREE.Mesh(new THREE.ConeGeometry(radius,id===WeaponType.ROCKET?.5:.22,10),detail);
        bullet.rotation.x=Math.PI/2;bullet.position.set(id===WeaponType.ROCKET?0:.12*(i-1),.36,0);group.add(bullet);
      }
    }

    // Add animation
    this.addHoverAnimation(group);

    return group;
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
