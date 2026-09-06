import type { PickupSpec, Vec3 } from "../types";
import { aabbFromCenterSize, aabbIntersects, type AABB } from "./aabb";
import { GROUND_SIZE } from "./mapLayout";
import type { Rng } from "./rng";
import { vec3 } from "./vec3";
import { GRENADE_KINDS, GRENADE_LOADOUT } from "./grenade";
import { WEAPON_IDS, WEAPONS } from "./weapons";

/** Rules for server-owned pickups. Clients only render what they are told. */

/** How close (in world units, XZ) a player must be to claim a pickup. Generous for latency. */
export const PICKUP_REACH = 2.0;
/** Seconds a pickup lies around before it expires. */
export const PICKUP_LIFETIME = 30;
/** Never more than this many pickups at once. */
export const PICKUP_MAX_COUNT = 10;
/** Random spawn cadence, seconds. */
export const PICKUP_SPAWN_INTERVAL: readonly [number, number] = [5, 15];
/** Height at which a pickup rests. */
export const PICKUP_HEIGHT = 0.5;
/** Footprint used when checking a spawn spot is clear. */
const PICKUP_FOOTPRINT: Vec3 = vec3(1, 1, 1);
/** Keep random spawns at least this far from any player. */
const PICKUP_PLAYER_CLEARANCE = 10;
/** Chance a destroyed crate drops something. */
export const CRATE_DROP_CHANCE = 0.5;

/** Whether `playerPos` is within reach of `pickupPos` on the ground plane. */
export function isWithinPickupReach(playerPos: Vec3, pickupPos: Vec3): boolean {
  const dx = playerPos.x - pickupPos.x;
  const dz = playerPos.z - pickupPos.z;
  return dx * dx + dz * dz <= PICKUP_REACH * PICKUP_REACH;
}

/** Roll the contents of a random pickup (health or ammo for a random weapon). */
export function rollPickupContents(
  rng: Rng,
  id: string,
  position: Vec3
): PickupSpec {
  const roll = rng.next();
  if (roll < .15) return { id, kind: "armor", position, amount: 25 };
  if (roll < 0.5) {
    return {
      id,
      kind: "health",
      position,
      amount: Math.floor(rng.range(10, 50)),
    };
  }
  const weaponId = WEAPON_IDS[rng.int(WEAPON_IDS.length)];
  return {
    id,
    kind: "ammo",
    position,
    weaponId,
    amount: WEAPONS[weaponId].ammoPickup,
  };
}

/** How the drop of a destroyed crate splits, cumulative: weapon, throwable, health, else ammo. */
export const CRATE_DROP_ODDS = { weapon: 0.3, throwable: 0.5, health: 0.75 } as const;

/**
 * Contents of the drop a destroyed crate leaves behind: any weapon (loaded,
 * with a modest ammo bundle; owned ones become ammo on the client), a handful
 * of any throwable, health, or ammo for any weapon.
 */
export function rollCrateDrop(rng: Rng, id: string, position: Vec3): PickupSpec {
  const roll = rng.next();
  if (roll < CRATE_DROP_ODDS.weapon) {
    const weaponId = WEAPON_IDS[rng.int(WEAPON_IDS.length)];
    return { id, kind: "weapon", position, weaponId, amount: WEAPONS[weaponId].ammoPickup };
  }
  if (roll < CRATE_DROP_ODDS.throwable) {
    const grenadeKind = GRENADE_KINDS[rng.int(GRENADE_KINDS.length)];
    return { id, kind: "throwable", position, grenadeKind, amount: GRENADE_LOADOUT[grenadeKind].pickup };
  }
  if (roll >= .9) return { id, kind: "armor", position, amount: 25 };
  if (roll < CRATE_DROP_ODDS.health) {
    return { id, kind: "health", position, amount: 25 };
  }
  const weaponId = WEAPON_IDS[rng.int(WEAPON_IDS.length)];
  return {
    id,
    kind: "ammo",
    position,
    weaponId,
    amount: WEAPONS[weaponId].ammoPickup,
  };
}

/**
 * Find a spot on the ground that does not overlap any blocker and is away
 * from every player. Returns null if no spot was found within the attempts.
 */
export function findPickupSpawnPosition(
  rng: Rng,
  blockers: AABB[],
  playerPositions: Vec3[],
  attempts = 30
): Vec3 | null {
  const half = GROUND_SIZE / 2 - 2;
  for (let i = 0; i < attempts; i++) {
    const candidate = vec3(rng.range(-half, half), PICKUP_HEIGHT, rng.range(-half, half));

    const tooClose = playerPositions.some((p) => {
      const dx = p.x - candidate.x;
      const dz = p.z - candidate.z;
      return dx * dx + dz * dz < PICKUP_PLAYER_CLEARANCE * PICKUP_PLAYER_CLEARANCE;
    });
    if (tooClose) continue;

    const footprint = aabbFromCenterSize(candidate, PICKUP_FOOTPRINT);
    if (blockers.some((b) => aabbIntersects(footprint, b))) continue;

    return candidate;
  }
  return null;
}
