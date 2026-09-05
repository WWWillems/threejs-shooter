import type { Vec3 } from "../types";
import { type AABB, sweepSegmentAABB } from "./aabb";
import type { Collider } from "./projectile";
import { add, distance, length, lerp, normalize, scale, vec3 } from "./vec3";

/** Grenade tuning. Server-authoritative; clients only render. */
export const GRENADE = {
  /** Downward acceleration, u/s². */
  gravity: 20,
  /** Velocity kept along the surface normal after a bounce. */
  restitution: 0.45,
  /** Velocity kept tangential to the surface after a bounce. */
  friction: 0.75,
  /** Seconds from throw to detonation. */
  fuse: 2.5,
  /** Collision radius. */
  radius: 0.15,
  /** Damage falls off linearly to zero at this distance. */
  blastRadius: 5,
  /** Damage at the centre of the blast. */
  maxDamage: 90,
  /** Throw speed along the aim direction, u/s. */
  throwSpeed: 14,
  /** Extra upward speed added to every throw for an arc. */
  throwLift: 4,
  /** Minimum seconds between throws per player. */
  throwCooldown: 1.5,
  /** Below this speed a bounce leaves the grenade resting. */
  restSpeed: 0.5,
} as const;

/** A grenade in flight or at rest. Owned by the server. */
export interface Grenade {
  id: string;
  ownerId: string;
  position: Vec3;
  velocity: Vec3;
  /** Seconds until detonation. */
  fuse: number;
}

/** What a snapshot carries per grenade. */
export interface GrenadeSnapshot {
  id: string;
  ownerId: string;
  position: Vec3;
}

export interface Bounce<Tag> {
  point: Vec3;
  normal: Vec3;
  /** Collider bounced off, or null for the ground. */
  collider: Collider<Tag> | null;
}

export function spawnGrenade(
  id: string,
  ownerId: string,
  origin: Vec3,
  direction: Vec3
): Grenade {
  const dir = normalize(direction);
  return {
    id,
    ownerId,
    position: { ...origin },
    velocity: add(scale(dir, GRENADE.throwSpeed), vec3(0, GRENADE.throwLift, 0)),
    fuse: GRENADE.fuse,
  };
}

/**
 * Advance the grenade by `dt`: gravity, one swept collision against the
 * ground plane (y = 0) and `colliders`, and a bounce if something was hit.
 * Returns the bounce for cosmetic use, or null. Sets `fuse` down by `dt`;
 * callers detonate when it reaches zero.
 */
export function integrateGrenade<Tag>(
  g: Grenade,
  dt: number,
  colliders: Iterable<Collider<Tag>>
): Bounce<Tag> | null {
  g.fuse -= dt;

  g.velocity = add(g.velocity, vec3(0, -GRENADE.gravity * dt, 0));
  const from = g.position;
  const to = add(from, scale(g.velocity, dt));

  let bestT = Infinity;
  let bounce: Bounce<Tag> | null = null;

  // Ground plane at y = radius
  if (to.y < GRENADE.radius && from.y >= GRENADE.radius) {
    const t = (from.y - GRENADE.radius) / (from.y - to.y);
    bestT = t;
    bounce = { point: lerp(from, to, t), normal: vec3(0, 1, 0), collider: null };
  } else if (to.y < GRENADE.radius) {
    // Already below (spawned inside the floor); pop it up.
    bestT = 0;
    bounce = {
      point: vec3(from.x, GRENADE.radius, from.z),
      normal: vec3(0, 1, 0),
      collider: null,
    };
  }

  for (const collider of colliders) {
    const box = inflate(collider.box, GRENADE.radius);
    const t = sweepSegmentAABB(from, to, box);
    if (t === null || t >= bestT) continue;
    const point = lerp(from, to, t);
    bestT = t;
    bounce = { point, normal: faceNormal(box, point, g.velocity), collider };
  }

  if (!bounce) {
    g.position = to;
    return null;
  }

  // Reflect: split velocity into normal and tangential parts.
  const n = bounce.normal;
  const vn = g.velocity.x * n.x + g.velocity.y * n.y + g.velocity.z * n.z;
  const normalPart = scale(n, vn);
  const tangent = add(g.velocity, scale(normalPart, -1));
  g.velocity = add(
    scale(normalPart, -GRENADE.restitution),
    scale(tangent, GRENADE.friction)
  );
  if (length(g.velocity) < GRENADE.restSpeed) {
    g.velocity = vec3(0, 0, 0);
  }

  // Leave the grenade a hair off the surface so the next sweep starts outside.
  g.position = add(bounce.point, scale(n, 1e-3));
  return bounce;
}

/** Damage dealt to a point `target` by a blast centred at `center`; 0 outside the radius. */
export function blastDamage(center: Vec3, target: Vec3): number {
  const d = distance(center, target);
  if (d >= GRENADE.blastRadius) return 0;
  return Math.round(GRENADE.maxDamage * (1 - d / GRENADE.blastRadius));
}

/** Expand a box by `r` on every side (Minkowski sum with a sphere, approximated). */
function inflate(box: AABB, r: number): AABB {
  return {
    min: vec3(box.min.x - r, box.min.y - r, box.min.z - r),
    max: vec3(box.max.x + r, box.max.y + r, box.max.z + r),
  };
}

/**
 * Normal of the face of `box` that `point` lies on. Ties (corners) are broken
 * towards the axis the grenade is moving along most, against its motion.
 */
function faceNormal(box: AABB, point: Vec3, velocity: Vec3): Vec3 {
  const axes: ("x" | "y" | "z")[] = ["x", "y", "z"];
  let best: Vec3 = vec3(0, 1, 0);
  let bestDist = Infinity;
  for (const axis of axes) {
    const dMin = Math.abs(point[axis] - box.min[axis]);
    const dMax = Math.abs(point[axis] - box.max[axis]);
    const candidates: [number, number][] = [
      [dMin, -1],
      [dMax, 1],
    ];
    for (const [dist, sign] of candidates) {
      // Only faces the grenade is moving into count.
      if (sign * velocity[axis] > 0) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = vec3(0, 0, 0);
        best[axis] = sign;
      }
    }
  }
  return best;
}
