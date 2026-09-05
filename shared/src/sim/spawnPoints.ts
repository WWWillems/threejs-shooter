import type { Vec3 } from "../types";
import { vec3 } from "./vec3";

/** Player collision box, matching the client's PLAYER_DIMENSIONS. */
export const PLAYER_SIZE: Vec3 = vec3(1, 2, 1);
export const PLAYER_MAX_HP = 100;

/**
 * Five spawn points per team, spread along each spawn street with a piece of
 * the cover line between each one and mid: the south team's along the -Z
 * wall, the north team's along +Z (see `generateMap`). Player feet are at
 * y = 1 (mesh centre).
 */
export const SPAWN_POINTS: readonly Vec3[] = [
  vec3(-16, 1, -33),
  vec3(-11, 1, -34),
  vec3(0, 1, -34),
  vec3(11, 1, -34),
  vec3(16, 1, -33),
  vec3(16, 1, 33),
  vec3(11, 1, 34),
  vec3(0, 1, 34),
  vec3(-11, 1, 34),
  vec3(-16, 1, 33),
];

/** Yaw that makes the player face the centre of the map from `position`. */
export const facingCenterYaw = (position: Vec3): number =>
  Math.atan2(position.x, position.z);

/** Pick the spawn point farthest from any listed position (simple anti-spawn-camping). */
export function pickSpawnPoint(
  occupied: Iterable<Vec3>,
  points: readonly Vec3[] = SPAWN_POINTS
): Vec3 {
  const others = [...occupied];
  if (others.length === 0) return points[0];

  let best = points[0];
  let bestScore = -Infinity;
  for (const p of points) {
    let nearest = Infinity;
    for (const o of others) {
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      nearest = Math.min(nearest, dx * dx + dz * dz);
    }
    if (nearest > bestScore) {
      bestScore = nearest;
      best = p;
    }
  }
  return best;
}
