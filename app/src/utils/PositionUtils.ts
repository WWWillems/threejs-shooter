import * as THREE from "three";

export class PositionUtils {
  // Obstacle positions to check against
  private static carPositions: THREE.Vector3[] = [
    new THREE.Vector3(8, 0, 9), // car1
    new THREE.Vector3(12, 0, 15), // car2
    new THREE.Vector3(-15, 0, -12), // car3
  ];

  private static streetLightPositions: THREE.Vector3[] = [
    new THREE.Vector3(10, 0, 12),
    new THREE.Vector3(-10, 0, -8),
    new THREE.Vector3(-5, 0, 15),
    new THREE.Vector3(15, 0, -15),
  ];

  private static shopPosition: THREE.Vector3 = new THREE.Vector3(0, 0, -20);
  private static towerPosition: THREE.Vector3 = new THREE.Vector3(-15, 0, 10);
  private static pyramidPosition: THREE.Vector3 = new THREE.Vector3(5, 0, 5);

  private static wallStart: THREE.Vector3 = new THREE.Vector3(-8, 0, 6);
  private static wallEnd: THREE.Vector3 = new THREE.Vector3(-8 + 5 * 1.2, 0, 6);

  private static circleCenter: THREE.Vector3 = new THREE.Vector3(5, 0, -12);

  private static cubePositions: THREE.Vector3[] = [
    new THREE.Vector3(-8, 1.5, -12),
    new THREE.Vector3(10, 1.5, 14),
    new THREE.Vector3(15, 1.5, -10),
  ];

  /**
   * Checks if a position is clear from existing obstacles
   * @param position Position to check
   * @param radius Radius around position to check for clearance
   * @returns Boolean indicating if position is clear
   */
  public static isPositionClear(
    position: THREE.Vector3,
    radius: number
  ): boolean {
    // Check distance from cars
    for (const carPos of this.carPositions) {
      if (position.distanceTo(carPos) < radius + 2.5) {
        // Car radius ~2.5
        return false;
      }
    }

    // Check distance from street lights
    for (const lightPos of this.streetLightPositions) {
      if (position.distanceTo(lightPos) < radius + 1.5) {
        // Street light radius ~1.5
        return false;
      }
    }

    // Check distance from shop building
    if (position.distanceTo(this.shopPosition) < radius + 10) {
      // Shop building radius ~10
      return false;
    }

    // Check distance from sniper tower
    if (position.distanceTo(this.towerPosition) < radius + 3) {
      // Tower radius ~3
      return false;
    }

    // Check distance from pyramid of crates
    if (position.distanceTo(this.pyramidPosition) < radius + 3) {
      // Pyramid radius ~3
      return false;
    }

    // Check distance from wall of crates
    // Check if position is near any part of the wall
    for (let t = 0; t <= 1; t += 0.1) {
      const pointOnWall = new THREE.Vector3().lerpVectors(
        this.wallStart,
        this.wallEnd,
        t
      );
      if (position.distanceTo(pointOnWall) < radius + 1.5) {
        // Wall width ~1.5
        return false;
      }
    }

    // Check distance from semi-circle crates
    if (position.distanceTo(this.circleCenter) < radius + 6) {
      // Circle radius ~6
      return false;
    }

    // Check distance from existing cubes
    for (const cubePos of this.cubePositions) {
      if (position.distanceTo(cubePos) < radius + 1) {
        // Cube radius ~1
        return false;
      }
    }

    // If we got here, position is clear
    return true;
  }

  /**
   * Finds a clear position near a target position
   * @param targetPos Target position to find a clear position near
   * @param radius Radius to check for clearance
   * @param maxAttempts Maximum number of attempts to find a clear position
   * @param maxOffset Maximum distance to offset from target
   * @returns Clear position or null if none found
   */
  public static findClearPosition(
    targetPos: THREE.Vector3,
    radius: number,
    maxAttempts: number = 10,
    maxOffset: number = 3
  ): THREE.Vector3 | null {
    // First try the exact position
    if (this.isPositionClear(targetPos, radius)) {
      return targetPos.clone();
    }

    // If exact position isn't clear, try random offsets
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const randomOffsetX = (Math.random() * 2 - 1) * maxOffset;
      const randomOffsetZ = (Math.random() * 2 - 1) * maxOffset;

      const testPosition = new THREE.Vector3(
        targetPos.x + randomOffsetX,
        targetPos.y,
        targetPos.z + randomOffsetZ
      );

      if (this.isPositionClear(testPosition, radius)) {
        return testPosition;
      }
    }

    // Couldn't find a clear position
    return null;
  }
}
