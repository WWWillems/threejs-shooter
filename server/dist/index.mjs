import express from 'express';
import * as http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const GAME_EVENTS = {
  GAME: {
    /** Server -> joining client: snapshot of all players currently in the game. */
    STATE: "game:state"
  },
  WORLD: {
    /** Server -> all, every tick: continuous state of everything that moves. */
    SNAPSHOT: "world:snapshot"
  },
  USER: {
    /** Server -> others: a socket connected (before it joined the game). */
    CONNECTED: "user:connected",
    /** Client -> server: join the game. Server -> others: someone joined. */
    JOINED: "user:joined",
    /** Server -> others: a player left. */
    DISCONNECTED: "user:disconnected"
  },
  PLAYER: {
    /** Client -> server: my position. Replicated to others via WORLD.SNAPSHOT. */
    POSITION: "player:position",
    /** Client -> server: I want to respawn. Server -> all: a player respawned here. */
    RESPAWN: "player:respawn"
  },
  WEAPON: {
    /** Client -> server: fire intent. Server -> others: someone fired (cosmetic bullet). */
    SHOOT: "weapon:shoot",
    /** Client -> server: I switched weapon. Server -> others: same. */
    SWITCH: "weapon:switch"
  },
  COMBAT: {
    /** Server -> all: a server bullet hit a player. */
    HIT: "combat:hit",
    /** Server -> all: a player's HP reached zero. */
    KILL: "combat:kill"
  },
  CRATE: {
    /** Server -> all: a crate took damage. */
    DAMAGED: "crate:damaged",
    /** Server -> all: a crate's HP reached zero; remove it. */
    DESTROYED: "crate:destroyed"
  },
  GRENADE: {
    /** Client -> server: throw intent. Server -> others: someone threw (cosmetic). */
    THROW: "grenade:throw",
    /** Server -> all: a grenade detonated; damage travels as COMBAT.HIT. */
    EXPLODED: "grenade:exploded"
  },
  PICKUP: {
    /** Server -> all: a pickup appeared in the world. */
    SPAWNED: "pickup:spawned",
    /** Client -> server: I'm standing on this pickup and want it. */
    CLAIM: "pickup:claim",
    /** Server -> all: a player took a pickup. */
    TAKEN: "pickup:taken",
    /** Server -> all: a pickup timed out. */
    EXPIRED: "pickup:expired"
  }
};

const TICK_RATE = 20;

const vec3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a, s) => vec3(a.x * s, a.y * s, a.z * s);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a) => Math.sqrt(dot(a, a));
const distance = (a, b) => length(sub(a, b));
const normalize = (a) => {
  const len = length(a);
  return len > 0 ? scale(a, 1 / len) : vec3(0, 0, -1);
};
const lerp = (a, b, t) => vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
const rotateY = (v, angle) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
};

const aabbFromCenterSize = (center, size) => ({
  min: vec3(center.x - size.x / 2, center.y - size.y / 2, center.z - size.z / 2),
  max: vec3(center.x + size.x / 2, center.y + size.y / 2, center.z + size.z / 2)
});
const aabbFromBaseSize = (base, size) => ({
  min: vec3(base.x - size.x / 2, base.y, base.z - size.z / 2),
  max: vec3(base.x + size.x / 2, base.y + size.y, base.z + size.z / 2)
});
const aabbFromRotatedBox = (center, size, angle) => {
  const hx = size.x / 2;
  const hz = size.z / 2;
  const corners = [
    rotateY(vec3(hx, 0, hz), angle),
    rotateY(vec3(-hx, 0, hz), angle),
    rotateY(vec3(hx, 0, -hz), angle),
    rotateY(vec3(-hx, 0, -hz), angle)
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z);
    maxZ = Math.max(maxZ, c.z);
  }
  return {
    min: vec3(center.x + minX, center.y - size.y / 2, center.z + minZ),
    max: vec3(center.x + maxX, center.y + size.y / 2, center.z + maxZ)
  };
};
const aabbIntersects = (a, b) => a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;
const aabbCenter = (box) => vec3(
  (box.min.x + box.max.x) / 2,
  (box.min.y + box.max.y) / 2,
  (box.min.z + box.max.z) / 2
);
function sweepSegmentAABB(from, to, box) {
  let tMin = 0;
  let tMax = 1;
  const axes = ["x", "y", "z"];
  for (const axis of axes) {
    const d = to[axis] - from[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    const start = from[axis];
    if (Math.abs(d) < 1e-12) {
      if (start < lo || start > hi) return null;
      continue;
    }
    let t1 = (lo - start) / d;
    let t2 = (hi - start) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}
const toRotatedBoxFrame = (box, yaw, p) => {
  const c = aabbCenter(box);
  return add(rotateY(sub(p, c), -yaw), c);
};
function sweepSegmentRotatedAABB(from, to, box, yaw) {
  if (yaw === 0) return sweepSegmentAABB(from, to, box);
  return sweepSegmentAABB(
    toRotatedBoxFrame(box, yaw, from),
    toRotatedBoxFrame(box, yaw, to),
    box
  );
}

var __defProp$2 = Object.defineProperty;
var __defNormalProp$2 = (obj, key, value) => key in obj ? __defProp$2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$2 = (obj, key, value) => __defNormalProp$2(obj, key + "" , value);
class Rng {
  constructor(seed) {
    __publicField$2(this, "state");
    this.state = seed >>> 0;
  }
  /** Uniform float in [0, 1). */
  next() {
    this.state = this.state + 1831565813 >>> 0;
    let t = this.state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  /** Uniform float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }
  /** Uniform integer in [0, n). */
  int(n) {
    return Math.floor(this.next() * n);
  }
}

const WEAPONS = {
  pistol: {
    id: "pistol",
    name: "Pistol",
    fireRate: 0.4,
    damage: 25,
    bulletSpeed: 30,
    range: 90,
    magazineSize: 12,
    reserveAmmo: 120,
    reloadTime: 1.2,
    pellets: 1,
    spreadAngle: 0
  },
  rifle: {
    id: "rifle",
    name: "Assault Rifle",
    fireRate: 0.1,
    damage: 25,
    bulletSpeed: 30,
    range: 90,
    magazineSize: 30,
    reserveAmmo: 150,
    reloadTime: 2,
    pellets: 1,
    spreadAngle: 0
  },
  shotgun: {
    id: "shotgun",
    name: "Shotgun",
    fireRate: 0.8,
    damage: 25,
    bulletSpeed: 30,
    range: 90,
    magazineSize: 6,
    reserveAmmo: 30,
    reloadTime: 0.5,
    pellets: 3,
    spreadAngle: 0.1
  }
};
const WEAPON_IDS = ["pistol", "rifle", "shotgun"];
const isWeaponId = (value) => typeof value === "string" && WEAPON_IDS.includes(value);
function pelletYawOffsets(weapon) {
  const offsets = [];
  const mid = (weapon.pellets - 1) / 2;
  for (let i = 0; i < weapon.pellets; i++) {
    offsets.push((i - mid) * weapon.spreadAngle);
  }
  return offsets;
}

function spawnPellets(nextId, ownerId, weapon, origin, direction) {
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
    maxRange: weapon.range
  }));
}
function projectileStepEnd(p, dt) {
  return add(p.position, scale(p.direction, p.speed * dt));
}
function sweepProjectile(from, to, colliders, skip) {
  let best = null;
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
function integrateProjectile(p, dt, colliders, skip) {
  const to = projectileStepEnd(p, dt);
  const hit = sweepProjectile(p.position, to, colliders, skip);
  if (hit) {
    p.traveled += p.speed * dt * hit.t;
    p.position = hit.point;
    return { hit, expired: true };
  }
  p.traveled += p.speed * dt;
  p.position = to;
  return { hit: null, expired: p.traveled >= p.maxRange };
}

const MAP_SEED = 20240913;
const GROUND_SIZE = 100;
const WALL_HEIGHT = 2.5;
const WALL_THICKNESS = 0.5;
const CAR_SIZE = vec3(2.4, 1.8, 5);
const STREET_LIGHT_SIZE = vec3(0.4, 6.3, 0.4);
const SHOP_SIZE = vec3(10, 4, 8);
const CRATE_MAX_HP = 100;
const PI = Math.PI;
function generateMap(seed = MAP_SEED) {
  const rng = new Rng(seed);
  const cars = [
    { id: "car-0", position: vec3(8, 0, 9), rotation: -PI / 5, tiltZ: PI / 30 },
    { id: "car-1", position: vec3(12, 0, 15), rotation: PI / 3, tiltZ: 0 },
    { id: "car-2", position: vec3(-15, 0, -12), rotation: PI / 8, tiltZ: 0 }
  ];
  const streetLights = [
    vec3(10, 0, 12),
    vec3(-10, 0, -8),
    vec3(-5, 0, 15),
    vec3(15, 0, -15)
  ];
  const shop = { position: vec3(0, 0, -20), size: SHOP_SIZE };
  const crates = generateCrates(rng);
  const cones = generateCones(rng);
  const blockers = [
    aabbFromBaseSize(shop.position, shop.size),
    ...cars.map((c) => carBox(c)),
    ...crates.map((c) => crateBox(c))
  ];
  const trees = generateTrees(rng, blockers);
  const bushes = generateBushes(rng, blockers);
  return {
    seed,
    walls: generateWalls(),
    shop,
    cars,
    streetLights,
    crates,
    cones,
    trees,
    bushes
  };
}
function generateWalls() {
  const half = GROUND_SIZE / 2;
  const t = WALL_THICKNESS;
  const h = WALL_HEIGHT;
  return [
    // North (+Z) and South (-Z)
    aabbFromBaseSize(vec3(0, 0, half + t / 2), vec3(GROUND_SIZE + t, h, t)),
    aabbFromBaseSize(vec3(0, 0, -half - t / 2), vec3(GROUND_SIZE + t, h, t)),
    // East (+X) and West (-X)
    aabbFromBaseSize(vec3(half + t / 2, 0, 0), vec3(t, h, GROUND_SIZE + t * 2)),
    aabbFromBaseSize(vec3(-half - t / 2, 0, 0), vec3(t, h, GROUND_SIZE + t * 2))
  ];
}
function generateCrates(rng) {
  const crates = [];
  const push = (x, y, z, size, rotation) => crates.push({
    id: `crate-${crates.length}`,
    position: vec3(x, y, z),
    size,
    rotation
  });
  const pb = vec3(5, 0, 5);
  push(pb.x - 1.1, 0.5, pb.z - 1.1, 1, 0);
  push(pb.x + 1.1, 0.5, pb.z - 1.1, 1, PI / 6);
  push(pb.x - 1.1, 0.5, pb.z + 1.1, 1, -PI / 8);
  push(pb.x + 1.1, 0.5, pb.z + 1.1, 1, PI / 3);
  push(pb.x, 1.5, pb.z - 0.5, 1, PI / 4);
  push(pb.x, 1.5, pb.z + 0.5, 1, -PI / 4);
  push(pb.x, 2.5, pb.z, 1, PI / 10);
  const wallStart = vec3(-8, 0, 6);
  const wallLength = 5;
  const wallSpacing = 1.2;
  for (let i = 0; i < wallLength; i++) {
    push(
      wallStart.x + i * wallSpacing,
      0.5,
      wallStart.z,
      1,
      i % 2 === 0 ? PI / 8 : -PI / 8
    );
  }
  for (let i = 1; i < wallLength - 1; i++) {
    push(
      wallStart.x + i * wallSpacing,
      1.5,
      wallStart.z,
      1,
      i % 2 === 0 ? -PI / 6 : PI / 6
    );
  }
  const circleCenter = vec3(5, 0, -12);
  const circleRadius = 5;
  const circleCount = 8;
  for (let i = 0; i < circleCount; i++) {
    const angle = i / circleCount * PI;
    push(
      circleCenter.x + Math.cos(angle) * circleRadius,
      0.5,
      circleCenter.z + Math.sin(angle) * circleRadius,
      0.9 + rng.next() * 0.3,
      rng.next() * PI
    );
  }
  const tb = vec3(-15, 0, 10);
  const ts = 1.2;
  push(tb.x - ts / 2, 0.6, tb.z - ts / 2, ts, 0);
  push(tb.x + ts / 2, 0.6, tb.z - ts / 2, ts, 0);
  push(tb.x - ts / 2, 0.6, tb.z + ts / 2, ts, 0);
  push(tb.x + ts / 2, 0.6, tb.z + ts / 2, ts, 0);
  push(tb.x - ts / 4, ts + 0.6, tb.z, ts, PI / 4);
  push(tb.x + ts / 4, ts + 0.6, tb.z, ts, -PI / 4);
  push(tb.x, ts * 2 + 0.6, tb.z, ts * 1.2, PI / 5);
  const corners = [
    { position: vec3(18, 0, 18), size: { x: 3, z: 3 }, fillRate: 0.7 },
    { position: vec3(-18, 0, -18), size: { x: 4, z: 3 }, fillRate: 0.6 }
  ];
  for (const corner of corners) {
    for (let i = 0; i < corner.size.x; i++) {
      for (let j = 0; j < corner.size.z; j++) {
        if (rng.next() > 1 - corner.fillRate) {
          push(
            corner.position.x - i * 1.1 - rng.next() * 0.2,
            0.5,
            corner.position.z - j * 1.1 - rng.next() * 0.2,
            0.8 + rng.next() * 0.4,
            rng.next() * PI
          );
        }
      }
    }
  }
  return crates;
}
function generateCones(rng) {
  const cones = [];
  const lineStart = vec3(10, 0, 11);
  for (let i = 0; i < 7; i++) {
    cones.push({ position: vec3(lineStart.x + i * 0.8, 0, lineStart.z), rotation: 0 });
  }
  const curveCenter = vec3(-5, 0, -8);
  const curveCount = 9;
  for (let i = 0; i < curveCount; i++) {
    const angle = i / (curveCount - 1) * PI;
    cones.push({
      position: vec3(
        curveCenter.x + Math.cos(angle) * 4,
        0,
        curveCenter.z + Math.sin(angle) * 4
      ),
      rotation: rng.next() * 0.5 - 0.25
    });
  }
  const crash = vec3(8, 0, 9);
  for (let i = 0; i < 5; i++) {
    const angle = rng.next() * PI * 2;
    const distance = 2 + rng.next() * 3;
    cones.push({
      position: vec3(
        crash.x + Math.cos(angle) * distance,
        0,
        crash.z + Math.sin(angle) * distance
      ),
      rotation: rng.next() * PI * 2
    });
  }
  cones.push({ position: vec3(-16.5, 0, 8.5), rotation: 0 });
  cones.push({ position: vec3(-13.5, 0, 8.5), rotation: 0 });
  cones.push({ position: vec3(-15, 0, 8), rotation: 0 });
  cones.push({ position: vec3(-3, 0, -15), rotation: 0 });
  cones.push({ position: vec3(3, 0, -15), rotation: 0 });
  cones.push({ position: vec3(-2, 0, -17), rotation: 0 });
  cones.push({ position: vec3(2, 0, -17), rotation: 0 });
  return cones;
}
function generateTrees(rng, blockers) {
  const trees = [];
  const clusters = [{ position: vec3(-18, 0, -18), radius: 4, count: 5 }];
  for (const cluster of clusters) {
    for (let i = 0; i < cluster.count; i++) {
      const target = vec3(
        cluster.position.x + rng.next() * cluster.radius - cluster.radius / 2,
        0,
        cluster.position.z + rng.next() * cluster.radius - cluster.radius / 2
      );
      const clear = findClearPosition(rng, target, 1.2, blockers);
      if (clear) {
        trees.push({
          position: clear,
          rotation: rng.next() * PI * 2,
          scale: 0.8 + rng.next() * 0.4
        });
      }
    }
  }
  const individuals = [vec3(15, 0, -15), vec3(-12, 0, 10), vec3(18, 0, 5), vec3(5, 0, 18)];
  for (const target of individuals) {
    const clear = findClearPosition(rng, target, 1.2, blockers);
    if (clear) {
      trees.push({
        position: clear,
        rotation: rng.next() * PI * 2,
        scale: 0.9 + rng.next() * 0.3
      });
    }
  }
  return trees;
}
function generateBushes(rng, blockers) {
  const bushes = [];
  const clusters = [
    { position: vec3(-18, 0, -18), radius: 6, count: 8 },
    { position: vec3(12, 0, 12), radius: 2.5, count: 4 },
    { position: vec3(-10, 0, -10), radius: 2.5, count: 3 }
  ];
  for (const cluster of clusters) {
    for (let i = 0; i < cluster.count; i++) {
      const target = vec3(
        cluster.position.x + rng.next() * cluster.radius - cluster.radius / 2,
        0,
        cluster.position.z + rng.next() * cluster.radius - cluster.radius / 2
      );
      const clear = findClearPosition(rng, target, 0.8, blockers);
      if (clear) {
        bushes.push({ position: clear, rotation: rng.next() * PI * 2 });
      }
    }
  }
  const individuals = [
    vec3(10, 0, -8),
    vec3(-5, 0, 5),
    vec3(0, 0, 12),
    vec3(15, 0, 0),
    vec3(-15, 0, -5),
    vec3(5, 0, -15),
    vec3(-8, 0, -3),
    vec3(3, 0, 8)
  ];
  for (const target of individuals) {
    const clear = findClearPosition(rng, target, 0.8, blockers);
    if (clear) {
      bushes.push({ position: clear, rotation: rng.next() * PI * 2 });
    }
  }
  return bushes;
}
function findClearPosition(rng, target, radius, blockers) {
  const isClear = (p) => !blockers.some(
    (b) => p.x + radius > b.min.x && p.x - radius < b.max.x && p.z + radius > b.min.z && p.z - radius < b.max.z
  );
  if (isClear(target)) return target;
  for (let attempt = 0; attempt < 8; attempt++) {
    const angle = rng.next() * PI * 2;
    const dist = radius * 2 + rng.next() * 3;
    const candidate = vec3(
      target.x + Math.cos(angle) * dist,
      0,
      target.z + Math.sin(angle) * dist
    );
    if (isClear(candidate)) return candidate;
  }
  return null;
}
const crateBox = (crate) => aabbFromCenterSize(crate.position, vec3(crate.size, crate.size, crate.size));
const carBox = (car) => aabbFromRotatedBox(
  vec3(car.position.x, car.position.y + CAR_SIZE.y / 2, car.position.z),
  CAR_SIZE,
  car.rotation
);
const streetLightBox = (base) => aabbFromBaseSize(base, STREET_LIGHT_SIZE);
const shopBox = (map) => aabbFromBaseSize(map.shop.position, map.shop.size);

const PLAYER_SIZE = vec3(1, 2, 1);
const PLAYER_MAX_HP = 100;
const SPAWN_POINTS = [
  vec3(0, 1, 0),
  vec3(12, 1, -4),
  vec3(-12, 1, 0),
  vec3(0, 1, 15),
  vec3(-6, 1, -14),
  vec3(14, 1, 6),
  vec3(-14, 1, 16),
  vec3(8, 1, -18)
];
function pickSpawnPoint(occupied, points = SPAWN_POINTS) {
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

const playerHitbox = (position, yaw) => ({
  box: aabbFromCenterSize(position, PLAYER_SIZE),
  yaw
});
const playerCollider = (position, yaw, tag) => ({ ...playerHitbox(position, yaw), tag });

const PICKUP_REACH = 2;
const PICKUP_LIFETIME = 30;
const PICKUP_MAX_COUNT = 10;
const PICKUP_SPAWN_INTERVAL = [5, 15];
const PICKUP_HEIGHT = 0.5;
const PICKUP_FOOTPRINT = vec3(1, 1, 1);
const PICKUP_PLAYER_CLEARANCE = 10;
const CRATE_DROP_CHANCE = 0.5;
function isWithinPickupReach(playerPos, pickupPos) {
  const dx = playerPos.x - pickupPos.x;
  const dz = playerPos.z - pickupPos.z;
  return dx * dx + dz * dz <= PICKUP_REACH * PICKUP_REACH;
}
function rollPickupContents(rng, id, position) {
  if (rng.next() < 0.5) {
    return {
      id,
      kind: "health",
      position,
      amount: Math.floor(rng.range(10, 50))
    };
  }
  return {
    id,
    kind: "ammo",
    position,
    weaponId: WEAPON_IDS[rng.int(WEAPON_IDS.length)],
    amount: Math.floor(rng.range(20, 80))
  };
}
function rollCrateDrop(rng, id, position) {
  if (rng.next() < 0.5) {
    return { id, kind: "health", position, amount: 25 };
  }
  return {
    id,
    kind: "ammo",
    position,
    weaponId: WEAPON_IDS[rng.int(WEAPON_IDS.length)],
    amount: 30
  };
}
function findPickupSpawnPosition(rng, blockers, playerPositions, attempts = 30) {
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

const GRENADE = {
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
  restSpeed: 0.5
};
function spawnGrenade(id, ownerId, origin, direction) {
  const dir = normalize(direction);
  return {
    id,
    ownerId,
    position: { ...origin },
    velocity: add(scale(dir, GRENADE.throwSpeed), vec3(0, GRENADE.throwLift, 0)),
    fuse: GRENADE.fuse
  };
}
function integrateGrenade(g, dt, colliders) {
  g.fuse -= dt;
  g.velocity = add(g.velocity, vec3(0, -20 * dt, 0));
  const from = g.position;
  const to = add(from, scale(g.velocity, dt));
  let bestT = Infinity;
  let bounce = null;
  if (to.y < GRENADE.radius && from.y >= GRENADE.radius) {
    const t = (from.y - GRENADE.radius) / (from.y - to.y);
    bestT = t;
    bounce = { point: lerp(from, to, t), normal: vec3(0, 1, 0), collider: null };
  } else if (to.y < GRENADE.radius) {
    bestT = 0;
    bounce = {
      point: vec3(from.x, GRENADE.radius, from.z),
      normal: vec3(0, 1, 0),
      collider: null
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
  const n = bounce.normal;
  const vn = g.velocity.x * n.x + g.velocity.y * n.y + g.velocity.z * n.z;
  const normalPart = scale(n, vn);
  const tangent = add(g.velocity, scale(normalPart, -1));
  g.velocity = add(
    scale(normalPart, -0.45),
    scale(tangent, GRENADE.friction)
  );
  if (length(g.velocity) < GRENADE.restSpeed) {
    g.velocity = vec3(0, 0, 0);
  }
  g.position = add(bounce.point, scale(n, 1e-3));
  return bounce;
}
function blastDamage(center, target) {
  const d = distance(center, target);
  if (d >= GRENADE.blastRadius) return 0;
  return Math.round(GRENADE.maxDamage * (1 - d / GRENADE.blastRadius));
}
function inflate(box, r) {
  return {
    min: vec3(box.min.x - r, box.min.y - r, box.min.z - r),
    max: vec3(box.max.x + r, box.max.y + r, box.max.z + r)
  };
}
function faceNormal(box, point, velocity) {
  const axes = ["x", "y", "z"];
  let best = vec3(0, 1, 0);
  let bestDist = Infinity;
  for (const axis of axes) {
    const dMin = Math.abs(point[axis] - box.min[axis]);
    const dMax = Math.abs(point[axis] - box.max[axis]);
    const candidates = [
      [dMin, -1],
      [dMax, 1]
    ];
    for (const [dist, sign] of candidates) {
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

var __defProp$1 = Object.defineProperty;
var __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$1 = (obj, key, value) => __defNormalProp$1(obj, typeof key !== "symbol" ? key + "" : key, value);
const KILL_SCORE = 100;
const CAR_CONTACT_DPS = 20;
const FIRE_RATE_TOLERANCE = 0.85;
class GameRoom {
  constructor(transport, options = {}) {
    __publicField$1(this, "transport", transport);
    /** Last known state of every player who has joined, keyed by player id. */
    __publicField$1(this, "players", /* @__PURE__ */ new Map());
    __publicField$1(this, "leaderBoard", {});
    __publicField$1(this, "map");
    /** Bullets in flight. */
    __publicField$1(this, "projectiles", []);
    /** Grenades in flight or resting, keyed by grenade id. */
    __publicField$1(this, "grenades", /* @__PURE__ */ new Map());
    /** Surviving crates keyed by crate id. */
    __publicField$1(this, "crates", /* @__PURE__ */ new Map());
    /** Pickups lying in the world keyed by pickup id. */
    __publicField$1(this, "pickups", /* @__PURE__ */ new Map());
    __publicField$1(this, "clock");
    __publicField$1(this, "rng");
    __publicField$1(this, "staticColliders");
    __publicField$1(this, "tickCount", 0);
    __publicField$1(this, "nextProjectileId", 1);
    __publicField$1(this, "nextPickupId", 1);
    __publicField$1(this, "nextGrenadeId", 1);
    /** Seconds until the next random pickup spawn. */
    __publicField$1(this, "pickupSpawnIn");
    this.clock = options.clock ?? Date.now;
    this.rng = new Rng(options.seed ?? Date.now() & 4294967295);
    this.map = options.map ?? generateMap();
    this.staticColliders = buildStaticColliders(this.map);
    for (const spec of this.map.crates) {
      this.crates.set(spec.id, { spec, hp: CRATE_MAX_HP });
    }
    this.pickupSpawnIn = this.rollPickupSpawnDelay();
  }
  /** A transport-level connection was established; the player has not joined yet. */
  connect(playerId) {
    this.transport.broadcast(
      GAME_EVENTS.USER.CONNECTED,
      { id: playerId, userId: playerId, message: "Welcome to the server" },
      playerId
    );
  }
  /** The connection dropped; remove the player if they had joined. */
  leave(playerId) {
    const wasPlaying = this.players.delete(playerId);
    delete this.leaderBoard[playerId];
    if (!wasPlaying) return;
    this.transport.broadcast(
      GAME_EVENTS.USER.DISCONNECTED,
      { id: playerId, userId: playerId, message: "A player left" },
      playerId
    );
  }
  /** Route a client -> server event to its handler. */
  applyIntent(playerId, event, payload) {
    switch (event) {
      case GAME_EVENTS.USER.JOINED:
        this.handleJoin(playerId, payload);
        break;
      case GAME_EVENTS.PLAYER.POSITION:
        this.handlePosition(playerId, payload);
        break;
      case GAME_EVENTS.PLAYER.RESPAWN:
        this.handleRespawn(playerId, payload);
        break;
      case GAME_EVENTS.WEAPON.SHOOT:
        this.handleShoot(playerId, payload);
        break;
      case GAME_EVENTS.WEAPON.SWITCH:
        this.handleWeaponSwitch(playerId, payload);
        break;
      case GAME_EVENTS.PICKUP.CLAIM:
        this.handlePickupClaim(playerId, payload);
        break;
      case GAME_EVENTS.GRENADE.THROW:
        this.handleGrenadeThrow(playerId, payload);
        break;
      default: {
        const unhandled = event;
        throw new Error(`Unhandled intent: ${String(unhandled)}`);
      }
    }
  }
  /**
   * Advance the simulation by `dt` seconds and broadcast the resulting
   * world snapshot. `now` is the server clock in ms.
   */
  tick(dt, now = this.clock()) {
    this.tickCount += 1;
    this.stepProjectiles(dt);
    this.stepGrenades(dt);
    this.stepCarContact(dt);
    this.stepPickups(dt, now);
    this.transport.broadcast(GAME_EVENTS.WORLD.SNAPSHOT, {
      tick: this.tickCount,
      serverTime: now,
      players: this.snapshotPlayers(),
      grenades: this.snapshotGrenades()
    });
  }
  // ---- intents -----------------------------------------------------------
  handleJoin(playerId, payload) {
    const name = payload.name || `Player-${playerId.substring(0, 5)}`;
    this.transport.send(playerId, GAME_EVENTS.GAME.STATE, {
      selfId: playerId,
      players: this.snapshotPlayers(),
      crates: this.snapshotCrates(),
      pickups: [...this.pickups.values()].map((p) => p.spec)
    });
    this.players.set(playerId, {
      id: playerId,
      userId: playerId,
      name,
      status: "alive",
      hp: PLAYER_MAX_HP,
      position: payload.position,
      rotation: 0,
      lastShotAt: -Infinity,
      lastThrowAt: -Infinity,
      pendingHazardDamage: 0
    });
    this.leaderBoard[playerId] = {
      id: playerId,
      userId: playerId,
      name,
      kills: 0,
      deaths: 0,
      score: 0
    };
    this.transport.broadcast(
      GAME_EVENTS.USER.JOINED,
      { id: playerId, userId: playerId, ...payload, name },
      playerId
    );
  }
  handlePosition(playerId, payload) {
    const player = this.players.get(playerId);
    if (!player || player.status === "dead") return;
    player.position = payload.position;
    player.rotation = payload.rotation;
  }
  handleRespawn(playerId, _payload) {
    const player = this.players.get(playerId);
    if (!player || player.status !== "dead") return;
    const others = [];
    for (const other of this.players.values()) {
      if (other.id !== playerId && other.position) others.push(other.position);
    }
    const position = pickSpawnPoint(others);
    player.status = "alive";
    player.hp = PLAYER_MAX_HP;
    player.position = { ...position };
    player.rotation = 0;
    this.transport.broadcast(GAME_EVENTS.PLAYER.RESPAWN, {
      playerId,
      position,
      hp: player.hp
    });
  }
  handleShoot(playerId, payload) {
    const player = this.players.get(playerId);
    if (!player || player.status !== "alive") return;
    if (!isWeaponId(payload.weaponType)) return;
    const origin = payload.data?.position;
    const direction = payload.data?.direction;
    if (!origin || !direction) return;
    const weapon = WEAPONS[payload.weaponType];
    const now = this.clock();
    const minInterval = weapon.fireRate * 1e3 * FIRE_RATE_TOLERANCE;
    if (now - player.lastShotAt < minInterval) return;
    player.lastShotAt = now;
    this.projectiles.push(
      ...spawnPellets(
        () => this.nextProjectileId++,
        playerId,
        weapon,
        origin,
        direction
      )
    );
    this.transport.broadcast(
      GAME_EVENTS.WEAPON.SHOOT,
      { id: playerId, userId: playerId, ...payload },
      playerId
    );
  }
  handleWeaponSwitch(playerId, payload) {
    if (!this.players.has(playerId)) return;
    this.transport.broadcast(
      GAME_EVENTS.WEAPON.SWITCH,
      { id: playerId, userId: playerId, ...payload },
      playerId
    );
  }
  handlePickupClaim(playerId, payload) {
    const player = this.players.get(playerId);
    if (!player || player.status !== "alive" || !player.position) return;
    const pickup = this.pickups.get(payload.pickupId);
    if (!pickup) return;
    if (!isWithinPickupReach(player.position, pickup.spec.position)) return;
    this.pickups.delete(pickup.spec.id);
    switch (pickup.spec.kind) {
      case "health":
        player.hp = Math.min(PLAYER_MAX_HP, player.hp + pickup.spec.amount);
        break;
      case "ammo":
        break;
      default: {
        const unhandled = pickup.spec;
        throw new Error(`Unhandled pickup kind: ${String(unhandled)}`);
      }
    }
    this.transport.broadcast(GAME_EVENTS.PICKUP.TAKEN, {
      pickup: pickup.spec,
      playerId,
      hp: player.hp
    });
  }
  handleGrenadeThrow(playerId, payload) {
    const player = this.players.get(playerId);
    if (!player || player.status !== "alive") return;
    if (!payload.position || !payload.direction) return;
    const now = this.clock();
    if (now - player.lastThrowAt < GRENADE.throwCooldown * 1e3) return;
    player.lastThrowAt = now;
    const id = `grenade-${this.nextGrenadeId++}`;
    this.grenades.set(
      id,
      spawnGrenade(id, playerId, payload.position, payload.direction)
    );
    this.transport.broadcast(
      GAME_EVENTS.GRENADE.THROW,
      { id: playerId, userId: playerId, ...payload },
      playerId
    );
  }
  // ---- simulation --------------------------------------------------------
  stepGrenades(dt) {
    if (this.grenades.size === 0) return;
    const colliders = [...this.staticColliders, ...this.crateColliders()];
    for (const grenade of this.grenades.values()) {
      integrateGrenade(grenade, dt, colliders);
      if (grenade.fuse <= 0) this.explodeGrenade(grenade);
    }
  }
  explodeGrenade(grenade) {
    this.grenades.delete(grenade.id);
    const center = grenade.position;
    const hits = [];
    for (const player of this.players.values()) {
      if (player.status !== "alive" || !player.position) continue;
      const damage = blastDamage(center, player.position);
      if (damage <= 0) continue;
      hits.push({ targetId: player.id, damage });
    }
    for (const crate of this.crates.values()) {
      const damage = blastDamage(center, aabbCenter(crateBox(crate.spec)));
      if (damage <= 0) continue;
      hits.push({ targetId: crate.spec.id, damage });
    }
    this.transport.broadcast(GAME_EVENTS.GRENADE.EXPLODED, {
      grenadeId: grenade.id,
      ownerId: grenade.ownerId,
      position: center,
      hits
    });
    for (const { targetId, damage } of hits) {
      if (this.players.has(targetId)) {
        this.applyDamage(grenade.ownerId, targetId, damage, "grenade", center);
      } else {
        this.damageCrate(targetId, damage);
      }
    }
  }
  stepProjectiles(dt) {
    if (this.projectiles.length === 0) return;
    const colliders = [
      ...this.staticColliders,
      ...this.crateColliders(),
      ...this.playerColliders()
    ];
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      const { hit, expired } = integrateProjectile(
        projectile,
        dt,
        colliders,
        (c) => c.tag.kind === "player" && c.tag.id === projectile.ownerId
      );
      if (hit) {
        switch (hit.collider.tag.kind) {
          case "player":
            this.applyDamage(
              projectile.ownerId,
              hit.collider.tag.id,
              projectile.damage,
              projectile.weaponId,
              hit.point
            );
            break;
          case "crate":
            this.damageCrate(hit.collider.tag.id, projectile.damage);
            break;
          case "static":
            break;
          default: {
            const unhandled = hit.collider.tag;
            throw new Error(`Unhandled collider tag: ${String(unhandled)}`);
          }
        }
      }
      if (expired) this.projectiles.splice(i, 1);
    }
  }
  /** Apply damage to a crate; destroy it and maybe drop a pickup at zero HP. */
  damageCrate(crateId, damage) {
    const crate = this.crates.get(crateId);
    if (!crate) return;
    crate.hp = Math.max(0, crate.hp - damage);
    this.transport.broadcast(GAME_EVENTS.CRATE.DAMAGED, {
      crateId,
      damage,
      hp: crate.hp,
      maxHp: CRATE_MAX_HP
    });
    if (crate.hp > 0) return;
    this.crates.delete(crateId);
    const position = crate.spec.position;
    this.transport.broadcast(GAME_EVENTS.CRATE.DESTROYED, { crateId, position });
    if (this.rng.next() < CRATE_DROP_CHANCE) {
      this.spawnPickup(
        rollCrateDrop(this.rng, this.allocatePickupId(), {
          x: position.x,
          y: 0.5,
          z: position.z
        })
      );
    }
  }
  /** Expire old pickups and spawn new ones on the random cadence. */
  stepPickups(dt, now) {
    for (const pickup of this.pickups.values()) {
      if (now < pickup.expiresAt) continue;
      this.pickups.delete(pickup.spec.id);
      this.transport.broadcast(GAME_EVENTS.PICKUP.EXPIRED, {
        pickupId: pickup.spec.id
      });
    }
    this.pickupSpawnIn -= dt;
    if (this.pickupSpawnIn > 0) return;
    this.pickupSpawnIn = this.rollPickupSpawnDelay();
    if (this.pickups.size >= PICKUP_MAX_COUNT) return;
    const blockers = [
      ...this.staticColliders.map((c) => c.box),
      ...this.crateColliders().map((c) => c.box)
    ];
    const playerPositions = [];
    for (const player of this.players.values()) {
      if (player.position) playerPositions.push(player.position);
    }
    const position = findPickupSpawnPosition(this.rng, blockers, playerPositions);
    if (!position) return;
    this.spawnPickup(rollPickupContents(this.rng, this.allocatePickupId(), position));
  }
  spawnPickup(spec) {
    this.pickups.set(spec.id, {
      spec,
      expiresAt: this.clock() + PICKUP_LIFETIME * 1e3
    });
    this.transport.broadcast(GAME_EVENTS.PICKUP.SPAWNED, spec);
  }
  allocatePickupId() {
    return `pickup-${this.nextPickupId++}`;
  }
  rollPickupSpawnDelay() {
    const [min, max] = PICKUP_SPAWN_INTERVAL;
    return this.rng.range(min, max);
  }
  /**
   * Players standing inside a car take continuous contact damage. Damage is
   * accumulated per player and applied in whole points so the event stream
   * stays sparse.
   */
  stepCarContact(dt) {
    for (const player of this.players.values()) {
      if (player.status !== "alive" || !player.position) continue;
      const box = aabbFromCenterSize(player.position, PLAYER_SIZE);
      const car = this.map.cars.find((c) => aabbIntersects(box, carBox(c)));
      if (!car) {
        player.pendingHazardDamage = 0;
        continue;
      }
      player.pendingHazardDamage += CAR_CONTACT_DPS * dt;
      const whole = Math.floor(player.pendingHazardDamage);
      if (whole <= 0) continue;
      player.pendingHazardDamage -= whole;
      this.applyDamage(car.id, player.id, whole, "car", player.position);
    }
  }
  applyDamage(shooterId, targetId, damage, source, position) {
    const target = this.players.get(targetId);
    if (!target || target.status !== "alive") return;
    target.hp = Math.max(0, target.hp - damage);
    this.transport.broadcast(GAME_EVENTS.COMBAT.HIT, {
      shooterId,
      targetId,
      damage,
      hp: target.hp,
      source,
      position
    });
    if (target.hp > 0) return;
    target.status = "dead";
    const killer = this.leaderBoard[shooterId];
    if (killer && shooterId !== targetId) {
      killer.kills += 1;
      killer.score += KILL_SCORE;
    }
    const victim = this.leaderBoard[targetId];
    if (victim) victim.deaths += 1;
    this.transport.broadcast(GAME_EVENTS.COMBAT.KILL, {
      killerId: shooterId,
      victimId: targetId,
      source
    });
  }
  crateColliders() {
    return [...this.crates.values()].map(({ spec }) => ({
      box: crateBox(spec),
      tag: { kind: "crate", id: spec.id }
    }));
  }
  snapshotGrenades() {
    return [...this.grenades.values()].map(({ id, ownerId, position }) => ({
      id,
      ownerId,
      position
    }));
  }
  snapshotCrates() {
    return [...this.crates.values()].map(({ spec, hp }) => ({
      id: spec.id,
      hp
    }));
  }
  playerColliders() {
    const colliders = [];
    for (const player of this.players.values()) {
      if (player.status !== "alive" || !player.position) continue;
      colliders.push(
        playerCollider(player.position, player.rotation, {
          kind: "player",
          id: player.id
        })
      );
    }
    return colliders;
  }
  snapshotPlayers() {
    return [...this.players.values()].map(
      ({ id, userId, name, status, hp, position, rotation }) => ({
        id,
        userId,
        name,
        status,
        hp,
        position,
        rotation
      })
    );
  }
}
function buildStaticColliders(map) {
  const colliders = [];
  map.walls.forEach(
    (box, i) => colliders.push({ box, tag: { kind: "static", id: `wall-${i}` } })
  );
  colliders.push({ box: shopBox(map), tag: { kind: "static", id: "shop" } });
  for (const car of map.cars) {
    colliders.push({ box: carBox(car), tag: { kind: "static", id: car.id } });
  }
  map.streetLights.forEach(
    (base, i) => colliders.push({
      box: streetLightBox(base),
      tag: { kind: "static", id: `light-${i}` }
    })
  );
  return colliders;
}

function startTickLoop(room, hz) {
  const stepMs = 1e3 / hz;
  const dt = 1 / hz;
  const maxCatchUpSteps = 5;
  let last = Date.now();
  let accumulator = 0;
  const handle = setInterval(() => {
    const now = Date.now();
    accumulator += now - last;
    last = now;
    let steps = 0;
    while (accumulator >= stepMs && steps < maxCatchUpSteps) {
      room.tick(dt, now);
      accumulator -= stepMs;
      steps += 1;
    }
    if (steps === maxCatchUpSteps) accumulator = 0;
  }, stepMs);
  return () => clearInterval(handle);
}

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, key + "" , value);
class SocketIOTransport {
  constructor(io) {
    __publicField(this, "io", io);
  }
  send(playerId, event, payload) {
    const args = [payload];
    this.io.to(playerId).emit(event, ...args);
  }
  broadcast(event, payload, exceptPlayerId) {
    const args = [payload];
    const target = exceptPlayerId ? this.io.except(exceptPlayerId) : this.io;
    target.emit(event, ...args);
  }
}
function attachSocketIO(io, room) {
  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);
    room.connect(socket.id);
    socket.on(
      GAME_EVENTS.USER.JOINED,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.USER.JOINED, p)
    );
    socket.on(
      GAME_EVENTS.PLAYER.POSITION,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.PLAYER.POSITION, p)
    );
    socket.on(
      GAME_EVENTS.PLAYER.RESPAWN,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.PLAYER.RESPAWN, p)
    );
    socket.on(
      GAME_EVENTS.WEAPON.SHOOT,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.WEAPON.SHOOT, p)
    );
    socket.on(
      GAME_EVENTS.WEAPON.SWITCH,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.WEAPON.SWITCH, p)
    );
    socket.on(
      GAME_EVENTS.PICKUP.CLAIM,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.PICKUP.CLAIM, p)
    );
    socket.on(
      GAME_EVENTS.GRENADE.THROW,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.GRENADE.THROW, p)
    );
    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      room.leave(socket.id);
    });
  });
}

const app = express();
const server = http.createServer(app);
const allowedOrigins = [
  "https://bang-bang.dapps.be",
  "https://bang-bang-teal.vercel.app/",
  "http://localhost:5173"
];
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  })
);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});
const PORT = process.env.PORT || 3e3;
const room = new GameRoom(new SocketIOTransport(io));
attachSocketIO(io, room);
startTickLoop(room, TICK_RATE);
server.listen(PORT, () => {
  console.log(`\u2705 Server listening on port ${PORT}`);
});
app.get("/", (_req, res) => {
  res.send("<h1>Hello world</h1>");
});
app.get("/leaderboard", (_req, res) => {
  res.send(room.leaderBoard);
});
