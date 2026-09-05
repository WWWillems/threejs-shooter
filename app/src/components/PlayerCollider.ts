import * as THREE from "three";
import {
  PLAYER_SIZE,
  playerHitbox,
  playerHitboxContains,
  type PlayerHitbox,
} from "@threejs-shooter/shared";

/**
 * Standard player dimensions. Sourced from the shared sim so the client's
 * cosmetic checks and debug overlay match the server's hitbox exactly.
 */
export const PLAYER_DIMENSIONS = {
  width: PLAYER_SIZE.x,
  height: PLAYER_SIZE.y,
  depth: PLAYER_SIZE.z,
};

/**
 * Client-side view of the shared player hitbox. Everything here is derived
 * from `playerHitbox`, so the debug box is by construction the box bullets
 * are tested against.
 */
export class PlayerCollider {
  /** The hitbox for a player mesh: its position and its facing (`rotation.y`). */
  public static hitboxFor(playerMesh: THREE.Object3D): PlayerHitbox {
    return playerHitbox(playerMesh.position, playerMesh.rotation.y);
  }

  /** Whether a world point is inside the player's rotated hitbox. */
  public static containsPoint(
    playerMesh: THREE.Object3D,
    point: THREE.Vector3
  ): boolean {
    return playerHitboxContains(PlayerCollider.hitboxFor(playerMesh), point);
  }

  /**
   * Wireframe of the hitbox for the debug overlay. Same box, same rotation as
   * the one `containsPoint` tests against.
   */
  public static createDebugMesh(
    playerMesh: THREE.Object3D,
    color: number = 0x00ff00,
    opacity: number = 0.5
  ): THREE.Mesh {
    const { box, yaw } = PlayerCollider.hitboxFor(playerMesh);

    const geometry = new THREE.BoxGeometry(
      box.max.x - box.min.x,
      box.max.y - box.min.y,
      box.max.z - box.min.z
    );
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity,
      })
    );
    mesh.position.set(
      (box.min.x + box.max.x) / 2,
      (box.min.y + box.max.y) / 2,
      (box.min.z + box.max.z) / 2
    );
    mesh.rotation.y = yaw;
    return mesh;
  }

  /**
   * Axis-aligned box for movement collision against the static world (cars,
   * lights, crates). Movement is client-owned and does not use the rotated
   * hitbox; this keeps the previous behaviour.
   */
  public static createMovementBox(
    position: THREE.Vector3,
    playerHeight: number = PLAYER_DIMENSIONS.height
  ): THREE.Box3 {
    return new THREE.Box3().setFromCenterAndSize(
      position.clone(),
      new THREE.Vector3(
        PLAYER_DIMENSIONS.width,
        playerHeight,
        PLAYER_DIMENSIONS.depth
      )
    );
  }
}
