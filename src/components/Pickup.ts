import * as THREE from "three";
import type { PlayerController } from "./PlayerController";
import type { WeaponType } from "./Weapon";

// Interface for pickup data
export interface PickupData {
  [key: string]: unknown;
  weaponType?: WeaponType;
  ammoAmount?: number;
  healAmount?: number;
  weaponName?: string;
  bulletsInMagazine?: number;
  totalBullets?: number;
}

/**
 * Base Pickup class for all collectable items
 */
export abstract class Pickup {
  protected mesh: THREE.Object3D;
  protected scene: THREE.Scene;
  protected startTime: number;
  protected lifespan = 30; // Seconds before pickup disappears
  protected pickupData: PickupData = {}; // Now using the interface instead of any

  constructor(
    scene: THREE.Scene,
    position: THREE.Vector3,
    data: PickupData = {}
  ) {
    this.scene = scene;
    this.startTime = Date.now();
    this.pickupData = data; // Store any additional data passed from subclasses

    // Create the pickup mesh (should be overridden by subclasses)
    this.mesh = this.createMesh();
    this.mesh.position.copy(position);

    // Store pickup type in userData for identification
    this.mesh.userData = {
      isPickup: true,
      pickupType: this.getPickupType(),
      startTime: this.startTime,
      ...data, // Spread any additional data to userData
    };

    // Add to scene
    scene.add(this.mesh);
  }

  /**
   * Create mesh for the pickup - should be implemented by subclasses
   */
  protected abstract createMesh(): THREE.Object3D;

  /**
   * Get pickup type string - should be implemented by subclasses
   */
  protected abstract getPickupType(): string;

  /**
   * Logic to apply when pickup is collected - should be implemented by subclasses
   */
  public abstract collect(playerController: PlayerController): void;

  /**
   * Check if pickup has expired
   */
  public hasExpired(): boolean {
    const age = (Date.now() - this.startTime) / 1000;
    return age > this.lifespan;
  }

  /**
   * Remove pickup from scene
   */
  public remove(): void {
    this.scene.remove(this.mesh);
  }

  /**
   * Get the mesh of the pickup
   */
  public getMesh(): THREE.Object3D {
    return this.mesh;
  }

  /**
   * Create pickup effect when collected
   */
  protected createCollectionEffect(color = 0xff0000): void {
    // Create a point light effect
    const pickupEffect = new THREE.PointLight(color, 2, 5);
    pickupEffect.position.copy(this.mesh.position);
    this.scene.add(pickupEffect);

    // Remove the light after a short delay
    setTimeout(() => {
      this.scene.remove(pickupEffect);
    }, 300);
  }
}

// Add type declaration to window object
declare global {
  interface Window {
    __pickupAnimations?: ((delta: number) => boolean)[];
  }
}
