import type { Vec3 } from "../types";
import type { Team } from "./teams";
import { vec3 } from "./vec3";

/** Player collision box, matching the client's PLAYER_DIMENSIONS. */
export const PLAYER_SIZE: Vec3 = vec3(1, 2, 1);
export const PLAYER_MAX_HP = 100;

/** A place a player can (re)spawn, owned by one team. */
export interface SpawnPoint {
  position: Vec3;
  team: Team;
}

const spawn = (x: number, y: number, z: number, team: Team): SpawnPoint => ({
  position: vec3(x, y, z),
  team,
});

/**
 * Five spawn points per team, spread along each spawn street with a piece of
 * the cover line between each one and mid: blue's along the -Z wall, red's
 * along +Z (see `generateMap`). Player feet are at y = 1 (mesh centre).
 */
export const SPAWN_POINTS: readonly SpawnPoint[] = [
  spawn(-16, 1, -33, "blue"),
  spawn(-11, 1, -34, "blue"),
  spawn(0, 1, -34, "blue"),
  spawn(11, 1, -34, "blue"),
  spawn(16, 1, -33, "blue"),
  spawn(16, 1, 33, "red"),
  spawn(11, 1, 34, "red"),
  spawn(0, 1, 34, "red"),
  spawn(-11, 1, 34, "red"),
  spawn(-16, 1, 33, "red"),
];

/** Yaw that makes the player face the centre of the map from `position`. */
export const facingCenterYaw = (position: Vec3): number =>
  Math.atan2(position.x, position.z);

/** The spawn points belonging to `team`. */
export const spawnPointsFor = (
  team: Team,
  points: readonly SpawnPoint[] = SPAWN_POINTS
): SpawnPoint[] => points.filter((point) => point.team === team);

/**
 * Pick the spawn point farthest from any listed position (simple
 * anti-spawn-camping). Callers pass the team's own points; `points` must not
 * be empty.
 */
export function pickSpawnPoint(
  occupied: Iterable<Vec3>,
  points: readonly SpawnPoint[] = SPAWN_POINTS
): Vec3 {
  if (points.length === 0) throw new Error("pickSpawnPoint needs at least one spawn point");
  const others = [...occupied];
  if (others.length === 0) return points[0].position;

  let best = points[0].position;
  let bestScore = -Infinity;
  for (const { position: p } of points) {
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
