import * as THREE from "three";
import { Car } from "./Car";
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
 * Manages all collision detection in the game
 */
export class CollisionSystem implements CollisionDetector {
  private carColliders: CarCollider[] = [];
  private cars: THREE.Group[] = [];
  private playerCollider = new THREE.Box3();
  private tempBox = new THREE.Box3();
  private bulletRadius = 0.1; // Match the radius used in Bullet.ts

  constructor(private scene: THREE.Scene) {}

  /**
   * Add a car to the collision system
   */
  public addCar(car: THREE.Group): void {
    this.cars.push(car);
    this.updateCarColliders();
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
   * Check if player collides with any cars
   */
  public checkPlayerCollision(
    position: THREE.Vector3,
    playerHeight: number
  ): boolean {
    // Update player collider at the test position
    this.playerCollider.min.set(
      position.x - 0.5, // Half width
      position.y - playerHeight / 2, // Bottom of player
      position.z - 0.5 // Half depth
    );

    this.playerCollider.max.set(
      position.x + 0.5, // Half width
      position.y + playerHeight / 2, // Top of player
      position.z + 0.5 // Half depth
    );

    // Check for collision with any car
    for (const carData of this.carColliders) {
      // Create a box that's correctly aligned with the car's rotation
      const carBox = this.getRotatedCarBox(carData);

      if (this.playerCollider.intersectsBox(carBox)) {
        return true; // Collision detected
      }
    }

    return false; // No collision
  }

  /**
   * Check if a bullet collides with any car
   */
  public checkForBulletCollision(bulletPosition: THREE.Vector3): boolean {
    // Create a small sphere to represent the bullet
    const bulletSphere = new THREE.Sphere(bulletPosition, this.bulletRadius);

    // Check collision with each car
    for (const carData of this.carColliders) {
      // Create a box that's correctly aligned with the car's rotation
      const carBox = this.getRotatedCarBox(carData);

      // Check if the bullet sphere intersects with the car box
      if (carBox.intersectsSphere(bulletSphere)) {
        return true; // Collision detected
      }
    }

    return false; // No collision
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
