import express from 'express';
import * as http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GAME_EVENTS = {
  GAME: {
    /** Server -> client: authoritative full sync of the world (on join and on every round reset). */
    STATE: "game:state"
  },
  MATCH: {
    /** Server -> all: the match entered a new phase (warmup, countdown, active, round-end). */
    PHASE: "match:phase"
  },
  WORLD: {
    /** Server -> all, every tick: continuous state of everything that moves. */
    SNAPSHOT: "world:snapshot",
    INTERACT: "world:interact",
    BLAST: "world:blast",
    ARC: "world:arc"
  },
  USER: {
    /** Server -> others: a socket connected (before it joined the game). */
    CONNECTED: "user:connected",
    /** Client -> server: join the game. Server -> others: someone joined. */
    JOINED: "user:joined",
    /** Server -> joining client: the join was refused (room full). */
    JOIN_REJECTED: "user:join-rejected",
    /** Server -> others: a player left. */
    DISCONNECTED: "user:disconnected"
  },
  CHAT: {
    /** Client -> server: send a chat message. Server -> all: accepted message. */
    MESSAGE: "chat:message"
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
    /** Client -> server: throw intent (with the grenade kind). Server -> others: someone threw (cosmetic). */
    THROW: "grenade:throw",
    /** Server -> all: a grenade detonated; frag damage travels as COMBAT.HIT, clouds via WORLD.SNAPSHOT. */
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

var __defProp$4 = Object.defineProperty;
var __defNormalProp$4 = (obj, key, value) => key in obj ? __defProp$4(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$4 = (obj, key, value) => __defNormalProp$4(obj, key + "" , value);
class Rng {
  constructor(seed) {
    __publicField$4(this, "state");
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
  rocket: {
    id: "rocket",
    name: "Rocket Launcher",
    ammoType: "Rockets",
    ammoPickup: 2,
    color: 14191699,
    fireRate: 1.4,
    damage: 120,
    bulletSpeed: 18,
    range: 65,
    magazineSize: 1,
    reserveAmmo: 4,
    reloadTime: 2.8,
    pellets: 1,
    spreadAngle: 0
  },
  flamethrower: {
    id: "flamethrower",
    name: "Flamethrower",
    ammoType: "Fuel",
    ammoPickup: 40,
    color: 15971149,
    automatic: true,
    fireRate: 0.08,
    damage: 2,
    bulletSpeed: 18,
    range: 7,
    magazineSize: 80,
    reserveAmmo: 160,
    reloadTime: 2.6,
    pellets: 3,
    spreadAngle: 0.12
  },
  precision: {
    id: "precision",
    name: "Precision Rifle",
    ammoType: ".308 rounds",
    ammoPickup: 8,
    color: 11911626,
    fireRate: 1.35,
    damage: 85,
    bulletSpeed: 180,
    range: 140,
    magazineSize: 5,
    reserveAmmo: 20,
    reloadTime: 2.5,
    pellets: 1,
    spreadAngle: 0
  },
  arc: {
    id: "arc",
    name: "Arc Gun",
    ammoType: "Arc cells",
    ammoPickup: 12,
    color: 7854315,
    fireRate: 0.65,
    damage: 32,
    bulletSpeed: 75,
    range: 18,
    magazineSize: 8,
    reserveAmmo: 32,
    reloadTime: 2,
    pellets: 1,
    spreadAngle: 0
  },
  pistol: {
    id: "pistol",
    ammoType: "9mm rounds",
    ammoPickup: 30,
    color: 7184383,
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
    ammoType: "5.56mm rounds",
    ammoPickup: 40,
    color: 8629368,
    automatic: true,
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
    ammoType: "12-gauge shells",
    ammoPickup: 12,
    color: 14127462,
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
const WEAPON_IDS = ["pistol", "rifle", "shotgun", "rocket", "flamethrower", "precision", "arc"];
const ROCKET_BLAST_RADIUS = 5.5;
const rocketBlastDamage = (distance) => Math.max(0, Math.round(WEAPONS.rocket.damage * (1 - distance / ROCKET_BLAST_RADIUS)));
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
  const step = Math.min(p.speed * Math.max(0, dt), Math.max(0, p.maxRange - p.traveled));
  let to = add(p.position, scale(p.direction, step));
  let ground = false;
  if (to.y <= 0 && p.direction.y < 0) {
    const t = Math.max(0, p.position.y / (p.position.y - to.y));
    to = lerp(p.position, to, t);
    ground = true;
  }
  const hit = sweepProjectile(p.position, to, colliders, skip);
  if (hit) {
    p.traveled += Math.hypot(to.x - p.position.x, to.y - p.position.y, to.z - p.position.z) * hit.t;
    p.position = hit.point;
    return { hit, expired: true };
  }
  p.traveled += Math.hypot(to.x - p.position.x, to.y - p.position.y, to.z - p.position.z);
  p.position = to;
  return { hit: null, expired: ground || p.traveled >= p.maxRange - 1e-6 };
}

const PROP_TYPES = ["trash-bag", "oil-barrel", "forklift", "fence", "fence-gate", "tire-stack", "fire-barrel", "explosive-barrel", "smoke-zone", "alarm-zone", "warning-light", "cover-panel"];
const PARTS = {
  "trash-bag": [{ center: { x: 0, y: 0.47, z: 0 }, size: { x: 0.78, y: 0.94, z: 0.64 } }],
  "oil-barrel": [{ center: { x: 0, y: 0.46, z: 0 }, size: { x: 0.66, y: 0.92, z: 0.66 } }],
  fence: [{ center: { x: 0, y: 1.34, z: 0 }, size: { x: 4.18, y: 2.68, z: 0.18 } }],
  "fence-gate": [{ center: { x: 0, y: 1.34, z: 0 }, size: { x: 4.18, y: 2.68, z: 0.24 } }],
  "tire-stack": [{ center: { x: 0, y: 0.6, z: 0 }, size: { x: 1.15, y: 1.2, z: 1.15 } }],
  "cover-panel": [{ center: { x: 0, y: 0.75, z: 0 }, size: { x: 2.4, y: 1.5, z: 0.55 } }],
  "fire-barrel": [{ center: { x: 0, y: 0.46, z: 0 }, size: { x: 0.66, y: 0.92, z: 0.66 } }],
  "explosive-barrel": [{ center: { x: 0, y: 0.46, z: 0 }, size: { x: 0.66, y: 0.92, z: 0.66 } }],
  "smoke-zone": [],
  "alarm-zone": [],
  "warning-light": [],
  forklift: [
    { center: { x: 0, y: 1.25, z: 0.04 }, size: { x: 1.76, y: 2.5, z: 2.55 } },
    { center: { x: 0, y: 0.15, z: -1.98 }, size: { x: 1.06, y: 0.3, z: 1.46 } }
  ]
};
const isMovementOnlyProp = (type) => type === "trash-bag" || type === "fence" || type === "fence-gate";
const isDynamicProp = (type) => ["fence-gate", "tire-stack", "explosive-barrel", "cover-panel", "smoke-zone", "alarm-zone"].includes(type);
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
const spawn = (x, y, z, team) => ({
  position: vec3(x, y, z),
  team
});
const SPAWN_POINTS = [
  spawn(-16, 1, -33, "blue"),
  spawn(-11, 1, -34, "blue"),
  spawn(0, 1, -34, "blue"),
  spawn(11, 1, -34, "blue"),
  spawn(16, 1, -33, "blue"),
  spawn(16, 1, 33, "red"),
  spawn(11, 1, 34, "red"),
  spawn(0, 1, 34, "red"),
  spawn(-11, 1, 34, "red"),
  spawn(-16, 1, 33, "red")
];
const facingCenterYaw = (position) => Math.atan2(position.x, position.z);
const spawnPointsFor = (team, points = SPAWN_POINTS) => points.filter((point) => point.team === team);
function pickSpawnPoint(occupied, points = SPAWN_POINTS) {
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

var __defProp$3 = Object.defineProperty;
var __defNormalProp$3 = (obj, key, value) => key in obj ? __defProp$3(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$3 = (obj, key, value) => __defNormalProp$3(obj, typeof key !== "symbol" ? key + "" : key, value);
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
  arena.prop("tire-stack", "tires-yard", 10.5, -16, 0);
  arena.prop("cover-panel", "cover-yard", -11, -13, 0.2);
  arena.prop("fire-barrel", "fire-flank", 23, -13, 0);
  arena.prop("explosive-barrel", "fuel-yard", 6.1, -13.4, 0);
  arena.prop("explosive-barrel", "fuel-mid", 6, -6, 0.3);
  arena.prop("smoke-zone", "smoke-flank", -16, -8, 0);
  arena.prop("alarm-zone", "alarm-yard", 17, -11, 0);
  arena.prop("warning-light", "beacon-yard", -17, -11, 0);
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
    spawnPoints: SPAWN_POINTS.map((point) => ({
      position: { ...point.position },
      team: point.team
    }))
  };
}
const mirrored = (p) => vec3(-p.x || 0, p.y, -p.z || 0);
class ArenaBuilder {
  constructor(rng) {
    __publicField$3(this, "rng", rng);
    __publicField$3(this, "buildings", []);
    __publicField$3(this, "cars", []);
    __publicField$3(this, "streetLights", []);
    __publicField$3(this, "crates", []);
    __publicField$3(this, "cones", []);
    __publicField$3(this, "trees", []);
    __publicField$3(this, "bushes", []);
    __publicField$3(this, "props", []);
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
  /**
   * Seven crates in three supported tiers: a lane landmark and the tallest
   * cover on the map. Each upper crate overlaps the two crates below it.
   */
  pyramid(x, z, size = 1) {
    const d = size * 0.55;
    this.crate(x - d, z - d, size, 0);
    this.crate(x + d, z - d, size, PI / 6);
    this.crate(x - d, z + d, size, -PI / 8);
    this.crate(x + d, z + d, size, PI / 3);
    this.crate(x - d, z, size, PI / 4, 1);
    this.crate(x + d, z, size, -PI / 4, 1);
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
    if (isMovementOnlyProp(prop.type) || isDynamicProp(prop.type)) continue;
    propBoxes(prop).forEach((box, index) => colliders.push({
      box,
      tag: { kind: "static", id: `${prop.id}:${index}` }
    }));
  }
  return colliders;
}
function movementOnlyColliders(map) {
  return [
    ...map.props.filter((prop) => isMovementOnlyProp(prop.type) && !isDynamicProp(prop.type)).flatMap((prop) => propBoxes(prop).map((box, index) => ({ id: `${prop.id}:${index}`, box }))),
    ...map.bushes.map((bush) => ({ id: bush.id, box: bushBox(bush) })),
    ...map.cones.map((cone) => ({ id: cone.id, box: coneBox(cone) }))
  ];
}

var __defProp$2 = Object.defineProperty;
var __defNormalProp$2 = (obj, key, value) => key in obj ? __defProp$2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$2 = (obj, key, value) => __defNormalProp$2(obj, typeof key !== "symbol" ? key + "" : key, value);
const interactionHp = (type) => type === "explosive-barrel" ? 45 : type === "tire-stack" ? 120 : type === "cover-panel" ? 80 : 1;
function initialInteractions(props) {
  return props.filter((p) => isDynamicProp(p.type)).map((p) => ({ id: p.id, hp: interactionHp(p.type), open: 0, targetOpen: false, active: 0, cooldown: 0 }));
}
function interactionBoxes(prop, state) {
  if (state.hp <= 0)
    return [];
  const guides = prop.type === "fence-gate" ? [-2.02, 2.02].map((x) => {
    const c = Math.cos(prop.rotation), sin = Math.sin(prop.rotation), k = prop.scale;
    return aabbFromCenterSize({ x: prop.position.x + x * c * k, y: prop.position.y + 2.75 * k, z: prop.position.z - x * sin * k }, { x: 0.26 * k, y: 5.5 * k, z: 0.3 * k });
  }) : [];
  return [...guides, ...propBoxes({ ...prop, position: { ...prop.position, y: prop.position.y + (prop.type === "fence-gate" ? state.open * 3 * prop.scale : 0) } })];
}
const interactionDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
class InteractiveWorld {
  constructor(props) {
    __publicField$2(this, "specs");
    __publicField$2(this, "states", /* @__PURE__ */ new Map());
    this.specs = new Map(props.filter((p) => isDynamicProp(p.type)).map((p) => [p.id, p]));
    this.reset();
  }
  reset() {
    this.states.clear();
    for (const s of initialInteractions([...this.specs.values()])) this.states.set(s.id, s);
  }
  snapshot() {
    return [...this.states.values()].map((s) => ({ ...s }));
  }
  interact(id, player, players) {
    const p = this.specs.get(id), s = this.states.get(id);
    if (!p || !s || !player.position || player.status !== "alive" || s.hp <= 0 || s.cooldown > 0 || interactionDistance(p.position, player.position) > 3 * p.scale || Math.abs(player.position.y - p.position.y) > 3)
      return false;
    if (p.type === "fence-gate") {
      if (s.targetOpen && this.occupied(p, players))
        return false;
      s.targetOpen = !s.targetOpen;
      s.cooldown = 1;
      return true;
    }
    if (p.type === "smoke-zone") {
      s.active = 7;
      s.cooldown = 22;
      return true;
    }
    return false;
  }
  occupied(p, players) {
    return players.some((player) => player.status === "alive" && player.position && propBoxes(p).some((b) => aabbIntersects(b, aabbFromCenterSize(player.position, { x: 1.4, y: 2, z: 1.4 }))));
  }
  tick(dt, players, enabled = true) {
    for (const [id, s] of this.states) {
      const p = this.specs.get(id);
      s.active = Math.max(0, s.active - dt);
      s.cooldown = Math.max(0, s.cooldown - dt);
      if (p.type === "fence-gate") {
        if (!s.targetOpen && s.open > 0 && this.occupied(p, players))
          s.targetOpen = true;
        s.open = Math.max(0, Math.min(1, s.open + (s.targetOpen ? 1 : -1) * dt));
      }
      if (enabled && p.type === "alarm-zone" && s.cooldown === 0 && players.some((v) => v.status === "alive" && v.position && interactionDistance(p.position, v.position) < 3 * p.scale && Math.abs(v.position.y - p.position.y) < 3)) {
        s.active = 4;
        s.cooldown = 10;
      }
    }
  }
  /** Returns true only for the first destruction of an explosive barrel. */
  damage(id, damage) {
    const s = this.states.get(id), p = this.specs.get(id);
    if (!s || !p || !["tire-stack", "cover-panel", "explosive-barrel"].includes(p.type) || s.hp <= 0 || !Number.isFinite(damage) || damage <= 0)
      return false;
    s.hp = Math.max(0, s.hp - damage);
    if (s.hp === 0 && p.type === "explosive-barrel") {
      s.active = 8;
      return true;
    }
    return false;
  }
}

const TEAMS = ["blue", "red"];
const MAX_TEAM_SIZE = 5;
MAX_TEAM_SIZE * TEAMS.length;
const isTeam = (value) => value === "blue" || value === "red";
const emptyTeamScores = () => ({ blue: 0, red: 0 });
function pickTeam(counts) {
  const blueOpen = counts.blue < MAX_TEAM_SIZE;
  const redOpen = counts.red < MAX_TEAM_SIZE;
  if (!blueOpen && !redOpen) return null;
  if (!redOpen) return "blue";
  if (!blueOpen) return "red";
  return counts.red < counts.blue ? "red" : "blue";
}

const LEVEL_SCHEMA_VERSION = 2;
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
      case "tire-stack":
      case "fire-barrel":
      case "explosive-barrel":
      case "smoke-zone":
      case "alarm-zone":
      case "warning-light":
      case "cover-panel":
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
    spawnPoints: level.spawnPoints.map((spawn) => ({
      position: copyVec3(spawn.position),
      team: spawn.team
    }))
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
    if ((type === "trash-bag" || type === "oil-barrel" || type === "forklift" || type === "fence" || type === "fence-gate" || type === "tire-stack" || type === "fire-barrel" || type === "explosive-barrel" || type === "smoke-zone" || type === "alarm-zone" || type === "warning-light" || type === "cover-panel") && (Math.abs(objectTransform.rotation.x) > 1e-4 || Math.abs(objectTransform.rotation.z) > 1e-4)) {
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
    if (type === "car" || type === "warehouse" || type === "tenement" || type === "street-light" || type === "crate" || type === "traffic-cone" || type === "tree" || type === "bush" || type === "trash-bag" || type === "oil-barrel" || type === "forklift" || type === "fence" || type === "fence-gate" || type === "tire-stack" || type === "fire-barrel" || type === "explosive-barrel" || type === "smoke-zone" || type === "alarm-zone" || type === "warning-light" || type === "cover-panel") {
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
  const spawnsPerTeam = { blue: 0, red: 0 };
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
    if (!isTeam(spawn.team)) {
      diagnostics.push({
        path: `${path}.team`,
        message: `Spawn team must be one of ${TEAMS.map((team) => `"${team}"`).join(", ")}`,
        severity: "error"
      });
    } else {
      spawnsPerTeam[spawn.team] += 1;
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
  if (spawns.length > 0) {
    for (const team of TEAMS) {
      const count = spawnsPerTeam[team];
      if (count === 0) {
        diagnostics.push({
          path: "spawnPoints",
          message: `A playable level needs at least one ${team} spawn point`,
          severity: "error"
        });
      } else if (count !== MAX_TEAM_SIZE) {
        diagnostics.push({
          path: "spawnPoints",
          message: `Expected ${MAX_TEAM_SIZE} ${team} spawn points (one per player), found ${count}`,
          severity: "warning"
        });
      }
    }
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return diagnostics;
  try {
    const level = value;
    const map = mapFromLevel(level);
    const colliders = [...solidColliders(map), ...movementOnlyColliders(map), ...initialInteractions(map.props).flatMap((s) => interactionBoxes(map.props.find((p) => p.id === s.id), s).map((box) => ({ box })))];
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

const DEFAULT_MATCH_RULES = {
  killLimit: 30,
  roundMs: 8 * 6e4,
  roundEndMs: 8e3,
  countdownMs: 5e3
};
const initialMatchState = () => ({
  phase: "warmup",
  phaseEndsAt: null,
  result: null
});
const canPlayRound = (counts) => counts.blue > 0 && counts.red > 0;
function roundWinner(scores) {
  if (scores.blue === scores.red) return "draw";
  return scores.blue > scores.red ? "blue" : "red";
}
const movementAllowed = (phase) => phase !== "countdown";
const combatAllowed = (phase) => phase === "warmup" || phase === "active";
function stepMatch(state, input, rules = DEFAULT_MATCH_RULES) {
  const { now, teamCounts, teamScores } = input;
  const playable = canPlayRound(teamCounts);
  const expired = state.phaseEndsAt !== null && now >= state.phaseEndsAt;
  const go = (to, phaseEndsAt, reset, result = null) => ({
    state: { phase: to, phaseEndsAt, result },
    transition: { from: state.phase, to, reset }
  });
  const stay = { state, transition: null };
  switch (state.phase) {
    case "warmup":
      return playable ? go("countdown", now + rules.countdownMs, true) : stay;
    case "countdown":
      if (!playable) return go("warmup", null, false);
      return expired ? go("active", now + rules.roundMs, false) : stay;
    case "active": {
      const limitReached = Math.max(teamScores.blue, teamScores.red) >= rules.killLimit;
      if (!limitReached && !expired) return stay;
      return go("round-end", now + rules.roundEndMs, false, {
        winner: roundWinner(teamScores),
        teamScores: { ...teamScores }
      });
    }
    case "round-end":
      if (!expired) return stay;
      return playable ? go("countdown", now + rules.countdownMs, true) : go("warmup", null, true);
    default: {
      const unhandled = state.phase;
      throw new Error(`Unhandled match phase: ${String(unhandled)}`);
    }
  }
}

const playerHitbox = (position, yaw) => ({
  box: aabbFromCenterSize(position, PLAYER_SIZE),
  yaw
});
const playerCollider = (position, yaw, tag) => ({ ...playerHitbox(position, yaw), tag });

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
const GRENADE_KINDS = ["frag", "smoke", "flash", "gas", "molotov"];
const isGrenadeKind = (value) => typeof value === "string" && GRENADE_KINDS.includes(value);
const shattersOnImpact = (kind) => kind === "molotov";
const GRENADE_LOADOUT = {
  frag: { start: 2, pickup: 2 },
  smoke: { start: 1, pickup: 2 },
  flash: { start: 1, pickup: 2 },
  gas: { start: 0, pickup: 2 },
  molotov: { start: 0, pickup: 2 }
};
const GRENADE_EFFECTS = {
  smoke: {
    /** Cloud radius, u. */
    radius: 3.5,
    /** Seconds the cloud lingers. */
    duration: 9
  },
  gas: {
    radius: 3,
    duration: 8,
    /** Damage per second to anyone standing inside. */
    dps: 12
  },
  flash: {
    /** Blinding falls off linearly to zero at this distance. */
    radius: 9},
  molotov: {
    /** Radius of the burning pool, u. */
    radius: 2.5,
    /** Seconds the fire burns. */
    duration: 6,
    /** Damage per second to anyone standing in the fire: fast, so it clears cover. */
    dps: 25
  }
};
const CLOUD_EFFECTS = {
  smoke: { ...GRENADE_EFFECTS.smoke, dps: 0, source: "smoke" },
  gas: { ...GRENADE_EFFECTS.gas, source: "gas" },
  fire: { ...GRENADE_EFFECTS.molotov, source: "molotov" }
};
function cloudKindOf(kind) {
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
      const unhandled = kind;
      throw new Error(`Unhandled grenade kind: ${String(unhandled)}`);
    }
  }
}
const CLOUD_HEIGHT = 2.5;
function spawnCloud(id, grenade, kind) {
  return {
    id,
    kind,
    ownerId: grenade.ownerId,
    position: { x: grenade.position.x, y: 0, z: grenade.position.z },
    remaining: CLOUD_EFFECTS[kind].duration
  };
}
function cloudContains(cloud, point) {
  const { radius } = CLOUD_EFFECTS[cloud.kind];
  const dy = point.y - cloud.position.y;
  if (dy < -0.5 || dy > CLOUD_HEIGHT) return false;
  return Math.hypot(point.x - cloud.position.x, point.z - cloud.position.z) < radius;
}
function flashIntensity(center, target) {
  const d = distance(center, target);
  const { radius } = GRENADE_EFFECTS.flash;
  if (d >= radius) return 0;
  return Math.round((1 - d / radius) * 100) / 100;
}
function spawnGrenade(id, ownerId, kind, origin, direction) {
  const dir = normalize(direction);
  return {
    id,
    kind,
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
  const weaponId = WEAPON_IDS[rng.int(WEAPON_IDS.length)];
  return {
    id,
    kind: "ammo",
    position,
    weaponId,
    amount: WEAPONS[weaponId].ammoPickup
  };
}
const CRATE_DROP_ODDS = { weapon: 0.3, throwable: 0.5, health: 0.75 };
function rollCrateDrop(rng, id, position) {
  const roll = rng.next();
  if (roll < CRATE_DROP_ODDS.weapon) {
    const weaponId2 = WEAPON_IDS[rng.int(WEAPON_IDS.length)];
    return { id, kind: "weapon", position, weaponId: weaponId2, amount: WEAPONS[weaponId2].ammoPickup };
  }
  if (roll < CRATE_DROP_ODDS.throwable) {
    const grenadeKind = GRENADE_KINDS[rng.int(GRENADE_KINDS.length)];
    return { id, kind: "throwable", position, grenadeKind, amount: GRENADE_LOADOUT[grenadeKind].pickup };
  }
  if (roll < CRATE_DROP_ODDS.health) {
    return { id, kind: "health", position, amount: 25 };
  }
  const weaponId = WEAPON_IDS[rng.int(WEAPON_IDS.length)];
  return {
    id,
    kind: "ammo",
    position,
    weaponId,
    amount: WEAPONS[weaponId].ammoPickup
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

var __defProp$1 = Object.defineProperty;
var __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$1 = (obj, key, value) => __defNormalProp$1(obj, typeof key !== "symbol" ? key + "" : key, value);
const KILL_SCORE = 100;
const CAR_CONTACT_DPS = 20;
const FIRE_RATE_TOLERANCE = 0.85;
const CHAT_MESSAGE_MAX_LENGTH = 128;
const CHAT_RATE_LIMIT_MS = 500;
class GameRoom {
  constructor(transport, options = {}) {
    __publicField$1(this, "transport", transport);
    /** Last known state of every player who has joined, keyed by player id. */
    __publicField$1(this, "players", /* @__PURE__ */ new Map());
    /** This round's per-player rows; zeroed on every round reset. */
    __publicField$1(this, "leaderBoard", {});
    /**
     * Kills per team this round. Kept apart from the per-player rows so a
     * leaver's kills stay on the board until the reset.
     */
    __publicField$1(this, "teamScores", emptyTeamScores());
    /** Where the round loop stands. Advanced once per tick by `stepMatch`. */
    __publicField$1(this, "match", initialMatchState());
    __publicField$1(this, "map");
    __publicField$1(this, "interactions");
    /** Bullets in flight. */
    __publicField$1(this, "projectiles", []);
    /** Grenades in flight or resting, keyed by grenade id. */
    __publicField$1(this, "grenades", /* @__PURE__ */ new Map());
    /** Smoke and gas clouds left by grenades, keyed by cloud id. */
    __publicField$1(this, "clouds", /* @__PURE__ */ new Map());
    /** Surviving crates keyed by crate id. */
    __publicField$1(this, "crates", /* @__PURE__ */ new Map());
    /** Pickups lying in the world keyed by pickup id. */
    __publicField$1(this, "pickups", /* @__PURE__ */ new Map());
    __publicField$1(this, "clock");
    __publicField$1(this, "rng");
    __publicField$1(this, "matchRules");
    /** Shared solid geometry; crates and players are added per query. */
    __publicField$1(this, "staticColliders");
    __publicField$1(this, "tickCount", 0);
    __publicField$1(this, "nextProjectileId", 1);
    __publicField$1(this, "nextPickupId", 1);
    __publicField$1(this, "nextGrenadeId", 1);
    __publicField$1(this, "nextChatMessageId", 1);
    /** Seconds until the next random pickup spawn. */
    __publicField$1(this, "pickupSpawnIn");
    this.clock = options.clock ?? Date.now;
    this.rng = new Rng(options.seed ?? Date.now() & 4294967295);
    this.map = options.map ?? generateMap();
    this.matchRules = options.matchRules ?? DEFAULT_MATCH_RULES;
    this.staticColliders = solidColliders(this.map);
    this.interactions = new InteractiveWorld(this.map.props);
    this.resetCrates();
    this.pickupSpawnIn = this.rollPickupSpawnDelay();
  }
  /** What `GET /leaderboard` serves. */
  leaderboardResponse() {
    return {
      players: this.leaderBoard,
      teams: { ...this.teamScores },
      match: this.snapshotMatch()
    };
  }
  /** How many joined players each team has right now. */
  teamCounts() {
    const counts = { blue: 0, red: 0 };
    for (const player of this.players.values()) counts[player.team] += 1;
    return counts;
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
      case GAME_EVENTS.WORLD.INTERACT: {
        const player = this.players.get(playerId);
        const id = payload?.id;
        if (player && typeof id === "string" && combatAllowed(this.match.phase)) this.interactions.interact(id, player, [...this.players.values()]);
        break;
      }
      case GAME_EVENTS.USER.JOINED:
        this.handleJoin(playerId, payload);
        break;
      case GAME_EVENTS.CHAT.MESSAGE:
        this.handleChatMessage(playerId, payload);
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
    this.interactions.tick(dt, [...this.players.values()], combatAllowed(this.match.phase));
    this.stepProjectiles(dt);
    this.stepGrenades(dt);
    this.stepClouds(dt);
    this.stepCarContact(dt);
    this.stepPickups(dt, now);
    this.stepMatch(now);
    this.transport.broadcast(GAME_EVENTS.WORLD.SNAPSHOT, {
      tick: this.tickCount,
      serverTime: now,
      players: this.snapshotPlayers(),
      grenades: this.snapshotGrenades(),
      clouds: this.snapshotClouds(),
      interactions: this.interactions.snapshot(),
      match: this.snapshotMatch()
    });
  }
  // ---- match pacing ------------------------------------------------------
  /** Advance the round loop and carry out whatever transition it reports. */
  stepMatch(now) {
    const { state, transition } = stepMatch(
      this.match,
      { now, teamCounts: this.teamCounts(), teamScores: this.teamScores },
      this.matchRules
    );
    this.match = state;
    if (!transition) return;
    if (transition.reset) this.resetWorld();
    this.transport.broadcast(GAME_EVENTS.MATCH.PHASE, this.matchPhaseEvent(transition));
  }
  matchPhaseEvent(transition) {
    const base = this.snapshotMatch();
    const result = this.match.result;
    if (transition.to !== "round-end" || !result) return base;
    return {
      ...base,
      result: { ...result, leaderboard: Object.values(this.leaderBoard) }
    };
  }
  /**
   * A new round starts: scores, players, crates, pickups, grenades and
   * bullets all go back to their initial state, then every player gets an
   * authoritative full sync to rebuild their world from.
   */
  resetWorld() {
    this.interactions.reset();
    this.teamScores.blue = 0;
    this.teamScores.red = 0;
    for (const row of Object.values(this.leaderBoard)) {
      row.kills = 0;
      row.deaths = 0;
      row.score = 0;
    }
    this.projectiles.length = 0;
    this.grenades.clear();
    this.clouds.clear();
    this.pickups.clear();
    this.pickupSpawnIn = this.rollPickupSpawnDelay();
    this.resetCrates();
    for (const player of this.players.values()) {
      this.placeAtSpawn(player);
      player.lastShotAt = -Infinity;
      player.lastThrowAt = -Infinity;
      player.pendingHazardDamage = 0;
      player.pendingCloudDamage = 0;
    }
    for (const playerId of this.players.keys()) {
      this.transport.send(playerId, GAME_EVENTS.GAME.STATE, this.gameStateFor(playerId));
    }
  }
  resetCrates() {
    this.crates.clear();
    for (const spec of this.map.crates) {
      this.crates.set(spec.id, { spec, hp: CRATE_MAX_HP });
    }
  }
  /** Stand `player` up, alive with full HP, on their team's spawn street. */
  placeAtSpawn(player) {
    const position = this.pickSpawnFor(player.team, player.id);
    player.status = "alive";
    player.pose = void 0;
    player.hp = PLAYER_MAX_HP;
    player.position = { ...position };
    player.rotation = facingCenterYaw(position);
    player.positionAt = this.clock();
    return position;
  }
  gameStateFor(playerId) {
    return {
      selfId: playerId,
      interactions: this.interactions.snapshot(),
      players: this.snapshotPlayers(),
      crates: this.snapshotCrates(),
      pickups: [...this.pickups.values()].map((p) => p.spec),
      match: { ...this.snapshotMatch(), result: this.match.result }
    };
  }
  snapshotMatch() {
    return {
      phase: this.match.phase,
      phaseEndsAt: this.match.phaseEndsAt,
      teamScores: { ...this.teamScores }
    };
  }
  // ---- intents -----------------------------------------------------------
  handleJoin(playerId, payload) {
    this.players.delete(playerId);
    delete this.leaderBoard[playerId];
    const team = pickTeam(this.teamCounts());
    if (team === null) {
      this.transport.send(playerId, GAME_EVENTS.USER.JOIN_REJECTED, {
        reason: "room-full"
      });
      return;
    }
    const name = sanitizeNickname(payload.name);
    const position = this.pickSpawnFor(team, playerId);
    const rotation = facingCenterYaw(position);
    this.players.set(playerId, {
      id: playerId,
      userId: playerId,
      name,
      team,
      status: "alive",
      hp: PLAYER_MAX_HP,
      position,
      rotation,
      positionAt: this.clock(),
      lastShotAt: -Infinity,
      lastThrowAt: -Infinity,
      lastChatAt: -Infinity,
      pendingHazardDamage: 0,
      pendingCloudDamage: 0
    });
    this.leaderBoard[playerId] = {
      id: playerId,
      userId: playerId,
      name,
      team,
      kills: 0,
      deaths: 0,
      score: 0
    };
    this.transport.send(playerId, GAME_EVENTS.GAME.STATE, this.gameStateFor(playerId));
    this.transport.broadcast(
      GAME_EVENTS.USER.JOINED,
      {
        id: playerId,
        userId: playerId,
        timestamp: payload.timestamp,
        name,
        team,
        position: { ...position },
        rotation
      },
      playerId
    );
  }
  /** A spawn in `team`'s zone, as far as possible from everyone else. */
  pickSpawnFor(team, playerId) {
    const others = [];
    for (const other of this.players.values()) {
      if (other.id !== playerId && other.position) others.push(other.position);
    }
    const points = spawnPointsFor(team, this.map.spawnPoints);
    return { ...pickSpawnPoint(others, points) };
  }
  handleChatMessage(playerId, payload) {
    const player = this.players.get(playerId);
    if (!player || player.status !== "alive") return;
    const text = payload.text.trim();
    if (!text || /[\u0000-\u001f\u007f]/u.test(text)) return;
    const now = this.clock();
    if (now - player.lastChatAt < CHAT_RATE_LIMIT_MS) return;
    player.lastChatAt = now;
    this.transport.broadcast(GAME_EVENTS.CHAT.MESSAGE, {
      messageId: `${playerId}-${this.nextChatMessageId++}`,
      senderId: playerId,
      senderName: player.name,
      text: Array.from(text).slice(0, CHAT_MESSAGE_MAX_LENGTH).join(""),
      serverTime: now
    });
  }
  handlePosition(playerId, payload) {
    const player = this.players.get(playerId);
    if (!player || player.status === "dead") return;
    if (!movementAllowed(this.match.phase)) return;
    player.position = payload.position;
    player.rotation = payload.rotation;
    player.positionAt = this.clock();
    const pose = payload.pose;
    player.pose = pose ? {
      crouched: pose.crouched === true,
      grounded: pose.grounded === true,
      reload: Number.isFinite(pose.reload) ? Math.min(1, Math.max(0, pose.reload)) : 0
    } : void 0;
  }
  handleRespawn(playerId, _payload) {
    const player = this.players.get(playerId);
    if (!player || player.status !== "dead") return;
    const position = this.placeAtSpawn(player);
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
    if (!combatAllowed(this.match.phase)) return;
    if (!isWeaponId(payload.weaponType)) return;
    const origin = payload.data?.position;
    const direction = payload.data?.direction;
    if (!origin || !direction || ![origin.x, origin.y, origin.z, direction.x, direction.y, direction.z].every(Number.isFinite) || Math.hypot(direction.x, direction.y, direction.z) < 1e-6) return;
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
    if (!this.players.has(playerId) || !isWeaponId(payload.weaponType)) return;
    this.transport.broadcast(
      GAME_EVENTS.WEAPON.SWITCH,
      { id: playerId, userId: playerId, ...payload },
      playerId
    );
  }
  handlePickupClaim(playerId, payload) {
    const player = this.players.get(playerId);
    if (!player || player.status !== "alive" || !player.position) return;
    if (!combatAllowed(this.match.phase)) return;
    const pickup = this.pickups.get(payload.pickupId);
    if (!pickup) return;
    if (!isWithinPickupReach(player.position, pickup.spec.position)) return;
    this.pickups.delete(pickup.spec.id);
    switch (pickup.spec.kind) {
      case "health":
        player.hp = Math.min(PLAYER_MAX_HP, player.hp + pickup.spec.amount);
        break;
      case "weapon":
      case "ammo":
      case "throwable":
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
    if (!combatAllowed(this.match.phase)) return;
    if (!payload.position || !payload.direction || !isGrenadeKind(payload.kind)) return;
    const now = this.clock();
    if (now - player.lastThrowAt < GRENADE.throwCooldown * 1e3) return;
    player.lastThrowAt = now;
    const id = `grenade-${this.nextGrenadeId++}`;
    this.grenades.set(
      id,
      spawnGrenade(id, playerId, payload.kind, payload.position, payload.direction)
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
    const colliders = [...this.staticColliders, ...this.crateColliders(), ...this.interactionColliders()];
    for (const grenade of this.grenades.values()) {
      const bounce = integrateGrenade(grenade, dt, colliders);
      const shattered = bounce !== null && shattersOnImpact(grenade.kind);
      if (grenade.fuse <= 0 || shattered) this.explodeGrenade(grenade);
    }
  }
  /**
   * The fuse ran out (or the bottle broke): resolve what this kind of grenade
   * does and tell everyone.
   */
  explodeGrenade(grenade) {
    this.grenades.delete(grenade.id);
    const outcome = {
      grenadeId: grenade.id,
      kind: grenade.kind,
      ownerId: grenade.ownerId,
      position: grenade.position,
      hits: [],
      flashed: []
    };
    switch (grenade.kind) {
      case "frag":
        outcome.hits = this.fragHits(grenade.position);
        break;
      case "flash":
        outcome.flashed = this.flashVictims(grenade.position);
        break;
      case "smoke":
      case "gas":
      case "molotov": {
        const cloudKind = cloudKindOf(grenade.kind);
        if (!cloudKind) break;
        this.clouds.set(`cloud-${grenade.id}`, spawnCloud(`cloud-${grenade.id}`, grenade, cloudKind));
        break;
      }
      default: {
        const unhandled = grenade.kind;
        throw new Error(`Unhandled grenade kind: ${String(unhandled)}`);
      }
    }
    this.transport.broadcast(GAME_EVENTS.GRENADE.EXPLODED, outcome);
    if (grenade.kind !== "frag") return;
    const center = grenade.position;
    for (const p of this.interactions.specs.values()) this.damageInteraction(p.id, blastDamage(center, { ...p.position, y: p.position.y + 0.5 }), grenade.ownerId);
    for (const { targetId, damage } of outcome.hits) {
      if (this.players.has(targetId)) {
        this.applyDamage(grenade.ownerId, targetId, damage, "grenade", center);
      } else {
        this.damageCrate(targetId, damage);
      }
    }
  }
  /** Players and crates inside a frag blast at `center`, with the damage each takes. */
  fragHits(center) {
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
    return hits;
  }
  /**
   * Everyone alive within the flash radius who has a clear line to it, the
   * thrower included. Solid cover blocks the flash, like rocket splash.
   */
  flashVictims(center) {
    const blockers = [...this.staticColliders, ...this.crateColliders(), ...this.interactionColliders()];
    const flashed = [];
    for (const player of this.players.values()) {
      if (player.status !== "alive" || !player.position) continue;
      const intensity = flashIntensity(center, player.position);
      if (intensity <= 0 || sweepProjectile(center, player.position, blockers)) continue;
      flashed.push({ targetId: player.id, intensity });
    }
    return flashed;
  }
  /**
   * Clouds thin out and vanish; while a gas cloud or a fire lasts, anyone
   * standing in it takes its damage per second. Like car contact, damage
   * accumulates per player and lands in whole points so the event stream stays
   * sparse. Overlapping hazards do not stack: the worst one applies.
   */
  stepClouds(dt) {
    if (this.clouds.size === 0) return;
    for (const cloud of this.clouds.values()) {
      cloud.remaining -= dt;
      if (cloud.remaining <= 0) this.clouds.delete(cloud.id);
    }
    for (const player of this.players.values()) {
      if (player.status !== "alive" || !player.position) continue;
      const position = player.position;
      let hazard = null;
      for (const cloud of this.clouds.values()) {
        if (CLOUD_EFFECTS[cloud.kind].dps <= 0 || !cloudContains(cloud, position)) continue;
        if (!hazard || CLOUD_EFFECTS[cloud.kind].dps > CLOUD_EFFECTS[hazard.kind].dps) hazard = cloud;
      }
      if (!hazard) {
        player.pendingCloudDamage = 0;
        continue;
      }
      player.pendingCloudDamage += CLOUD_EFFECTS[hazard.kind].dps * dt;
      const whole = Math.floor(player.pendingCloudDamage);
      if (whole <= 0) continue;
      player.pendingCloudDamage -= whole;
      this.applyDamage(hazard.ownerId, player.id, whole, cloudDamageSource(hazard.kind), position);
    }
  }
  stepProjectiles(dt) {
    if (this.projectiles.length === 0) return;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      const { hit, expired } = integrateProjectile(
        projectile,
        dt,
        [...this.staticColliders, ...this.crateColliders(), ...this.playerColliders(), ...this.interactionColliders()],
        (c) => c.tag.kind === "player" && c.tag.id === projectile.ownerId
      );
      if (projectile.weaponId === "rocket" && expired) {
        this.explodeRocket(projectile);
      } else if (hit) {
        if (projectile.weaponId === "arc" && hit.collider.tag.kind === "player") this.chainArc(projectile, hit.collider.tag.id);
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
          case "interactive":
            this.damageInteraction(hit.collider.tag.id, projectile.damage, projectile.ownerId);
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
  explodeRocket(projectile) {
    const center = { x: projectile.position.x - projectile.direction.x * 0.04, y: Math.max(0.04, projectile.position.y - projectile.direction.y * 0.04), z: projectile.position.z - projectile.direction.z * 0.04 };
    this.transport.broadcast(GAME_EVENTS.WORLD.BLAST, { id: `rocket-${projectile.id}`, position: center });
    const blockers = [...this.staticColliders, ...this.crateColliders(), ...this.interactionColliders()];
    const damageAt = (p) => rocketBlastDamage(Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z));
    for (const player of this.players.values()) {
      if (!player.position || player.status !== "alive") continue;
      const damage = damageAt(player.position);
      if (damage > 0 && !sweepProjectile(center, player.position, blockers)) this.applyDamage(projectile.ownerId, player.id, damage, "rocket", center);
    }
    for (const crate of this.crates.values()) {
      const damage = damageAt(aabbCenter(crateBox(crate.spec)));
      if (damage > 0) this.damageCrate(crate.spec.id, damage);
    }
    for (const prop of this.interactions.specs.values()) this.damageInteraction(prop.id, damageAt({ ...prop.position, y: prop.position.y + 0.5 }), projectile.ownerId);
  }
  chainArc(projectile, firstId) {
    const first = this.players.get(firstId);
    if (!first?.position) return;
    const points = [{ ...projectile.position }, { ...first.position }];
    const visited = /* @__PURE__ */ new Set([firstId, projectile.ownerId]);
    let from = first.position;
    const blockers = [...this.staticColliders, ...this.crateColliders(), ...this.interactionColliders()];
    for (const damage of [20, 12]) {
      const candidates = [...this.players.values()].filter((p) => p.status === "alive" && p.position && !visited.has(p.id)).map((p) => ({ p, d: Math.hypot(p.position.x - from.x, p.position.y - from.y, p.position.z - from.z) })).filter((v) => v.d <= 4).sort((a, b) => a.d - b.d);
      const target = candidates.find(({ p }) => !sweepProjectile(from, p.position, blockers))?.p;
      if (!target?.position) break;
      visited.add(target.id);
      this.applyDamage(projectile.ownerId, target.id, damage, "arc", target.position);
      from = target.position;
      points.push({ ...from });
    }
    this.transport.broadcast(GAME_EVENTS.WORLD.ARC, { points });
  }
  /** Apply damage to a crate; destroy it and maybe drop a pickup at zero HP. */
  damageCrate(crateId, damage) {
    const crate = this.crates.get(crateId);
    if (!crate) return;
    if (!combatAllowed(this.match.phase)) return;
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
    if (!combatAllowed(this.match.phase)) return;
    this.pickupSpawnIn -= dt;
    if (this.pickupSpawnIn > 0) return;
    this.pickupSpawnIn = this.rollPickupSpawnDelay();
    if (this.pickups.size >= PICKUP_MAX_COUNT) return;
    const blockers = [
      ...this.staticColliders.map((c) => c.box),
      ...this.interactionColliders().map((c) => c.box),
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
    if (!combatAllowed(this.match.phase)) return;
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
    const killerPlayer = this.players.get(shooterId);
    const killer = this.leaderBoard[shooterId];
    const teamKill = killerPlayer !== void 0 && killerPlayer.team === target.team;
    if (killer && killerPlayer && shooterId !== targetId) {
      const delta = teamKill ? -1 : 1;
      killer.kills += delta;
      killer.score += delta * KILL_SCORE;
      this.teamScores[killerPlayer.team] += delta;
    }
    const victim = this.leaderBoard[targetId];
    if (victim) victim.deaths += 1;
    this.transport.broadcast(GAME_EVENTS.COMBAT.KILL, {
      killerId: shooterId,
      victimId: targetId,
      source,
      teamKill: teamKill && shooterId !== targetId,
      teamScores: { ...this.teamScores }
    });
  }
  interactionColliders() {
    return this.interactions.snapshot().flatMap((s) => {
      const p = this.interactions.specs.get(s.id);
      return p.type === "fence-gate" ? [] : interactionBoxes(p, s).map((box) => ({ box, tag: { kind: "interactive", id: s.id } }));
    });
  }
  /** The barrel is marked destroyed before cascading, so a chain detonates each only once. */
  damageInteraction(id, damage, ownerId) {
    if (!combatAllowed(this.match.phase)) return;
    const queue = [];
    if (this.interactions.damage(id, damage)) queue.push(id);
    for (let i = 0; i < queue.length; i++) {
      const p = this.interactions.specs.get(queue[i]);
      const center = { ...p.position, y: p.position.y + 0.5 };
      const falloff = (position) => Math.max(0, Math.round(80 * (1 - Math.hypot(position.x - center.x, position.y - center.y, position.z - center.z) / 4)));
      this.transport.broadcast(GAME_EVENTS.WORLD.BLAST, { id: p.id, position: center });
      for (const player of this.players.values()) if (player.position) {
        const amount = falloff(player.position);
        if (amount > 0) this.applyDamage(ownerId, player.id, amount, "barrel", center);
      }
      for (const crate of this.crates.values()) {
        const amount = falloff(aabbCenter(crateBox(crate.spec)));
        if (amount > 0) this.damageCrate(crate.spec.id, amount);
      }
      for (const other of this.interactions.specs.values()) {
        if (this.interactions.damage(other.id, falloff({ ...other.position, y: other.position.y + 0.5 }))) queue.push(other.id);
      }
    }
  }
  crateColliders() {
    return [...this.crates.values()].map(({ spec }) => ({
      box: crateBox(spec),
      tag: { kind: "crate", id: spec.id }
    }));
  }
  snapshotGrenades() {
    return [...this.grenades.values()].map(({ id, kind, ownerId, position }) => ({
      id,
      kind,
      ownerId,
      position
    }));
  }
  snapshotClouds() {
    return [...this.clouds.values()].map(({ id, kind, position, remaining }) => ({
      id,
      kind,
      position,
      remaining
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
      ({ id, userId, name, team, status, hp, position, rotation, positionAt, pose }) => ({
        pose,
        id,
        userId,
        name,
        team,
        status,
        hp,
        position,
        rotation,
        positionAt
      })
    );
  }
}
function cloudDamageSource(kind) {
  switch (kind) {
    case "gas":
      return "gas";
    case "fire":
      return "fire";
    case "smoke":
      throw new Error("smoke does no damage");
    default: {
      const unhandled = kind;
      throw new Error(`Unhandled cloud kind: ${String(unhandled)}`);
    }
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
    socket.on(GAME_EVENTS.WORLD.INTERACT, (p) => room.applyIntent(socket.id, GAME_EVENTS.WORLD.INTERACT, p));
    socket.on(
      GAME_EVENTS.USER.JOINED,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.USER.JOINED, p)
    );
    socket.on(
      GAME_EVENTS.CHAT.MESSAGE,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.CHAT.MESSAGE, p)
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
  res.json(room.leaderboardResponse());
});
