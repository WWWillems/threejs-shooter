import * as THREE from "three";
import type { CollisionSystem } from "./CollisionSystem";
import type { RemotePlayerManager } from "./RemotePlayerManager";
import { PlayerCollider } from "./PlayerCollider";

/**
 * Handles debug visualization for the game
 */
export class DebugVisualizer {
  private scene: THREE.Scene;
  private collisionSystem: CollisionSystem;
  private debugHelpers: THREE.Object3D[] = [];
  private debugMode = false;
  private player: THREE.Object3D;
  private remotePlayerManager?: RemotePlayerManager;

  constructor(
    scene: THREE.Scene,
    collisionSystem: CollisionSystem,
    player: THREE.Object3D,
    remotePlayerManager?: RemotePlayerManager
  ) {
    this.scene = scene;
    this.collisionSystem = collisionSystem;
    this.player = player;
    this.remotePlayerManager = remotePlayerManager;
  }

  /**
   * Toggle debug visualization mode
   */
  public toggleDebugMode(): void {
    this.debugMode = !this.debugMode;
    if (!this.debugMode) {
      this.clearDebugHelpers();
    }
  }

  /**
   * Get current debug mode state
   */
  public isDebugMode(): boolean {
    return this.debugMode;
  }

  /**
   * Update the collision system reference
   */
  public updateCollisionSystem(collisionSystem: CollisionSystem): void {
    this.collisionSystem = collisionSystem;
  }

  /**
   * Update the RemotePlayerManager reference
   */
  public updateRemotePlayerManager(
    remotePlayerManager: RemotePlayerManager
  ): void {
    this.remotePlayerManager = remotePlayerManager;
  }

  /**
   * Update debug visualization
   */
  public updateDebugVisualization(): void {
    // Remove existing debug helpers
    this.clearDebugHelpers();

    if (!this.debugMode) return;

    // Create player hitbox visualization
    this.createPlayerColliderVisualization();

    // Create car collider visualizations
    this.createCarColliderVisualizations();

    // Create street light collider visualizations
    this.createStreetLightColliderVisualizations();

    // Create wooden crate collider visualizations
    this.createWoodenCrateColliderVisualizations();

    // Create remote player collider visualizations
    this.createRemotePlayerColliderVisualizations();
  }

  /**
   * Clear all debug visualization helpers
   */
  private clearDebugHelpers(): void {
    for (const helper of this.debugHelpers) {
      this.scene.remove(helper);
      if (helper instanceof THREE.Mesh) {
        if (helper.geometry) helper.geometry.dispose();
        if (helper.material) {
          if (Array.isArray(helper.material)) {
            for (const material of helper.material) {
              material.dispose();
            }
          } else {
            helper.material.dispose();
          }
        }
      } else if (helper instanceof THREE.Line) {
        if (helper.geometry) helper.geometry.dispose();
        if (helper.material) {
          if (Array.isArray(helper.material)) {
            for (const material of helper.material) {
              material.dispose();
            }
          } else {
            helper.material.dispose();
          }
        }
      }
    }

    this.debugHelpers = [];
  }

  /**
   * Create visual representations of car colliders
   */
  private createCarColliderVisualizations(): void {
    // Access car colliders from CollisionSystem
    const carColliders = this.collisionSystem.getCarColliders();

    if (!carColliders || carColliders.length === 0) return;

    for (const carData of carColliders) {
      // Create a box geometry based on the car's dimensions
      const { dimensions } = carData;
      const boxGeometry = new THREE.BoxGeometry(
        dimensions.x,
        dimensions.y,
        dimensions.z
      );

      // Create a wireframe material
      const boxMaterial = new THREE.MeshBasicMaterial({
        color: 0xff0000, // Red for car colliders
        wireframe: true,
        transparent: true,
        opacity: 0.5,
      });

      // Create mesh and position it to match the car
      const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
      boxMesh.position.copy(carData.carObj.position);

      // Adjust height based on heightOffset
      boxMesh.position.y += carData.heightOffset;

      // Match the car's rotation
      boxMesh.rotation.y = carData.carObj.rotation.y;

      // Add to scene and track for cleanup
      this.scene.add(boxMesh);
      this.debugHelpers.push(boxMesh);
    }
  }

  /**
   * Create visual representations of street light colliders
   */
  private createStreetLightColliderVisualizations(): void {
    // Access street light colliders from CollisionSystem
    const lightColliders = this.collisionSystem.getStreetLightColliders();

    if (!lightColliders || lightColliders.length === 0) return;

    for (const lightData of lightColliders) {
      // Create a box geometry based on the light's dimensions
      const { dimensions } = lightData;
      const boxGeometry = new THREE.BoxGeometry(
        dimensions.x,
        dimensions.y,
        dimensions.z
      );

      // Create a wireframe material
      const boxMaterial = new THREE.MeshBasicMaterial({
        color: 0x0000ff, // Blue for street light colliders
        wireframe: true,
        transparent: true,
        opacity: 0.5,
      });

      // Create mesh and position it
      const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);

      // Position the box at the street light position
      boxMesh.position.copy(lightData.lightObj.position);

      // Adjust height based on heightOffset (half the height)
      boxMesh.position.y += dimensions.y / 2;

      // Add to scene and track for cleanup
      this.scene.add(boxMesh);
      this.debugHelpers.push(boxMesh);
    }
  }

  /**
   * Create visual representations of wooden crate colliders
   */
  private createWoodenCrateColliderVisualizations(): void {
    // Access wooden crate colliders from CollisionSystem
    const crateColliders = this.collisionSystem.getWoodenCrateColliders();

    if (!crateColliders || crateColliders.length === 0) return;

    for (const crateData of crateColliders) {
      // Create a box geometry based on the crate's dimensions
      const { dimensions } = crateData;
      const boxGeometry = new THREE.BoxGeometry(
        dimensions.x,
        dimensions.y,
        dimensions.z
      );

      // Create a wireframe material
      const boxMaterial = new THREE.MeshBasicMaterial({
        color: 0xffa500, // Orange for wooden crate colliders
        wireframe: true,
        transparent: true,
        opacity: 0.5,
      });

      // Create mesh and position it
      const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);

      // Copy the crate position exactly for accurate visualization
      boxMesh.position.copy(crateData.crateObj.position);

      // The crate model's origin is at its center (due to THREE.BoxGeometry)
      // No need for additional y-offset as the collision box and model should match exactly

      // Match the crate's rotation
      boxMesh.rotation.y = crateData.crateObj.rotation.y;

      // Add to scene and track for cleanup
      this.scene.add(boxMesh);
      this.debugHelpers.push(boxMesh);
    }
  }

  /**
   * Draw the local player's hitbox (the shared, rotated box the server sweeps
   * bullets against).
   */
  private createPlayerColliderVisualization(): void {
    const playerMesh = PlayerCollider.createDebugMesh(
      this.player,
      0x00ff00, // Green for local player
      0.5
    );

    this.scene.add(playerMesh);
    this.debugHelpers.push(playerMesh);
  }

  /**
   * Draw each remote player's hitbox at its interpolated position and facing.
   */
  private createRemotePlayerColliderVisualizations(): void {
    if (!this.remotePlayerManager) return;

    const remotePlayers = this.remotePlayerManager.getPlayers();
    if (!remotePlayers) return;

    for (const player of remotePlayers.values()) {
      const playerMesh = PlayerCollider.createDebugMesh(
        player.mesh,
        0xff0000, // Red for remote players
        0.5
      );

      this.scene.add(playerMesh);
      this.debugHelpers.push(playerMesh);
    }
  }
}
