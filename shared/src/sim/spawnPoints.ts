import type { Vec3 } from "../types";
import { vec3 } from "./vec3";

/** Player collision box, matching the client's PLAYER_DIMENSIONS. */
export const PLAYER_SIZE: Vec3 = vec3(1, 2, 1);
export const PLAYER_MAX_HP = 100;

/** Open spots away from the prop clusters. Player feet are at y = 1 (mesh centre). */
export const SPAWN_POINTS: readonly Vec3[] = [
  vec3(0, 1, 0),
  vec3(12, 1, -4),
  vec3(-12, 1, 0),
  vec3(0, 1, 15),
  vec3(-6, 1, -14),
  vec3(14, 1, 6),
  vec3(-14, 1, 16),
  vec3(8, 1, -18),
];

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
