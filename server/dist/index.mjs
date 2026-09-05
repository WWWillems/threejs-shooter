import express from 'express';
import * as http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const MAX_NICKNAME_LENGTH = 24;
const UNSAFE_NICKNAME_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF<>]/gu;
function sanitizeNickname(value) {
  if (typeof value !== "string") return "Player";
  const nickname = value.slice(0, MAX_NICKNAME_LENGTH * 4).normalize("NFKC").replace(UNSAFE_NICKNAME_CHARACTERS, "").replace(/\s+/gu, " ").trim();
  if (nickname.length === 0) return "Player";
  return Array.from(nickname).slice(0, MAX_NICKNAME_LENGTH).join("");
}

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

var __defProp$3 = Object.defineProperty;
var __defNormalProp$3 = (obj, key, value) => key in obj ? __defProp$3(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$3 = (obj, key, value) => __defNormalProp$3(obj, key + "" , value);
class Rng {
  constructor(seed) {
    __publicField$3(this, "state");
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

const PROP_TYPES = ["trash-bag", "oil-barrel", "forklift", "fence", "fence-gate"];
const PARTS = {
  "trash-bag": [{ center: { x: 0, y: 0.47, z: 0 }, size: { x: 0.78, y: 0.94, z: 0.64 } }],
  "oil-barrel": [{ center: { x: 0, y: 0.46, z: 0 }, size: { x: 0.66, y: 0.92, z: 0.66 } }],
  fence: [{ center: { x: 0, y: 1.34, z: 0 }, size: { x: 4.18, y: 2.68, z: 0.18 } }],
  "fence-gate": [{ center: { x: 0, y: 1.34, z: 0 }, size: { x: 4.18, y: 2.68, z: 0.24 } }],
  forklift: [
    { center: { x: 0, y: 1.25, z: 0.04 }, size: { x: 1.76, y: 2.5, z: 2.55 } },
    { center: { x: 0, y: 0.15, z: -1.98 }, size: { x: 1.06, y: 0.3, z: 1.46 } }
  ]
};
const isMovementOnlyProp = (type) => type === "trash-bag" || type === "fence" || type === "fence-gate";
function propBoxes(prop) {
  const c = Math.cos(prop.rotation), s = Math.sin(prop.rotation), k = prop.scale;
  return PARTS[prop.type].map(({ center, size }) => aabbFromRotatedBox({
    x: prop.position.x + k * (center.x * c + center.z * s),
    y: prop.position.y + k * center.y,
    z: prop.position.z + k * (-center.x * s + center.z * c)
  }, { x: size.x * k, y: size.y * k, z: size.z * k }, prop.rotation));
}

const PLAYER_SIZE = vec3(1, 2, 1);
const PLAYER_MAX_HP = 100;
const SPAWN_POINTS = [
  vec3(-16, 1, -33),
  vec3(-11, 1, -34),
  vec3(0, 1, -34),
  vec3(11, 1, -34),
  vec3(16, 1, -33),
  vec3(16, 1, 33),
  vec3(11, 1, 34),
  vec3(0, 1, 34),
  vec3(-11, 1, 34),
  vec3(-16, 1, 33)
];
const facingCenterYaw = (position) => Math.atan2(position.x, position.z);
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

var __defProp$2 = Object.defineProperty;
var __defNormalProp$2 = (obj, key, value) => key in obj ? __defProp$2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$2 = (obj, key, value) => __defNormalProp$2(obj, typeof key !== "symbol" ? key + "" : key, value);
const MAP_SEED = 20240913;
const GROUND_SIZE = 76;
const WALL_HEIGHT = 2.5;
const WALL_THICKNESS = 0.5;
const CAR_SIZE = vec3(2.4, 1.8, 5);
const STREET_LIGHT_SIZE = vec3(0.4, 6.3, 0.4);
const SHOP_SIZE = vec3(10, 4, 8);
const WAREHOUSE_SIZE = vec3(14, 5.5, 10);
const TENEMENT_SIZE = vec3(7, 7.5, 8);
const CRATE_MAX_HP = 100;
const TREE_TRUNK_SIZE = vec3(0.6, 1.5, 0.6);
const BUSH_SIZE = vec3(1.4, 1, 1.4);
const CONE_SIZE = vec3(0.5, 0.8, 0.5);
const PI = Math.PI;
function generateMap(seed = MAP_SEED) {
  const arena = new ArenaBuilder(new Rng(seed));
  layoutSpawnStreet(arena);
  layoutCoverLine(arena);
  layoutYard(arena);
  layoutMid(arena);
  layoutFlanks(arena);
  return {
    seed,
    walls: generateWalls(),
    shop: { id: "shop", position: vec3(0, 0, 0), size: SHOP_SIZE },
    buildings: arena.buildings,
    cars: arena.cars,
    streetLights: arena.streetLights,
    crates: arena.crates,
    cones: arena.cones,
    trees: arena.trees,
    bushes: arena.bushes,
    props: arena.props,
    spawnPoints: SPAWN_POINTS.map((point) => ({ ...point }))
  };
}
const mirrored = (p) => vec3(-p.x || 0, p.y, -p.z || 0);
class ArenaBuilder {
  constructor(rng) {
    __publicField$2(this, "rng", rng);
    __publicField$2(this, "buildings", []);
    __publicField$2(this, "cars", []);
    __publicField$2(this, "streetLights", []);
    __publicField$2(this, "crates", []);
    __publicField$2(this, "cones", []);
    __publicField$2(this, "trees", []);
    __publicField$2(this, "bushes", []);
    __publicField$2(this, "props", []);
  }
  building(type, id, x, z, rotation = 0) {
    this.both(
      vec3(x, 0, z),
      (position, turn, side) => this.buildings.push({
        id: `${id}-${side}`,
        type,
        position,
        rotation: rotation + turn,
        scale: 1
      })
    );
  }
  /** Run `place` for the south-side position and again for its north-side mirror. */
  both(position, place) {
    place(position, 0, "s");
    place(mirrored(position), PI, "n");
  }
  car(x, z, rotation, tiltZ = 0) {
    this.both(
      vec3(x, 0, z),
      (position, turn) => this.cars.push({
        id: `car-${this.cars.length}`,
        position,
        rotation: rotation + turn,
        scale: 1,
        tiltZ
      })
    );
  }
  light(x, z) {
    this.both(
      vec3(x, 0, z),
      (position, turn) => this.streetLights.push({
        id: `light-${this.streetLights.length}`,
        position,
        rotation: turn,
        scale: 1
      })
    );
  }
  /** A crate of `size` resting on `level` crates of the same size. */
  crate(x, z, size, rotation, level = 0) {
    this.both(
      vec3(x, size * (level + 0.5), z),
      (position, turn) => this.crates.push({
        id: `crate-${this.crates.length}`,
        position,
        size,
        rotation: rotation + turn
      })
    );
  }
  /** Four crates in a square with one on top: hard cover you cannot see over. */
  bunker(x, z) {
    const d = 0.55;
    this.crate(x - d, z - d, 1, 0);
    this.crate(x + d, z - d, 1, PI / 9);
    this.crate(x - d, z + d, 1, -PI / 12);
    this.crate(x + d, z + d, 1, PI / 16);
    this.crate(x, z, 1, PI / 7, 1);
  }
  /** Seven crates in three tiers: a lane landmark and the tallest cover on the map. */
  pyramid(x, z, size = 1) {
    const d = size * 1.1;
    this.crate(x - d, z - d, size, 0);
    this.crate(x + d, z - d, size, PI / 6);
    this.crate(x - d, z + d, size, -PI / 8);
    this.crate(x + d, z + d, size, PI / 3);
    this.crate(x, z - size / 2, size, PI / 4, 1);
    this.crate(x, z + size / 2, size, -PI / 4, 1);
    this.crate(x, z, size, PI / 10, 2);
  }
  /** `count` crates in a row along X with a staggered second row on top. */
  crateWall(x, z, count) {
    const spacing = 1.25;
    const start = x - (count - 1) * spacing / 2;
    for (let i = 0; i < count; i++) {
      this.crate(start + i * spacing, z, 1, i % 2 === 0 ? PI / 12 : -PI / 12);
    }
    for (let i = 0; i < count - 1; i++) {
      this.crate(start + (i + 0.5) * spacing, z, 1, i % 2 === 0 ? -PI / 14 : PI / 14, 1);
    }
  }
  /** Oversized crates stacked three high: the flank landmark. */
  tower(x, z) {
    const s = 1.2;
    const d = s / 2;
    this.crate(x - d, z - d, s, 0);
    this.crate(x + d, z - d, s, 0);
    this.crate(x - d, z + d, s, 0);
    this.crate(x + d, z + d, s, 0);
    this.crate(x - d, z, s, PI / 12, 1);
    this.crate(x + d, z, s, -PI / 12, 1);
    this.crate(x, z, s, PI / 5, 2);
  }
  cone(x, z) {
    const rotation = this.rng.next() * PI * 2;
    this.both(
      vec3(x, 0, z),
      (position, turn) => this.cones.push({
        id: `cone-${this.cones.length}`,
        position,
        scale: 1,
        rotation: rotation + turn
      })
    );
  }
  tree(x, z, scale2) {
    const rotation = this.rng.next() * PI * 2;
    this.both(
      vec3(x, 0, z),
      (position, turn) => this.trees.push({
        id: `tree-${this.trees.length}`,
        position,
        rotation: rotation + turn,
        scale: scale2
      })
    );
  }
  bush(x, z) {
    const rotation = this.rng.next() * PI * 2;
    this.both(
      vec3(x, 0, z),
      (position, turn) => this.bushes.push({
        id: `bush-${this.bushes.length}`,
        position,
        rotation: rotation + turn,
        scale: 1
      })
    );
  }
  prop(type, id, x, z, rotation = 0) {
    this.both(
      vec3(x, 0, z),
      (position, turn, side) => this.props.push({
        id: `${id}-${side}`,
        type,
        position,
        rotation: rotation + turn,
        scale: 1
      })
    );
  }
}
function layoutSpawnStreet(arena) {
  arena.light(-22, -35);
  arena.light(17, -30);
  arena.prop("trash-bag", "bag-street-0", -4, -37.2, 0.5);
  arena.prop("trash-bag", "bag-street-1", -3, -37.2, -1.1);
  arena.prop("trash-bag", "bag-street-2", 10.6, -37.2, 2.2);
  arena.tree(-31.5, -36.2, 0.9);
  arena.bush(-33.2, -35.6);
  arena.bush(-29.8, -36.5);
}
function layoutCoverLine(arena) {
  arena.car(0, -26, PI / 2);
  arena.bunker(-11, -27);
  arena.bunker(11, -27);
  arena.crateWall(-15.3, -27, 2);
  arena.crateWall(15.3, -27, 2);
}
function layoutYard(arena) {
  for (const side of ["west", "east"]) {
    const x = side === "west" ? -19 : 19;
    arena.prop("fence", `fence-${side}-0`, x, -20, PI / 2);
    arena.prop("fence", `fence-${side}-1`, x, -16, PI / 2);
    arena.prop("fence-gate", `gate-${side}`, x, -12, PI / 2);
  }
  arena.crateWall(-7, -17, 3);
  arena.crateWall(-13.5, -21, 2);
  arena.prop("forklift", "forklift-yard", 7, -20, PI / 2 + 0.3);
  arena.prop("oil-barrel", "barrel-yard-0", 4.2, -14.2, 0.2);
  arena.prop("oil-barrel", "barrel-yard-1", 5.15, -13.7, -0.4);
  arena.prop("oil-barrel", "barrel-yard-2", 14, -16, 0.7);
  arena.prop("oil-barrel", "barrel-yard-3", 14.95, -15.6, -0.1);
  arena.prop("trash-bag", "bag-yard", 12.4, -20.7, 0.9);
  arena.cone(5.2, -22.6);
  arena.cone(9.4, -21.9);
  arena.cone(8.8, -17.6);
  arena.bush(17.6, -18.1);
  arena.light(-14, -12);
}
function layoutMid(arena) {
  arena.pyramid(-11, -7);
  arena.crate(8, -8, 1.2, 0.3);
  arena.crate(9.2, -7.2, 1, -0.2);
  arena.prop("oil-barrel", "barrel-mid", 7, -6.9, 0.6);
  arena.crateWall(-2.5, -5.3, 2);
  arena.prop("oil-barrel", "barrel-dock-0", 1.4, -5, 0.3);
  arena.prop("oil-barrel", "barrel-dock-1", 2.35, -5.15, -0.7);
  arena.prop("trash-bag", "bag-dock-0", 3.4, -4.9, 0.5);
  arena.prop("trash-bag", "bag-dock-1", 4.4, -5.9, -1.3);
  arena.bush(-6, -5.3);
  arena.prop("forklift", "forklift-gate", -19, 0, PI / 2);
  arena.prop("oil-barrel", "barrel-gate-0", -19.3, -6.4, 0.1);
  arena.prop("oil-barrel", "barrel-gate-1", -18.5, -5.4, 0.8);
  arena.cone(-17.6, -9.3);
  arena.cone(-16.9, -10);
}
function layoutFlanks(arena) {
  arena.building("warehouse", "warehouse-flank", -25, -20);
  arena.building("tenement", "tenement-flank", 30, 8);
  arena.tree(-35.5, -30, 1.1);
  arena.tree(-35.5, -12, 0.9);
  arena.tree(-35.5, 6, 1);
  arena.bush(-34.3, -31.3);
  arena.bush(-36.6, -28.2);
  arena.bush(-34.6, -10.7);
  arena.bush(-36.3, 7.6);
  arena.tower(26, -9);
  arena.prop("oil-barrel", "barrel-tower-0", 28.6, -11.4, 0.4);
  arena.prop("oil-barrel", "barrel-tower-1", 29.5, -10.9, -0.2);
  arena.crateWall(22.5, -25.5, 2);
  arena.tree(35.5, -24, 1.2);
  arena.bush(34.1, -25.6);
  arena.bush(36.5, -22.2);
  arena.bush(34.8, -2.4);
  for (let i = 0; i < 4; i++) arena.cone(29 + i * 0.8, -31 + i * 0.8);
}
function generateWalls() {
  const half = GROUND_SIZE / 2;
  const t = WALL_THICKNESS;
  const h = WALL_HEIGHT;
  return [
    // North (+Z) and South (-Z)
    {
      id: "wall-north",
      box: aabbFromBaseSize(
        vec3(0, 0, half + t / 2),
        vec3(GROUND_SIZE + t, h, t)
      )
    },
    {
      id: "wall-south",
      box: aabbFromBaseSize(
        vec3(0, 0, -half - t / 2),
        vec3(GROUND_SIZE + t, h, t)
      )
    },
    // East (+X) and West (-X)
    {
      id: "wall-east",
      box: aabbFromBaseSize(
        vec3(half + t / 2, 0, 0),
        vec3(t, h, GROUND_SIZE + t * 2)
      )
    },
    {
      id: "wall-west",
      box: aabbFromBaseSize(
        vec3(-half - t / 2, 0, 0),
        vec3(t, h, GROUND_SIZE + t * 2)
      )
    }
  ];
}
const crateBox = (crate) => aabbFromCenterSize(crate.position, vec3(crate.size, crate.size, crate.size));
const carBox = (car) => aabbFromRotatedBox(
  vec3(car.position.x, car.position.y + CAR_SIZE.y / 2, car.position.z),
  scale(CAR_SIZE, car.scale),
  car.rotation
);
const streetLightBox = (base, multiplier = 1) => aabbFromBaseSize(base, scale(STREET_LIGHT_SIZE, multiplier));
const shopBox = (map) => aabbFromBaseSize(map.shop.position, map.shop.size);
const buildingSize = (type) => type === "warehouse" ? WAREHOUSE_SIZE : TENEMENT_SIZE;
const buildingBox = (building) => {
  const size = scale(buildingSize(building.type), building.scale);
  return aabbFromRotatedBox(
    vec3(
      building.position.x,
      building.position.y + size.y / 2,
      building.position.z
    ),
    size,
    building.rotation
  );
};
const treeTrunkBox = (tree) => aabbFromBaseSize(tree.position, scale(TREE_TRUNK_SIZE, tree.scale));
const bushBox = (bush) => aabbFromBaseSize(bush.position, scale(BUSH_SIZE, bush.scale));
const coneBox = (cone) => aabbFromBaseSize(cone.position, scale(CONE_SIZE, cone.scale));
function solidColliders(map) {
  const colliders = [];
  map.walls.forEach(
    (wall) => colliders.push({
      box: wall.box,
      tag: { kind: "static", id: wall.id }
    })
  );
  colliders.push({
    box: shopBox(map),
    tag: { kind: "static", id: map.shop.id }
  });
  for (const building of map.buildings) {
    colliders.push({
      box: buildingBox(building),
      tag: { kind: "static", id: building.id }
    });
  }
  for (const car of map.cars) {
    colliders.push({ box: carBox(car), tag: { kind: "static", id: car.id } });
  }
  map.streetLights.forEach(
    (light) => colliders.push({
      box: streetLightBox(light.position, light.scale),
      tag: { kind: "static", id: light.id }
    })
  );
  map.trees.forEach(
    (tree) => colliders.push({
      box: treeTrunkBox(tree),
      tag: { kind: "static", id: tree.id }
    })
  );
  for (const prop of map.props) {
    if (isMovementOnlyProp(prop.type)) continue;
    propBoxes(prop).forEach((box, index) => colliders.push({
      box,
      tag: { kind: "static", id: `${prop.id}:${index}` }
    }));
  }
  return colliders;
}
function movementOnlyColliders(map) {
  return [
    ...map.props.filter((prop) => isMovementOnlyProp(prop.type)).flatMap((prop) => propBoxes(prop).map((box, index) => ({ id: `${prop.id}:${index}`, box }))),
    ...map.bushes.map((bush) => ({ id: bush.id, box: bushBox(bush) })),
    ...map.cones.map((cone) => ({ id: cone.id, box: coneBox(cone) }))
  ];
}

const LEVEL_SCHEMA_VERSION = 1;
const LEVEL_OBJECT_TYPES = [
  "wall",
  "shop",
  "warehouse",
  "tenement",
  "car",
  "street-light",
  "crate",
  "traffic-cone",
  "tree",
  "bush",
  ...PROP_TYPES
];
const LEVEL_OBJECT_TYPE_SET = new Set(LEVEL_OBJECT_TYPES);
const copyVec3 = (value) => ({
  x: value.x,
  y: value.y,
  z: value.z
});
function asVec3(objectTransform) {
  return copyVec3(objectTransform.position);
}
function uniformScale(objectTransform, path) {
  const { x, y, z } = objectTransform.scale;
  if (Math.abs(x - y) > 1e-4 || Math.abs(x - z) > 1e-4) {
    throw new Error(`${path}.scale must be uniform`);
  }
  return x;
}
function mapFromLevel(level) {
  const walls = [];
  let shop;
  const buildings = [];
  const cars = [];
  const streetLights = [];
  const crates = [];
  const cones = [];
  const trees = [];
  const bushes = [];
  const props = [];
  for (const object of level.objects) {
    const objectTransform = object.transform;
    const position = asVec3(objectTransform);
    switch (object.type) {
      case "fence":
      case "fence-gate":
      case "trash-bag":
      case "oil-barrel":
      case "forklift":
        props.push({
          id: object.id,
          type: object.type,
          position,
          rotation: objectTransform.rotation.y,
          scale: uniformScale(objectTransform, `objects.${object.id}.transform`)
        });
        break;
      case "wall":
        walls.push({
          id: object.id,
          box: aabbFromCenterSize(position, copyVec3(objectTransform.scale))
        });
        break;
      case "shop":
        if (shop) throw new Error("A level can contain only one shop");
        shop = {
          id: object.id,
          position,
          size: {
            x: SHOP_SIZE.x * objectTransform.scale.x,
            y: SHOP_SIZE.y * objectTransform.scale.y,
            z: SHOP_SIZE.z * objectTransform.scale.z
          }
        };
        break;
      case "warehouse":
      case "tenement":
        buildings.push({
          id: object.id,
          type: object.type,
          position,
          rotation: objectTransform.rotation.y,
          scale: uniformScale(
            objectTransform,
            `objects.${object.id}.transform`
          )
        });
        break;
      case "car":
        cars.push({
          id: object.id,
          position,
          rotation: objectTransform.rotation.y,
          scale: uniformScale(objectTransform, `objects.${object.id}.transform`),
          tiltZ: objectTransform.rotation.z
        });
        break;
      case "street-light":
        streetLights.push({
          rotation: objectTransform.rotation.y,
          id: object.id,
          position,
          scale: uniformScale(objectTransform, `objects.${object.id}.transform`)
        });
        break;
      case "crate":
        crates.push({
          id: object.id,
          position,
          size: uniformScale(objectTransform, `objects.${object.id}.transform`),
          rotation: objectTransform.rotation.y
        });
        break;
      case "traffic-cone":
        cones.push({
          id: object.id,
          position,
          scale: uniformScale(objectTransform, `objects.${object.id}.transform`),
          rotation: objectTransform.rotation.y
        });
        break;
      case "tree":
        trees.push({
          id: object.id,
          position,
          rotation: objectTransform.rotation.y,
          scale: uniformScale(objectTransform, `objects.${object.id}.transform`)
        });
        break;
      case "bush":
        bushes.push({
          id: object.id,
          position,
          rotation: objectTransform.rotation.y,
          scale: uniformScale(objectTransform, `objects.${object.id}.transform`)
        });
        break;
      default: {
        const unhandled = object.type;
        throw new Error(`Unhandled level object type: ${String(unhandled)}`);
      }
    }
  }
  if (!shop) throw new Error("A level must contain one shop");
  return {
    seed: level.seed,
    walls,
    shop,
    buildings,
    cars,
    streetLights,
    crates,
    cones,
    trees,
    bushes,
    props,
    spawnPoints: level.spawnPoints.map((spawn) => copyVec3(spawn.position))
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function validateVec3(value, path, diagnostics) {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.z)) {
    diagnostics.push({
      path,
      message: "Expected a vector with finite x, y, and z values",
      severity: "error"
    });
    return false;
  }
  return true;
}
function validateLevel(value) {
  const diagnostics = [];
  if (!isRecord(value)) {
    return [{ path: "", message: "Expected a level object", severity: "error" }];
  }
  if (value.schemaVersion !== LEVEL_SCHEMA_VERSION) {
    diagnostics.push({
      path: "schemaVersion",
      message: `Expected schema version ${LEVEL_SCHEMA_VERSION}`,
      severity: "error"
    });
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    diagnostics.push({
      path: "id",
      message: "Level ID must be a non-empty string",
      severity: "error"
    });
  }
  if (typeof value.name !== "string" || value.name.trim() === "") {
    diagnostics.push({
      path: "name",
      message: "Level name must be a non-empty string",
      severity: "error"
    });
  }
  if (!isFiniteNumber(value.seed)) {
    diagnostics.push({
      path: "seed",
      message: "Seed must be a finite number",
      severity: "error"
    });
  }
  if (!isFiniteNumber(value.groundSize) || value.groundSize <= 0) {
    diagnostics.push({
      path: "groundSize",
      message: "Ground size must be a positive number",
      severity: "error"
    });
  }
  const objects = Array.isArray(value.objects) ? value.objects : [];
  if (!Array.isArray(value.objects)) {
    diagnostics.push({
      path: "objects",
      message: "Objects must be an array",
      severity: "error"
    });
  }
  const ids = /* @__PURE__ */ new Set();
  let shopCount = 0;
  let wallCount = 0;
  objects.forEach((object, index) => {
    const path = `objects[${index}]`;
    if (!isRecord(object)) {
      diagnostics.push({ path, message: "Expected an object record", severity: "error" });
      return;
    }
    const id = object.id;
    if (typeof id !== "string" || id.trim() === "") {
      diagnostics.push({ path: `${path}.id`, message: "Object ID must be non-empty", severity: "error" });
    } else if (ids.has(id)) {
      diagnostics.push({ path: `${path}.id`, message: `Duplicate object ID "${id}"`, severity: "error" });
    } else {
      ids.add(id);
    }
    const type = object.type;
    if (typeof type !== "string" || !LEVEL_OBJECT_TYPE_SET.has(type)) {
      diagnostics.push({ path: `${path}.type`, message: "Unsupported object type", severity: "error" });
      return;
    }
    if (type === "shop") shopCount += 1;
    if (type === "wall") wallCount += 1;
    const objectTransform = object.transform;
    if (!isRecord(objectTransform) || !validateVec3(objectTransform.position, `${path}.transform.position`, diagnostics) || !validateVec3(objectTransform.rotation, `${path}.transform.rotation`, diagnostics) || !validateVec3(objectTransform.scale, `${path}.transform.scale`, diagnostics)) {
      return;
    }
    if ((type === "trash-bag" || type === "oil-barrel" || type === "forklift" || type === "fence" || type === "fence-gate") && (Math.abs(objectTransform.rotation.x) > 1e-4 || Math.abs(objectTransform.rotation.z) > 1e-4)) {
      diagnostics.push({
        path: `${path}.transform.rotation`,
        message: `${type} supports rotation around the Y axis only`,
        severity: "error"
      });
    }
    if ((type === "warehouse" || type === "tenement") && (Math.abs(objectTransform.rotation.x) > 1e-4 || Math.abs(objectTransform.rotation.z) > 1e-4)) {
      diagnostics.push({
        path: `${path}.transform.rotation`,
        message: `${type} supports rotation around the Y axis only`,
        severity: "error"
      });
    }
    const position = objectTransform.position;
    const scale = objectTransform.scale;
    if (scale.x <= 0 || scale.y <= 0 || scale.z <= 0) {
      diagnostics.push({
        path: `${path}.transform.scale`,
        message: "Scale values must be positive",
        severity: "error"
      });
    }
    if (isFiniteNumber(value.groundSize) && (Math.abs(position.x) > value.groundSize || Math.abs(position.z) > value.groundSize)) {
      diagnostics.push({
        path: `${path}.transform.position`,
        message: "Object is outside the playable world bounds",
        severity: "error"
      });
    }
    if (type === "car" || type === "warehouse" || type === "tenement" || type === "street-light" || type === "crate" || type === "traffic-cone" || type === "tree" || type === "bush" || type === "trash-bag" || type === "oil-barrel" || type === "forklift" || type === "fence" || type === "fence-gate") {
      if (Math.abs(scale.x - scale.y) > 1e-4 || Math.abs(scale.x - scale.z) > 1e-4) {
        diagnostics.push({
          path: `${path}.transform.scale`,
          message: `${type} scale must be uniform`,
          severity: "error"
        });
      }
    }
  });
  if (wallCount < 4) {
    diagnostics.push({
      path: "objects",
      message: "A playable level needs at least four boundary walls",
      severity: "error"
    });
  }
  if (shopCount !== 1) {
    diagnostics.push({
      path: "objects",
      message: "A playable level needs exactly one shop",
      severity: "error"
    });
  }
  const spawns = Array.isArray(value.spawnPoints) ? value.spawnPoints : [];
  if (!Array.isArray(value.spawnPoints)) {
    diagnostics.push({
      path: "spawnPoints",
      message: "Spawn points must be an array",
      severity: "error"
    });
  }
  if (spawns.length === 0) {
    diagnostics.push({
      path: "spawnPoints",
      message: "A playable level needs at least one spawn point",
      severity: "error"
    });
  }
  const spawnIds = /* @__PURE__ */ new Set();
  spawns.forEach((spawn, index) => {
    const path = `spawnPoints[${index}]`;
    if (!isRecord(spawn)) {
      diagnostics.push({ path, message: "Expected a spawn point record", severity: "error" });
      return;
    }
    if (typeof spawn.id !== "string" || spawn.id.trim() === "") {
      diagnostics.push({ path: `${path}.id`, message: "Spawn ID must be non-empty", severity: "error" });
    } else if (spawnIds.has(spawn.id)) {
      diagnostics.push({ path: `${path}.id`, message: `Duplicate spawn ID "${spawn.id}"`, severity: "error" });
    } else {
      spawnIds.add(spawn.id);
    }
    if (!validateVec3(spawn.position, `${path}.position`, diagnostics)) return;
    if (isFiniteNumber(value.groundSize) && (Math.abs(spawn.position.x) > value.groundSize / 2 || Math.abs(spawn.position.z) > value.groundSize / 2)) {
      diagnostics.push({
        path: `${path}.position`,
        message: "Spawn point is outside the playable ground",
        severity: "error"
      });
    }
  });
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return diagnostics;
  try {
    const level = value;
    const map = mapFromLevel(level);
    const colliders = [...solidColliders(map), ...movementOnlyColliders(map)];
    for (const spawn of level.spawnPoints) {
      const playerBox = aabbFromCenterSize(spawn.position, PLAYER_SIZE);
      if (colliders.some((collider) => aabbIntersects(playerBox, collider.box))) {
        diagnostics.push({
          path: `spawnPoints.${spawn.id}`,
          message: "Spawn point overlaps gameplay collision",
          severity: "error"
        });
      }
    }
  } catch (error) {
    diagnostics.push({
      path: "",
      message: error instanceof Error ? error.message : "Level could not be compiled",
      severity: "error"
    });
  }
  return diagnostics;
}
function parseLevelDocument(input) {
  const diagnostics = validateLevel(input);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n"));
  }
  return input;
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
    /** Shared solid geometry; crates and players are added per query. */
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
    this.staticColliders = solidColliders(this.map);
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
    const name = sanitizeNickname(payload.name);
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
      rotation: facingCenterYaw(payload.position),
      positionAt: this.clock(),
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
    player.positionAt = this.clock();
  }
  handleRespawn(playerId, _payload) {
    const player = this.players.get(playerId);
    if (!player || player.status !== "dead") return;
    const others = [];
    for (const other of this.players.values()) {
      if (other.id !== playerId && other.position) others.push(other.position);
    }
    const position = pickSpawnPoint(others, this.map.spawnPoints);
    player.status = "alive";
    player.hp = PLAYER_MAX_HP;
    player.position = { ...position };
    player.rotation = facingCenterYaw(position);
    player.positionAt = this.clock();
    this.transport.broadcast(GAME_EVENTS.PLAYER.RESPAWN, {
      playerId,
      position,
      hp: player.hp,
      rotation: player.rotation
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
      ({ id, userId, name, status, hp, position, rotation, positionAt }) => ({
        id,
        userId,
        name,
        status,
        hp,
        position,
        rotation,
        positionAt
      })
    );
  }
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

const levelsDirectory = fileURLToPath(
  new URL("../../shared/levels/", import.meta.url)
);
function loadServerLevel(levelId = process.env.LEVEL_ID ?? "default") {
  const path = resolve(levelsDirectory, `${levelId}.json`);
  const source = readFileSync(path, "utf8");
  const level = parseLevelDocument(JSON.parse(source));
  return mapFromLevel(level);
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
const room = new GameRoom(new SocketIOTransport(io), {
  map: loadServerLevel()
});
attachSocketIO(io, room);
startTickLoop(room, TICK_RATE);
server.listen(PORT, () => {
  console.log(`\u2705 Server listening on port ${PORT}`);
});
app.get("/", (_req, res) => {
  res.send("<h1>Hello world</h1>");
});
app.get("/leaderboard", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.send(room.leaderBoard);
});
