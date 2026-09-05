import * as THREE from "three";

/**
 * Standard player dimensions used throughout the game
 */
export const PLAYER_DIMENSIONS = {
  width: 1,
  height: 2,
  depth: 1,
};

/**
 * Utility class for handling player collision boxes consistently across the game
 */
export class PlayerCollider {
  /**
   * Create a collision box for a player at the given position
   */
  public static createCollisionBox(
    position: THREE.Vector3,
    playerHeight: number = PLAYER_DIMENSIONS.height
  ): THREE.Box3 {
    // Create a box with standard player dimensions
    return new THREE.Box3().setFromCenterAndSize(
      position.clone(),
      new THREE.Vector3(
        PLAYER_DIMENSIONS.width,
        playerHeight,
        PLAYER_DIMENSIONS.depth
      )
    );
  }

  /**
   * Create a visual debug box for the player
   */
  public static createDebugMesh(
    position: THREE.Vector3,
    playerHeight: number = PLAYER_DIMENSIONS.height,
    color: number = 0x00ff00,
    opacity: number = 0.5
  ): THREE.Mesh {
    // Create wireframe box representing player hitbox
    const playerGeometry = new THREE.BoxGeometry(
      PLAYER_DIMENSIONS.width,
      playerHeight,
      PLAYER_DIMENSIONS.depth
    );

    const playerMesh = new THREE.Mesh(
      playerGeometry,
      new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity,
      })
    );

    playerMesh.position.copy(position);
    return playerMesh;
  }

  /**
   * Get player height from a mesh if available
   */
  public static getPlayerHeight(playerMesh: THREE.Object3D): number {
    // First try to get height from userData.controller
    if (playerMesh.userData?.controller?.getPlayerHeight) {
      return playerMesh.userData.controller.getPlayerHeight();
    }

    // Then try to get height from mesh geometry
    if (
      playerMesh instanceof THREE.Mesh &&
      playerMesh.geometry instanceof THREE.BoxGeometry
    ) {
      return playerMesh.geometry.parameters.height;
    }

    // Then try userData directly
    if (playerMesh.userData?.height) {
      return playerMesh.userData.height;
    }

    // Default fallback
    return PLAYER_DIMENSIONS.height;
  }
}
