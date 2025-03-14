import * as THREE from "three";
import type { CollisionSystem } from "./CollisionSystem";

/**
 * Handles debug visualization for the game
 */
export class DebugVisualizer {
  private scene: THREE.Scene;
  private collisionSystem: CollisionSystem;
  private debugHelpers: THREE.Object3D[] = [];
  private debugMode = false;
  private player: THREE.Object3D;
  private playerHeight = 2; // Default player height

  constructor(
    scene: THREE.Scene,
    collisionSystem: CollisionSystem,
    player: THREE.Object3D
  ) {
    this.scene = scene;
    this.collisionSystem = collisionSystem;
    this.player = player;
  }

  /**
   * Toggle debug visualization mode
   */
  public toggleDebugMode(): boolean {
    this.debugMode = !this.debugMode;
    this.updateDebugVisualization();
    return this.debugMode;
  }

  /**
   * Get current debug mode state
   */
  public isDebugMode(): boolean {
    return this.debugMode;
  }

  /**
   * Set current player height for collision visualization
   */
  public setPlayerHeight(height: number): void {
    this.playerHeight = height;
    if (this.debugMode) {
      this.updateDebugVisualization();
    }
  }

  /**
   * Update debug visualization
   */
  public updateDebugVisualization(): void {
    // Clear existing helpers
    this.clearDebugHelpers();

    // If debug mode is off, we're done
    if (!this.debugMode) return;

    // Create visualization for car colliders
    this.createCarColliderVisualizations();

    // Create visualization for player collider
    this.createPlayerColliderVisualization(
      this.player.position,
      this.playerHeight
    );
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
    // This would need access to car colliders from CollisionSystem
    // For now, we can assume it would visualize boxes around cars
    // with correct rotations and dimensions
    // Example line for creating a box visualization:
    // const boxHelper = new THREE.BoxHelper(car, 0xff0000);
    // this.scene.add(boxHelper);
    // this.debugHelpers.push(boxHelper);
  }

  /**
   * Create visual representation of player collider
   */
  private createPlayerColliderVisualization(
    playerPosition: THREE.Vector3,
    playerHeight: number
  ): void {
    // Create wireframe box representing player hitbox
    const playerGeometry = new THREE.BoxGeometry(1, playerHeight, 1);
    const playerMesh = new THREE.Mesh(
      playerGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        wireframe: true,
        transparent: true,
        opacity: 0.5,
      })
    );

    playerMesh.position.copy(playerPosition);
    this.scene.add(playerMesh);
    this.debugHelpers.push(playerMesh);
  }
}
