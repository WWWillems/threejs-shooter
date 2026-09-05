import * as THREE from "three";

// Bullet class to manage bullet behavior
export class Bullet {
  private mesh: THREE.Mesh;
  private velocity: THREE.Vector3;
  private lifespan = 3.0; // Seconds before bullet is removed
  private speed = 30.0;
  private alive = true;
  private tracer: THREE.Line | null = null;
  private previousPosition: THREE.Vector3;

  constructor(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    scene: THREE.Scene
  ) {
    // Create bullet geometry - small cylinder for better visibility
    const geometry = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8);

    // Use a brighter material to make it more visible
    const material = new THREE.MeshStandardMaterial({
      color: 0xffff00,
      emissive: 0xffff00,
      emissiveIntensity: 1.0,
    });

    this.mesh = new THREE.Mesh(geometry, material);

    // Rotate to align with direction of travel
    this.mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.clone().normalize()
    );

    // Position bullet at gun barrel
    this.mesh.position.copy(position);
    this.previousPosition = position.clone();

    // Set velocity based on normalized direction and speed
    this.velocity = direction.normalize().multiplyScalar(this.speed);

    // Add to scene
    scene.add(this.mesh);

    // Enable shadows
    this.mesh.castShadow = true;

    // Create tracer effect (line behind bullet)
    this.createTracer(scene, position);
  }

  // Create a tracer effect behind the bullet
  private createTracer(scene: THREE.Scene, position: THREE.Vector3): void {
    // Create line geometry with initial points
    const tracerGeometry = new THREE.BufferGeometry();

    // Start with two points at the same position
    const points = [
      position.clone(),
      position
        .clone()
        .sub(this.velocity.clone().normalize().multiplyScalar(0.8)),
    ];

    tracerGeometry.setFromPoints(points);

    // Create glowing line material
    const tracerMaterial = new THREE.LineBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.7,
      linewidth: 1, // Note: Line width > 1 not supported in WebGL
    });

    // Create the line and add to scene
    this.tracer = new THREE.Line(tracerGeometry, tracerMaterial);
    scene.add(this.tracer);
  }

  update(delta: number): boolean {
    // Update lifespan
    this.lifespan -= delta;

    // Check if bullet should be removed
    if (this.lifespan <= 0) {
      this.alive = false;
      return false;
    }

    // Store previous position for tracer
    this.previousPosition.copy(this.mesh.position);

    // Update position
    this.mesh.position.x += this.velocity.x * delta;
    this.mesh.position.y += this.velocity.y * delta;
    this.mesh.position.z += this.velocity.z * delta;

    // Update tracer
    if (this.tracer) {
      const positions = this.tracer.geometry.getAttribute("position");

      // Update the first vertex to the current bullet position
      positions.setXYZ(
        0,
        this.mesh.position.x,
        this.mesh.position.y,
        this.mesh.position.z
      );

      // Update the second vertex to the previous position
      positions.setXYZ(
        1,
        this.previousPosition.x,
        this.previousPosition.y,
        this.previousPosition.z
      );

      positions.needsUpdate = true;
    }

    return true;
  }

  remove(scene: THREE.Scene) {
    // Remove bullet mesh
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();

    // Remove tracer
    if (this.tracer) {
      scene.remove(this.tracer);
      this.tracer.geometry.dispose();
      (this.tracer.material as THREE.Material).dispose();
      this.tracer = null;
    }
  }

  isAlive(): boolean {
    return this.alive;
  }

  getPosition(): THREE.Vector3 {
    return this.mesh.position;
  }
}
