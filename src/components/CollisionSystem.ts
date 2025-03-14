import * as THREE from "three";
import { Car } from "./Car";
import { StreetLight } from "./StreetLight";
import { WoodenCrate } from "./WoodenCrate";
import type { DestructibleCrate } from "./WoodenCrate";
import type { CollisionDetector } from "./CollisionInterface";

/**
 * Type for car collision data
 */
interface CarCollider {
  box: THREE.Box3;
  carObj: THREE.Group;
  dimensions: THREE.Vector3;
  heightOffset: number;
}

/**
 * Type for street light collision data
 */
interface StreetLightCollider {
  box: THREE.Box3;
  lightObj: THREE.Group;
  dimensions: THREE.Vector3;
  heightOffset: number;
}

/**
 * Type for wooden crate collision data
 */
interface WoodenCrateCollider {
  box: THREE.Box3;
  crateObj: DestructibleCrate;
  dimensions: THREE.Vector3;
  heightOffset: number;
  size: number;
}

/**
 * Manages all collision detection in the game
 */
export class CollisionSystem implements CollisionDetector {
  private carColliders: CarCollider[] = [];
  private cars: THREE.Group[] = [];
  private streetLightColliders: StreetLightCollider[] = [];
  private streetLights: THREE.Group[] = [];
  private woodenCrateColliders: WoodenCrateCollider[] = [];
  private woodenCrates: DestructibleCrate[] = [];
  private playerCollider = new THREE.Box3();
  private tempBox = new THREE.Box3();

  private bulletDamage = 25; // Damage per bullet hit

  /**
   * Get car colliders for visualization
   */
  public getCarColliders(): CarCollider[] {
    return this.carColliders;
  }

  /**
   * Get street light colliders for visualization
   */
  public getStreetLightColliders(): StreetLightCollider[] {
    return this.streetLightColliders;
  }

  /**
   * Get wooden crate colliders for visualization
   */
  public getWoodenCrateColliders(): WoodenCrateCollider[] {
    return this.woodenCrateColliders;
  }

  /**
   * Add a car to the collision system
   */
  public addCar(car: THREE.Group): void {
    this.cars.push(car);
    this.updateCarColliders();
  }

  /**
   * Add a street light to the collision system
   */
  public addStreetLight(streetLight: THREE.Group): void {
    this.streetLights.push(streetLight);
    this.updateStreetLightColliders();
  }

  /**
   * Add a wooden crate to the collision system
   */
  public addWoodenCrate(crate: DestructibleCrate, size = 1): void {
    crate.crateSize = size;
    this.woodenCrates.push(crate);

    // Create initial collision boxes
    this.updateWoodenCrateColliders();
  }

  /**
   * Update all car colliders with current positions and dimensions
   */
  public updateCarColliders(): void {
    this.carColliders = [];

    for (const car of this.cars) {
      // Get car's accurate collision dimensions from the Car module
      const collisionInfo = Car.getCollisionDimensions();

      // Get the car's dimensions and position
      const carDimensions = collisionInfo.dimensions;
      const heightOffset = collisionInfo.heightOffset;

      // Get the original bounding box for reference only
      const tempBox = new THREE.Box3().setFromObject(car);

      // Store car data for collision detection
      this.carColliders.push({
        box: tempBox, // Keep original box for reference
        carObj: car,
        dimensions: carDimensions,
        heightOffset: heightOffset,
      });
    }
  }

  /**
   * Update all street light colliders with current positions and dimensions
   */
  public updateStreetLightColliders(): void {
    this.streetLightColliders = [];

    for (const streetLight of this.streetLights) {
      // Get street light's accurate collision dimensions
      const collisionInfo = StreetLight.getCollisionDimensions();

      // Get the street light's dimensions and position
      const dimensions = collisionInfo.dimensions;
      const heightOffset = collisionInfo.heightOffset;

      // Create a new bounding box with the correct dimensions
      const box = new THREE.Box3();

      // Create min and max points for the box
      const min = new THREE.Vector3(
        streetLight.position.x - dimensions.x / 2,
        streetLight.position.y, // Start from ground
        streetLight.position.z - dimensions.z / 2
      );

      const max = new THREE.Vector3(
        streetLight.position.x + dimensions.x / 2,
        streetLight.position.y + dimensions.y,
        streetLight.position.z + dimensions.z / 2
      );

      box.set(min, max);

      // Add to the colliders array
      this.streetLightColliders.push({
        box,
        lightObj: streetLight,
        dimensions,
        heightOffset,
      });
    }
  }

  /**
   * Update all wooden crate colliders
   */
  public updateWoodenCrateColliders(): void {
    this.woodenCrateColliders = [];

    // Remove destroyed crates from the array
    this.woodenCrates = this.woodenCrates.filter((crate) => !crate.isDestroyed);

    for (const crate of this.woodenCrates) {
      if (crate.isDestroyed) continue;

      const size = crate.crateSize || 1;
      const { dimensions, heightOffset } =
        WoodenCrate.getCollisionDimensions(size);

      // Create collision box
      const box = new THREE.Box3();

      // Get world position of the crate
      const crateWorldPos = new THREE.Vector3();
      crate.getWorldPosition(crateWorldPos);

      // Create a copy of the crate position adjusted for height offset
      const adjustedPos = crateWorldPos.clone();
      adjustedPos.y += heightOffset;

      // Set the collision box around the adjusted crate position
      box.setFromCenterAndSize(adjustedPos, dimensions);

      this.woodenCrateColliders.push({
        box,
        crateObj: crate,
        dimensions,
        heightOffset,
        size,
      });
    }
  }

  /**
   * Check if the player collides with any objects at the given position
   */
  public checkPlayerCollision(
    position: THREE.Vector3,
    playerHeight: number
  ): boolean {
    // Update the player collider box
    this.playerCollider.min.set(position.x - 0.4, position.y, position.z - 0.4);
    this.playerCollider.max.set(
      position.x + 0.4,
      position.y + playerHeight,
      position.z + 0.4
    );

    // Check collision with cars
    for (const carData of this.carColliders) {
      // Get the car's world-space box adjusted for rotation
      const carBox = this.getRotatedCarBox(carData);

      // Check if the player's box intersects with the car's box
      if (this.playerCollider.intersectsBox(carBox)) {
        return true;
      }
    }

    // Check collision with street lights
    for (const lightData of this.streetLightColliders) {
      // Create a box for the street light using its dimensions and position
      const lightPosition = lightData.lightObj.position;
      this.tempBox.min.set(
        lightPosition.x - lightData.dimensions.x / 2,
        lightPosition.y,
        lightPosition.z - lightData.dimensions.z / 2
      );
      this.tempBox.max.set(
        lightPosition.x + lightData.dimensions.x / 2,
        lightPosition.y + lightData.dimensions.y,
        lightPosition.z + lightData.dimensions.z / 2
      );

      // Check if the player's box intersects with the light's box
      if (this.playerCollider.intersectsBox(this.tempBox)) {
        return true;
      }
    }

    // Check collision with wooden crates
    for (const crateData of this.woodenCrateColliders) {
      // No need to create a temporary box since we've already set up the proper box
      // when we created the collider in updateWoodenCrateColliders
      if (this.playerCollider.intersectsBox(crateData.box)) {
        return true;
      }
    }

    // No collision detected
    return false;
  }

  /**
   * Check for bullet collision with objects and apply damage
   * @returns true if bullet hit something
   */
  public checkForBulletCollision(bulletPosition: THREE.Vector3): boolean {
    // Check for bullet-crate collisions first
    for (const crate of this.woodenCrateColliders) {
      if (crate.crateObj.isDestroyed) continue;

      // Check if bullet position is inside or close to the crate box
      if (crate.box.containsPoint(bulletPosition)) {
        // Apply damage to the crate
        const wasDestroyed =
          crate.crateObj.takeDamage?.(this.bulletDamage) ?? false;

        // If the crate was destroyed, update colliders
        if (wasDestroyed) {
          this.updateWoodenCrateColliders();
        }

        return true; // Bullet hit the crate
      }
    }

    // Check collision with cars
    for (const carData of this.carColliders) {
      // Get the car's world-space box adjusted for rotation
      const carBox = this.getRotatedCarBox(carData);

      // Check if the bullet's position is inside the car's box
      if (carBox.containsPoint(bulletPosition)) {
        return true;
      }
    }

    // Check collision with street lights
    for (const lightData of this.streetLightColliders) {
      // Create a box for the street light using its dimensions and position
      const lightPosition = lightData.lightObj.position;
      this.tempBox.min.set(
        lightPosition.x - lightData.dimensions.x / 2,
        lightPosition.y,
        lightPosition.z - lightData.dimensions.z / 2
      );
      this.tempBox.max.set(
        lightPosition.x + lightData.dimensions.x / 2,
        lightPosition.y + lightData.dimensions.y,
        lightPosition.z + lightData.dimensions.z / 2
      );

      // Check if the bullet's position is inside the light's box
      if (this.tempBox.containsPoint(bulletPosition)) {
        return true;
      }
    }

    // No collision detected
    return false;
  }

  /**
   * Create a rotated bounding box aligned with the car's orientation
   */
  private getRotatedCarBox(carData: CarCollider): THREE.Box3 {
    // Extract data from carData
    const carPos = carData.carObj.position;
    const carRotY = carData.carObj.rotation.y;
    const dims = carData.dimensions;
    const heightOffset = carData.heightOffset;

    // Half-dimensions
    const halfWidth = dims.x / 2;
    const halfHeight = dims.y / 2;
    const halfLength = dims.z / 2;

    // Create local corner coordinates (relative to car's own coordinate system)
    const localCorners = [
      // Bottom face
      new THREE.Vector3(halfWidth, -halfHeight, halfLength), // front-right-bottom
      new THREE.Vector3(-halfWidth, -halfHeight, halfLength), // front-left-bottom
      new THREE.Vector3(-halfWidth, -halfHeight, -halfLength), // back-left-bottom
      new THREE.Vector3(halfWidth, -halfHeight, -halfLength), // back-right-bottom

      // Top face
      new THREE.Vector3(halfWidth, halfHeight, halfLength), // front-right-top
      new THREE.Vector3(-halfWidth, halfHeight, halfLength), // front-left-top
      new THREE.Vector3(-halfWidth, halfHeight, -halfLength), // back-left-top
      new THREE.Vector3(halfWidth, halfHeight, -halfLength), // back-right-top
    ];

    // Create a bounding box to hold the result
    const rotatedBox = new THREE.Box3();

    // Transform first corner to initialize the box
    const firstCorner = localCorners[0];
    const rotatedX =
      firstCorner.x * Math.cos(carRotY) - firstCorner.z * Math.sin(carRotY);
    const rotatedZ =
      firstCorner.x * Math.sin(carRotY) + firstCorner.z * Math.cos(carRotY);

    const worldFirstCorner = new THREE.Vector3(
      carPos.x + rotatedX,
      carPos.y + heightOffset + firstCorner.y,
      carPos.z + rotatedZ
    );

    // Initialize the box with the first corner
    rotatedBox.min.copy(worldFirstCorner);
    rotatedBox.max.copy(worldFirstCorner);

    // Process remaining corners (starting from index 1)
    for (let i = 1; i < localCorners.length; i++) {
      const corner = localCorners[i];

      // Apply Y-axis rotation
      const rotX = corner.x * Math.cos(carRotY) - corner.z * Math.sin(carRotY);
      const rotZ = corner.x * Math.sin(carRotY) + corner.z * Math.cos(carRotY);

      // Translate to world position
      const worldCorner = new THREE.Vector3(
        carPos.x + rotX,
        carPos.y + heightOffset + corner.y,
        carPos.z + rotZ
      );

      // Expand the bounding box to include this corner
      rotatedBox.expandByPoint(worldCorner);
    }

    return rotatedBox;
  }
}
