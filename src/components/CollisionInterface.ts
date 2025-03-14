import type * as THREE from "three";

/**
 * Interface for objects that can check for collisions
 */
export interface CollisionDetector {
  /**
   * Check if a bullet collides with any collidable object
   * @param bulletPosition Position of the bullet
   * @returns True if collision detected, false otherwise
   */
  checkBulletCarCollision(bulletPosition: THREE.Vector3): boolean;
}
