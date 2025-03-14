import * as THREE from "three";

// Bullet class to manage bullet behavior
export class Bullet {
  private mesh: THREE.Mesh;
  private velocity: THREE.Vector3;
  private lifespan = 3.0; // Seconds before bullet is removed
  private speed = 30.0;
  private alive = true;

  constructor(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    scene: THREE.Scene
  ) {
    // Create bullet geometry - small sphere
    const geometry = new THREE.SphereGeometry(0.1, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    this.mesh = new THREE.Mesh(geometry, material);

    // Position bullet at gun barrel
    this.mesh.position.copy(position);

    // Set velocity based on normalized direction and speed
    this.velocity = direction.normalize().multiplyScalar(this.speed);

    // Add to scene
    scene.add(this.mesh);

    // Enable shadows
    this.mesh.castShadow = true;
  }

  update(delta: number): boolean {
    // Update lifespan
    this.lifespan -= delta;

    // Check if bullet should be removed
    if (this.lifespan <= 0) {
      this.alive = false;
      return false;
    }

    // Update position
    this.mesh.position.x += this.velocity.x * delta;
    this.mesh.position.y += this.velocity.y * delta;
    this.mesh.position.z += this.velocity.z * delta;

    return true;
  }

  remove(scene: THREE.Scene) {
    scene.remove(this.mesh);
    // Clean up geometry and material
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  isAlive(): boolean {
    return this.alive;
  }

  getPosition(): THREE.Vector3 {
    return this.mesh.position;
  }
}
