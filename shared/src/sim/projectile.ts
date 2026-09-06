import type { Vec3 } from "../types";
import { type AABB, sweepSegmentRotatedAABB } from "./aabb";
import { add, lerp, normalize, rotateY, scale } from "./vec3";
import { pelletYawOffsets, type WeaponStats } from "./weapons";

/** A bullet in flight. Owned by the server; clients only render cosmetic copies. */
export interface Projectile {
  id: number;
  ownerId: string;
  weaponId: WeaponStats["id"];
  position: Vec3;
  /** Unit vector. */
  direction: Vec3;
  speed: number;
  damage: number;
  /** Distance covered so far. */
  traveled: number;
  maxRange: number;
}

/** Something a projectile can hit. */
export interface Collider<Tag = unknown> {
  /** The box in its own (unrotated) frame. */
  box: AABB;
  /** Rotation about the Y axis through the box centre, radians. Omit for axis-aligned. */
  yaw?: number;
  tag: Tag;
}

export interface SweepHit<Tag> {
  /** Parametric time along the step, 0..1. */
  t: number;
  point: Vec3;
  collider: Collider<Tag>;
}

/**
 * Create the pellets for one trigger pull: one projectile per pellet, fanned
 * around `direction` in the horizontal plane.
 */
export function spawnPellets(
  nextId: () => number,
  ownerId: string,
  weapon: WeaponStats,
  origin: Vec3,
  direction: Vec3
): Projectile[] {
  const dir = normalize(direction);
  return pelletYawOffsets(weapon).map((yaw) => ({
    id: nextId(),
    ownerId,
    weaponId: weapon.id,
    position: { ...origin },
    direction: yaw === 0 ? dir : rotateY(dir, yaw),
    speed: weapon.bulletSpeed,
    damage: weapon.damage,
    traveled: 0,
    maxRange: weapon.range,
  }));
}

/** Where the projectile will be after `dt` seconds if nothing stops it. */
export function projectileStepEnd(p: Projectile, dt: number): Vec3 {
  return add(p.position, scale(p.direction, p.speed * dt));
}

/**
 * Sweep the segment `from -> to` against every collider and return the
 * earliest hit, or null. Colliders for which `skip` returns true are ignored
 * (used to exclude the shooter).
 */
export function sweepProjectile<Tag>(
  from: Vec3,
  to: Vec3,
  colliders: Iterable<Collider<Tag>>,
  skip?: (c: Collider<Tag>) => boolean
): SweepHit<Tag> | null {
  let best: SweepHit<Tag> | null = null;
  for (const collider of colliders) {
    if (skip?.(collider)) continue;
    const t = sweepSegmentRotatedAABB(
      from,
      to,
      collider.box,
      collider.yaw ?? 0
    );
    if (t === null) continue;
    if (!best || t < best.t) {
      best = { t, point: lerp(from, to, t), collider };
    }
  }
  return best;
}

/**
 * Advance the projectile by `dt`, returning the hit if the swept path crosses a
 * collider. On a hit the projectile is left at the impact point; otherwise it
 * moves to the end of the step. Returns `{ expired: true }` once out of range.
 */
export function integrateProjectile<Tag>(
  p: Projectile,
  dt: number,
  colliders: Iterable<Collider<Tag>>,
  skip?: (c: Collider<Tag>) => boolean
): { hit: SweepHit<Tag> | null; expired: boolean } {
  const step = Math.min(p.speed * Math.max(0,dt), Math.max(0,p.maxRange-p.traveled));
  let to = add(p.position,scale(p.direction,step));
  let ground = false;
  if (to.y <= 0 && p.direction.y < 0) {
    const t=Math.max(0,p.position.y/(p.position.y-to.y));
    to=lerp(p.position,to,t);ground=true;
  }
  const hit = sweepProjectile(p.position, to, colliders, skip);

  if (hit) {
    p.traveled += Math.hypot(to.x-p.position.x,to.y-p.position.y,to.z-p.position.z) * hit.t;
    p.position = hit.point;
    return { hit, expired: true };
  }

  p.traveled += Math.hypot(to.x-p.position.x,to.y-p.position.y,to.z-p.position.z);
  p.position = to;
  return { hit: null, expired: ground || p.traveled >= p.maxRange - 1e-6 };
}
