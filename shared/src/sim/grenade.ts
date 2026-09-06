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

/**
 * The throwables. Every kind flies and bounces the same way; they differ in
 * what sets them off and what the detonation does:
 * - `frag` deals blast damage when the fuse runs out (see `blastDamage`).
 * - `smoke` leaves a cloud that hides whoever stands in or behind it.
 * - `flash` blinds everyone nearby who can see it (see `flashIntensity`).
 * - `gas` leaves a cloud that poisons whoever stands in it.
 * - `molotov` shatters on the first thing it hits (see `shattersOnImpact`)
 *   and leaves a pool of fire that burns whoever stands in it.
 */
export const GRENADE_KINDS = ["frag", "smoke", "flash", "gas", "molotov"] as const;
export type GrenadeKind = (typeof GRENADE_KINDS)[number];

export const isGrenadeKind = (value: unknown): value is GrenadeKind =>
  typeof value === "string" && (GRENADE_KINDS as readonly string[]).includes(value);

/** A molotov goes off on contact; every other kind waits for its fuse. */
export const shattersOnImpact = (kind: GrenadeKind): boolean => kind === "molotov";

/**
 * How many of each kind a player spawns with, and how many a throwable pickup
 * grants. Gas and molotovs are loot only. Counts are client-trusted like ammo.
 */
export const GRENADE_LOADOUT: Record<GrenadeKind, { start: number; pickup: number }> = {
  frag: { start: 2, pickup: 2 },
  smoke: { start: 1, pickup: 2 },
  flash: { start: 1, pickup: 2 },
  gas: { start: 0, pickup: 2 },
  molotov: { start: 0, pickup: 2 },
};

/** The lingering area a grenade can leave behind: smoke, gas or a pool of fire. */
export const CLOUD_KINDS = ["smoke", "gas", "fire"] as const;
export type CloudKind = (typeof CLOUD_KINDS)[number];

/** Per-kind tuning for what the detonation does. Server-authoritative. */
export const GRENADE_EFFECTS = {
  smoke: {
    /** Cloud radius, u. */
    radius: 3.5,
    /** Seconds the cloud lingers. */
    duration: 9,
  },
  gas: {
    radius: 3,
    duration: 8,
    /** Damage per second to anyone standing inside. */
    dps: 12,
  },
  flash: {
    /** Blinding falls off linearly to zero at this distance. */
    radius: 9,
    /** Seconds of full blindness at the centre; scaled by intensity. */
    blindDuration: 4.25,
  },
  molotov: {
    /** Radius of the burning pool, u. */
    radius: 2.5,
    /** Seconds the fire burns. */
    duration: 6,
    /** Damage per second to anyone standing in the fire: fast, so it clears cover. */
    dps: 25,
  },
} as const;

/** Tuning of each cloud kind, and which grenade leaves it. */
export const CLOUD_EFFECTS: Record<
  CloudKind,
  { radius: number; duration: number; dps: number; source: GrenadeKind }
> = {
  smoke: { ...GRENADE_EFFECTS.smoke, dps: 0, source: "smoke" },
  gas: { ...GRENADE_EFFECTS.gas, source: "gas" },
  fire: { ...GRENADE_EFFECTS.molotov, source: "molotov" },
};

/** The cloud a grenade kind leaves behind, or null for the kinds that leave none. */
export function cloudKindOf(kind: GrenadeKind): CloudKind | null {
  switch (kind) {
    case "smoke":
      return "smoke";
    case "gas":
      return "gas";
    case "molotov":
      return "fire";
    case "frag":
    case "flash":
      return null;
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled grenade kind: ${String(unhandled)}`);
    }
  }
}

/** How tall a cloud reaches above its centre; it sits on the ground. */
const CLOUD_HEIGHT = 2.5;

/** A grenade in flight or at rest. Owned by the server. */
export interface Grenade {
  id: string;
  kind: GrenadeKind;
  ownerId: string;
  position: Vec3;
  velocity: Vec3;
  /** Seconds until detonation. */
  fuse: number;
}

/** What a snapshot carries per grenade. */
export interface GrenadeSnapshot {
  id: string;
  kind: GrenadeKind;
  ownerId: string;
  position: Vec3;
}

/** A smoke, gas or fire cloud left by a grenade. Owned by the server. */
export interface Cloud {
  id: string;
  kind: CloudKind;
  /** Who threw the grenade; gas and fire kills credit them. */
  ownerId: string;
  /** Centre on the ground. */
  position: Vec3;
  /** Seconds until the cloud is gone. */
  remaining: number;
}

/** What a snapshot carries per cloud. */
export interface CloudSnapshot {
  id: string;
  kind: CloudKind;
  position: Vec3;
  remaining: number;
}

/** The cloud a `kind` grenade leaves when it goes off at `position`. */
export function spawnCloud(id: string, grenade: Pick<Grenade, "ownerId" | "position">, kind: CloudKind): Cloud {
  return {
    id,
    kind,
    ownerId: grenade.ownerId,
    position: { x: grenade.position.x, y: 0, z: grenade.position.z },
    remaining: CLOUD_EFFECTS[kind].duration,
  };
}

/** True while `point` (a body centre) stands inside the cloud's cylinder. */
export function cloudContains(cloud: Pick<Cloud, "kind" | "position">, point: Vec3): boolean {
  const { radius } = CLOUD_EFFECTS[cloud.kind];
  const dy = point.y - cloud.position.y;
  if (dy < -0.5 || dy > CLOUD_HEIGHT) return false;
  return Math.hypot(point.x - cloud.position.x, point.z - cloud.position.z) < radius;
}

/**
 * True when the segment `from` -> `to` passes through the cloud, so whatever
 * stands at `to` cannot be seen from `from`. Only smoke is thick enough to
 * hide anything; gas is a haze.
 */
export function cloudObscures(from: Vec3, to: Vec3, cloud: Pick<Cloud, "kind" | "position" | "remaining">): boolean {
  if (cloud.kind !== "smoke" || cloud.remaining <= 0.75) return false;
  const { radius } = GRENADE_EFFECTS.smoke;
  const centre = vec3(cloud.position.x, cloud.position.y + CLOUD_HEIGHT / 2, cloud.position.z);
  return segmentDistance(from, to, centre) < radius;
}

/**
 * Fraction (0..1) of full blinding a flash at `center` inflicts on someone at
 * `target`, falling off linearly to zero at the flash radius. Callers decide
 * line of sight; a wall between the two blocks the flash entirely.
 */
export function flashIntensity(center: Vec3, target: Vec3): number {
  const d = distance(center, target);
  const { radius } = GRENADE_EFFECTS.flash;
  if (d >= radius) return 0;
  return Math.round((1 - d / radius) * 100) / 100;
}

/** Shortest distance from `point` to the segment `a` -> `b`. */
function segmentDistance(a: Vec3, b: Vec3, point: Vec3): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const px = point.x - a.x, py = point.y - a.y, pz = point.z - a.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / lengthSquared)) : 0;
  return Math.hypot(px - t * dx, py - t * dy, pz - t * dz);
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
  kind: GrenadeKind,
  origin: Vec3,
  direction: Vec3
): Grenade {
  const dir = normalize(direction);
  return {
    id,
    kind,
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
