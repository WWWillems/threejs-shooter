import * as THREE from "three";
import type { CollisionSystem } from "./CollisionSystem";

export class Bush {
  private bushMesh: THREE.Group;
  private collisionBox: THREE.Box3;

  constructor(
    position: THREE.Vector3,
    private scene: THREE.Scene,
    private collisionSystem?: CollisionSystem,
    rotation: number = 0
  ) {
    // Create a group to hold all parts of the bush
    this.bushMesh = new THREE.Group();

    // Create the bush with random size variation
    this.createBush();

    // Position and rotate the bush
    this.bushMesh.position.copy(position);
    this.bushMesh.rotation.y = rotation;

    // Add to scene
    this.scene.add(this.bushMesh);

    // Create collision box
    this.collisionBox = new THREE.Box3().setFromObject(this.bushMesh);

    // Add to collision system if provided
    if (this.collisionSystem) {
      this.addToCollisionSystem();
    }
  }

  private createBush(): void {
    // Random size variation factors between 0.7 and 1.3
    const randomScaleX = 0.7 + Math.random() * 0.6;
    const randomScaleY = 0.7 + Math.random() * 0.6;
    const randomScaleZ = 0.7 + Math.random() * 0.6;

    // Generate a slightly random green color
    const colorVariation = Math.random() * 0.2 - 0.1; // -0.1 to 0.1
    const r = 0.2 + colorVariation;
    const g = 0.5 + colorVariation;
    const b = 0.2 + colorVariation;
    const bushColor = new THREE.Color(r, g, b);

    // Create a few spheres to form the bush shape
    const bushGeometry = new THREE.SphereGeometry(0.5, 8, 8);
    const bushMaterial = new THREE.MeshStandardMaterial({
      color: bushColor,
      roughness: 0.8,
      metalness: 0.1,
    });

    // Create main bush body
    const mainBush = new THREE.Mesh(bushGeometry, bushMaterial);
    mainBush.castShadow = true;
    mainBush.receiveShadow = true;
    mainBush.position.y = 0.5;
    mainBush.scale.set(randomScaleX, randomScaleY, randomScaleZ);
    this.bushMesh.add(mainBush);

    // Add 2-3 additional spheres to create irregular bush shape
    const numExtraParts = 2 + Math.floor(Math.random() * 2); // 2 or 3

    for (let i = 0; i < numExtraParts; i++) {
      const extraBush = new THREE.Mesh(bushGeometry, bushMaterial);
      extraBush.castShadow = true;
      extraBush.receiveShadow = true;

      // Random position offset
      const offsetX = Math.random() * 0.4 - 0.2;
      const offsetY = Math.random() * 0.2;
      const offsetZ = Math.random() * 0.4 - 0.2;

      extraBush.position.set(offsetX, 0.5 + offsetY, offsetZ);

      // Random scale
      const extraScale = 0.6 + Math.random() * 0.4;
      extraBush.scale.set(
        extraScale * randomScaleX,
        extraScale * randomScaleY,
        extraScale * randomScaleZ
      );

      this.bushMesh.add(extraBush);
    }
  }

  private addToCollisionSystem(): void {
    this.collisionSystem?.addCustomObstacle(this.collisionBox);
  }

  public getPosition(): THREE.Vector3 {
    return this.bushMesh.position.clone();
  }

  public remove(): void {
    // Note: CollisionSystem doesn't have a method to remove individual custom obstacles
    // In a full implementation, we'd need to track and remove them specifically
    this.scene.remove(this.bushMesh);
  }
}
