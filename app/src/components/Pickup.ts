import * as THREE from "three";
import type { PlayerController } from "./PlayerController";
import type { WeaponType } from "./Weapon";
import { PICKUP_FLASH_DISTANCE, PICKUP_FLASH_INTENSITY } from "../core/Scene";

const PICKUP_FLASH_DURATION = 0.3;
const PICKUP_FLASH_POOL_SIZE = 4;

interface PickupFlashSlot {
  light: THREE.PointLight;
  age: number;
}

/**
 * Point lights are kept in the scene for the lifetime of the game. Adding a
 * light while rendering can make Three.js compile a new lighting shader on
 * the next frame, which is visible as a hitch when collecting a pickup.
 */
class PickupFlashPool {
  private readonly slots: PickupFlashSlot[];

  constructor(private readonly scene: THREE.Scene) {
    this.slots = Array.from({ length: PICKUP_FLASH_POOL_SIZE }, () => {
      const light = new THREE.PointLight(
        0xffffff,
        0,
        PICKUP_FLASH_DISTANCE,
        2
      );
      scene.add(light);
      return { light, age: PICKUP_FLASH_DURATION };
    });
  }

  flash(position: THREE.Vector3, color: number): void {
    const slot = this.slots.reduce((oldest, candidate) =>
      candidate.age > oldest.age ? candidate : oldest
    );
    slot.light.position.copy(position);
    slot.light.color.setHex(color);
    slot.light.intensity = PICKUP_FLASH_INTENSITY;
    slot.age = 0;
  }

  update(delta: number): void {
    for (const slot of this.slots) {
      if (slot.age >= PICKUP_FLASH_DURATION) continue;
      slot.age += delta;
      slot.light.intensity =
        PICKUP_FLASH_INTENSITY *
        Math.max(0, 1 - slot.age / PICKUP_FLASH_DURATION);
    }
  }
}

const pickupFlashPools = new WeakMap<THREE.Scene, PickupFlashPool>();

function getPickupFlashPool(scene: THREE.Scene): PickupFlashPool {
  let pool = pickupFlashPools.get(scene);
  if (!pool) {
    pool = new PickupFlashPool(scene);
    pickupFlashPools.set(scene, pool);
  }
  return pool;
}

/** Allocate pickup flash lights before the first gameplay render. */
export function prewarmPickupEffects(scene: THREE.Scene): void {
  getPickupFlashPool(scene);
}

/** Advance pooled pickup flashes without creating per-collection timers. */
export function updatePickupEffects(
  scene: THREE.Scene,
  delta: number
): void {
  getPickupFlashPool(scene).update(delta);
}

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
   * Apply the pickup to the local player. Only client-owned pickups (dropped
   * weapons) implement this; server-owned pickups are resolved by the server
   * and applied by PickupManager from the PICKUP.TAKEN event.
   */
  public collect(_playerController: PlayerController): void {
    this.playCollectionEffect();
    this.remove();
  }

  /** Flash at the pickup's position; used when anyone collects it. */
  public playCollectionEffect(): void {
    this.createCollectionEffect(this.collectionEffectColor());
  }

  /** Colour of the collection flash; subclasses override. */
  protected collectionEffectColor(): number {
    return 0xffffff;
  }

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
    getPickupFlashPool(this.scene).flash(this.mesh.position, color);
  }
}

// Add type declaration to window object
declare global {
  interface Window {
    __pickupAnimations?: ((delta: number) => boolean)[];
  }
}
