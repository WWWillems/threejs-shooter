import * as THREE from "three";
import type { CollisionSystem } from "./CollisionSystem";

export class TrafficCone {
  private coneMesh: THREE.Group;
  private collisionBox: THREE.Box3;

  constructor(
    position: THREE.Vector3,
    private scene: THREE.Scene,
    private collisionSystem?: CollisionSystem,
    rotation: number = 0
  ) {
    // Create a group to hold all parts of the traffic cone
    this.coneMesh = new THREE.Group();

    // Create the traffic cone
    this.createTrafficCone();

    // Position and rotate the cone
    this.coneMesh.position.copy(position);
    this.coneMesh.rotation.y = rotation;

    // Add to scene
    this.scene.add(this.coneMesh);

    // Create collision box
    this.collisionBox = new THREE.Box3().setFromObject(this.coneMesh);

    // Add to collision system if provided
    if (this.collisionSystem) {
      this.addToCollisionSystem();
    }
  }

  private createTrafficCone(): void {
    // Define cone dimensions
    const baseRadius = 0.25;
    const topRadius = 0.1; // Wider top for flat top
    const height = 0.8;
    const thickness = 0.03; // Wall thickness

    // Create hollow cone with flat top using LatheGeometry
    const points = [];
    // Outer profile (bottom to top)
    points.push(new THREE.Vector2(baseRadius, 0));
    points.push(new THREE.Vector2(baseRadius, thickness));
    points.push(new THREE.Vector2(topRadius, height));
    points.push(new THREE.Vector2(topRadius - thickness, height));
    // Inner profile (top to bottom)
    points.push(new THREE.Vector2(baseRadius - thickness, thickness));
    points.push(new THREE.Vector2(baseRadius - thickness, 0));

    const coneGeometry = new THREE.LatheGeometry(points, 32);
    const coneMaterial = new THREE.MeshStandardMaterial({
      color: 0xff5500, // Bright orange
      roughness: 0.8,
      metalness: 0.2,
      side: THREE.DoubleSide, // Render both sides
    });

    const cone = new THREE.Mesh(coneGeometry, coneMaterial);
    // Position cone so its base is at y=0
    cone.position.set(0, 0, 0);

    // Create reflective stripes directly on the cone surface
    this.addReflectiveStripes(cone, baseRadius, topRadius, height);

    // Create the base (black part)
    const baseHeight = 0.05;
    const baseGeometry = new THREE.CylinderGeometry(
      baseRadius * 1.1,
      baseRadius * 1.1,
      baseHeight,
      32
    );
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x222222, // Dark gray/black
      roughness: 0.9,
      metalness: 0.1,
    });

    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    // Position base at the bottom of the cone
    base.position.set(0, baseHeight / 2, 0);

    // Add cone and base to the group
    this.coneMesh.add(cone);
    this.coneMesh.add(base);

    // Add cast and receive shadows
    cone.castShadow = true;
    cone.receiveShadow = true;
    base.castShadow = true;
    base.receiveShadow = true;
  }

  private addReflectiveStripes(
    _cone: THREE.Mesh,
    baseRadius: number,
    topRadius: number,
    height: number
  ): void {
    // Add two reflective white stripes painted directly on cone surface
    const stripeMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, // White
      roughness: 0.5,
      metalness: 0.8,
      emissive: 0xaaaaaa, // Slight emissive property for reflective look
      emissiveIntensity: 0.5,
    });

    // First stripe at 30% height
    const stripe1Height = height * 0.3;
    // Calculate the radius at this height (linear interpolation)
    const stripe1Radius =
      baseRadius - (baseRadius - topRadius) * (stripe1Height / height);
    const stripe1 = this.createStripeRing(
      stripe1Radius,
      stripe1Height,
      stripeMaterial
    );

    // Second stripe at 60% height
    const stripe2Height = height * 0.6;
    // Calculate the radius at this height (linear interpolation)
    const stripe2Radius =
      baseRadius - (baseRadius - topRadius) * (stripe2Height / height);
    const stripe2 = this.createStripeRing(
      stripe2Radius,
      stripe2Height,
      stripeMaterial
    );

    this.coneMesh.add(stripe1);
    this.coneMesh.add(stripe2);
  }

  // Helper method to create a stripe ring at the correct position and size
  private createStripeRing(
    radius: number,
    height: number,
    material: THREE.Material
  ): THREE.Mesh {
    // Create a thin ring directly on the cone surface
    const stripeWidth = 0.02;
    const stripeGeometry = new THREE.TorusGeometry(
      radius, // Ring radius
      stripeWidth, // Tube radius (thickness)
      8, // Radial segments
      32 // Tubular segments
    );

    const stripe = new THREE.Mesh(stripeGeometry, material);
    stripe.position.set(0, height, 0);
    stripe.rotation.x = Math.PI / 2; // Align with cone

    return stripe;
  }

  private addToCollisionSystem(): void {
    if (this.collisionSystem) {
      this.collisionSystem.addCustomObstacle(this.collisionBox);
    }
  }

  // Method to get position
  public getPosition(): THREE.Vector3 {
    return this.coneMesh.position.clone();
  }

  // Method to remove cone from scene and collision system
  public remove(): void {
    if (this.scene) {
      this.scene.remove(this.coneMesh);
    }

    // Note: There's no direct method to remove custom obstacles in the CollisionSystem
    // This would need to be implemented in CollisionSystem if needed
  }
}
