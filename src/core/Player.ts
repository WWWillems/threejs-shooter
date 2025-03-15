import * as THREE from "three";

export class Player {
  private playerMesh: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    // Create a player object
    const playerGeometry = new THREE.BoxGeometry(1, 2, 1); // A bit taller than wide
    const playerMaterial = new THREE.MeshStandardMaterial({ color: 0xffaa00 }); // Orange-yellow color
    this.playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
    this.playerMesh.position.set(0, 1, 0); // Position at origin, 1 unit above ground (half player height)
    this.playerMesh.castShadow = true;
    this.playerMesh.receiveShadow = true;

    // Add to scene
    scene.add(this.playerMesh);
  }

  /**
   * Get the player mesh
   * @returns The player mesh object
   */
  public getMesh(): THREE.Mesh {
    return this.playerMesh;
  }

  /**
   * Set player position
   * @param position New position vector
   */
  public setPosition(position: THREE.Vector3): void {
    this.playerMesh.position.copy(position);
  }

  /**
   * Get player position
   * @returns Current player position
   */
  public getPosition(): THREE.Vector3 {
    return this.playerMesh.position.clone();
  }

  /**
   * Set player rotation
   * @param rotation Rotation value (radians)
   */
  public setRotation(rotation: number): void {
    this.playerMesh.rotation.y = rotation;
  }

  /**
   * Get player rotation
   * @returns Current player Y rotation
   */
  public getRotation(): number {
    return this.playerMesh.rotation.y;
  }
}
