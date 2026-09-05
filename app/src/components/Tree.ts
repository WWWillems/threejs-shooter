import * as THREE from "three";
import type { CollisionSystem } from "./CollisionSystem";

export class Tree {
  private treeMesh: THREE.Group;
  private collisionBox: THREE.Box3;

  constructor(
    position: THREE.Vector3,
    private scene: THREE.Scene,
    private collisionSystem?: CollisionSystem,
    rotation: number = 0,
    scale: number = 1
  ) {
    // Create a group to hold all parts of the tree
    this.treeMesh = new THREE.Group();

    // Create the tree
    this.createTree(scale);

    // Position and rotate the tree
    this.treeMesh.position.copy(position);
    this.treeMesh.rotation.y = rotation;

    // Add to scene
    this.scene.add(this.treeMesh);

    // Create collision box
    this.collisionBox = new THREE.Box3().setFromObject(this.treeMesh);

    // Add to collision system if provided
    if (this.collisionSystem) {
      this.addToCollisionSystem();
    }
  }

  private createTree(scale: number): void {
    // Create trunk
    const trunkGeometry = new THREE.CylinderGeometry(
      0.2 * scale,
      0.3 * scale,
      1.5 * scale,
      8
    );
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b4513, // Brown
      roughness: 0.8,
      metalness: 0.2,
    });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    trunk.position.y = 0.75 * scale;
    this.treeMesh.add(trunk);

    // Create foliage (cone shapes)
    const foliageGeometry = new THREE.ConeGeometry(1 * scale, 2 * scale, 8);
    const foliageMaterial = new THREE.MeshStandardMaterial({
      color: 0x2e8b57, // Dark green
      roughness: 0.7,
      metalness: 0.1,
    });

    // Bottom foliage
    const foliage1 = new THREE.Mesh(foliageGeometry, foliageMaterial);
    foliage1.castShadow = true;
    foliage1.receiveShadow = true;
    foliage1.position.y = 1.5 * scale;
    this.treeMesh.add(foliage1);

    // Middle foliage (slightly smaller)
    const foliage2 = new THREE.Mesh(foliageGeometry, foliageMaterial);
    foliage2.castShadow = true;
    foliage2.receiveShadow = true;
    foliage2.position.y = 2.5 * scale;
    foliage2.scale.set(0.8, 0.8, 0.8);
    this.treeMesh.add(foliage2);

    // Top foliage (smallest)
    const foliage3 = new THREE.Mesh(foliageGeometry, foliageMaterial);
    foliage3.castShadow = true;
    foliage3.receiveShadow = true;
    foliage3.position.y = 3.3 * scale;
    foliage3.scale.set(0.6, 0.6, 0.6);
    this.treeMesh.add(foliage3);
  }

  private addToCollisionSystem(): void {
    this.collisionSystem?.addCustomObstacle(this.collisionBox);
  }

  public getPosition(): THREE.Vector3 {
    return this.treeMesh.position.clone();
  }

  public remove(): void {
    // Note: CollisionSystem doesn't have a method to remove individual custom obstacles
    // In a full implementation, we'd need to track and remove them specifically
    this.scene.remove(this.treeMesh);
  }
}
