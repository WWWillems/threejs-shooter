import * as THREE from "three";
import { loadTextureSet } from "../core/textures";

/**
 * Generated `traffic-cone-orange` texture set, loaded once for every cone.
 * The lathe wraps U around the cone, so U must repeat a whole number of times
 * or the tile seam shows; V runs up the profile and can be fractional.
 */
const coneTextures = loadTextureSet("traffic-cone-orange", {
  repeat: [2, 1.5],
});

/** Decorative cone mesh. Its movement-only footprint lives in the shared map (`coneBox`). */
export class TrafficCone {
  private coneMesh: THREE.Group;

  constructor(
    position: THREE.Vector3,
    private scene: THREE.Object3D,
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

    const coneGeometry = new THREE.LatheGeometry(points, 16);
    // Weathered orange plastic. The derived roughness map spans ~0.35-0.95,
    // so the multiplier stays at 1 and the map alone sets the finish.
    const coneMaterial = new THREE.MeshStandardMaterial({
      map: coneTextures.basecolor,
      roughnessMap: coneTextures.roughness,
      roughness: 1,
      normalMap: coneTextures.normal,
      normalScale: new THREE.Vector2(1, 1),
      aoMap: coneTextures.ao,
      metalness: 0,
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
      16
    );
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x222222, // Black rubber
      roughness: 0.9,
      metalness: 0,
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
    // Two white reflective-tape stripes. Non-metallic and not self-lit: they
    // only read bright when a light actually hits them.
    const stripeMaterial = new THREE.MeshStandardMaterial({
      color: 0xe6e6e6,
      roughness: 0.4,
      metalness: 0,
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
    const stripeHeight = .09;
    const slope = (.25 - .1) / .8;
    const stripeGeometry = new THREE.CylinderGeometry(
      radius - slope * stripeHeight / 2 + .003,
      radius + slope * stripeHeight / 2 + .003,
      stripeHeight, 24, 1, true
    );
    const stripe = new THREE.Mesh(stripeGeometry, material);
    stripe.position.y = height;
    stripe.castShadow = true;
    stripe.receiveShadow = true;

    return stripe;
  }

  // Method to get position
  public getPosition(): THREE.Vector3 {
    return this.coneMesh.position.clone();
  }

  public getObject3D(): THREE.Group {
    return this.coneMesh;
  }

  public remove(): void {
    this.scene.remove(this.coneMesh);
  }
}
