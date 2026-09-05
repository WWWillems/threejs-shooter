import type { Vec3 } from "../types";
import { type AABB, aabbFromCenterSize, rotatedAabbContains } from "./aabb";
import type { Collider } from "./projectile";
import { PLAYER_SIZE } from "./spawnPoints";

/**
 * The one definition of a player's hitbox: a `PLAYER_SIZE` box centred on the
 * player's position and turned with the player (`yaw` = the mesh's
 * `rotation.y`). The server sweeps bullets against it, the client stops
 * cosmetic bullets on it, and the debug overlay draws exactly this.
 */
export interface PlayerHitbox {
  /** Box in the player's own frame (unrotated). */
  box: AABB;
  /** Rotation about Y through the box centre, radians. */
  yaw: number;
}

export const playerHitbox = (position: Vec3, yaw: number): PlayerHitbox => ({
  box: aabbFromCenterSize(position, PLAYER_SIZE),
  yaw,
});

export const playerHitboxContains = (hitbox: PlayerHitbox, p: Vec3): boolean =>
  rotatedAabbContains(hitbox.box, hitbox.yaw, p);

export const playerCollider = <Tag>(
  position: Vec3,
  yaw: number,
  tag: Tag
): Collider<Tag> => ({ ...playerHitbox(position, yaw), tag });
