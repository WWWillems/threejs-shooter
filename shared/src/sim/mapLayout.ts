import type { Vec3 } from "../types";
import {
  type AABB,
  aabbFromBaseSize,
  aabbFromCenterSize,
  aabbFromRotatedBox,
} from "./aabb";
import { Rng } from "./rng";
import { vec3 } from "./vec3";

/**
 * The map, generated deterministically from a seed so the server and every
 * client agree on where every prop is. Clients render these specs; the server
 * turns the solid ones into colliders.
 */

export const MAP_SEED = 20240913;
export const GROUND_SIZE = 100;
export const WALL_HEIGHT = 2.5;
export const WALL_THICKNESS = 0.5;

export const CAR_SIZE: Vec3 = vec3(2.4, 1.8, 5.0);
export const STREET_LIGHT_SIZE: Vec3 = vec3(0.4, 6.3, 0.4);
export const SHOP_SIZE: Vec3 = vec3(10, 4, 8);
export const CRATE_MAX_HP = 100;

export interface CrateSpec {
  id: string;
  /** Centre of the crate. */
  position: Vec3;
  size: number;
  rotation: number;
}

export interface CarSpec {
  id: string;
  /** Base of the car on the ground. */
  position: Vec3;
  rotation: number;
  /** Small roll for the crashed car. */
  tiltZ: number;
}

export interface ConeSpec {
  position: Vec3;
  rotation: number;
}

export interface TreeSpec {
  position: Vec3;
  rotation: number;
  scale: number;
}

export interface BushSpec {
  position: Vec3;
  rotation: number;
}

export interface MapLayout {
  seed: number;
  walls: AABB[];
  shop: { position: Vec3; size: Vec3 };
  cars: CarSpec[];
  streetLights: Vec3[];
  crates: CrateSpec[];
  cones: ConeSpec[];
  trees: TreeSpec[];
  bushes: BushSpec[];
}

const PI = Math.PI;

export function generateMap(seed: number = MAP_SEED): MapLayout {
  const rng = new Rng(seed);

  const cars: CarSpec[] = [
    { id: "car-0", position: vec3(8, 0, 9), rotation: -PI / 5, tiltZ: PI / 30 },
    { id: "car-1", position: vec3(12, 0, 15), rotation: PI / 3, tiltZ: 0 },
    { id: "car-2", position: vec3(-15, 0, -12), rotation: PI / 8, tiltZ: 0 },
  ];

  const streetLights: Vec3[] = [
    vec3(10, 0, 12),
    vec3(-10, 0, -8),
    vec3(-5, 0, 15),
    vec3(15, 0, -15),
  ];

  const shop = { position: vec3(0, 0, -20), size: SHOP_SIZE };

  const crates = generateCrates(rng);
  const cones = generateCones(rng);

  // Solid props that trees and bushes must not be planted inside.
  const blockers: AABB[] = [
    aabbFromBaseSize(shop.position, shop.size),
    ...cars.map((c) => carBox(c)),
    ...crates.map((c) => crateBox(c)),
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
    bushes,
  };
}

function generateWalls(): AABB[] {
  const half = GROUND_SIZE / 2;
  const t = WALL_THICKNESS;
  const h = WALL_HEIGHT;
  return [
    // North (+Z) and South (-Z)
    aabbFromBaseSize(vec3(0, 0, half + t / 2), vec3(GROUND_SIZE + t, h, t)),
    aabbFromBaseSize(vec3(0, 0, -half - t / 2), vec3(GROUND_SIZE + t, h, t)),
    // East (+X) and West (-X)
    aabbFromBaseSize(vec3(half + t / 2, 0, 0), vec3(t, h, GROUND_SIZE + t * 2)),
    aabbFromBaseSize(vec3(-half - t / 2, 0, 0), vec3(t, h, GROUND_SIZE + t * 2)),
  ];
}

function generateCrates(rng: Rng): CrateSpec[] {
  const crates: CrateSpec[] = [];
  const push = (x: number, y: number, z: number, size: number, rotation: number) =>
    crates.push({
      id: `crate-${crates.length}`,
      position: vec3(x, y, z),
      size,
      rotation,
    });

  // Main pyramid formation
  const pb = vec3(5, 0, 5);
  push(pb.x - 1.1, 0.5, pb.z - 1.1, 1, 0);
  push(pb.x + 1.1, 0.5, pb.z - 1.1, 1, PI / 6);
  push(pb.x - 1.1, 0.5, pb.z + 1.1, 1, -PI / 8);
  push(pb.x + 1.1, 0.5, pb.z + 1.1, 1, PI / 3);
  push(pb.x, 1.5, pb.z - 0.5, 1, PI / 4);
  push(pb.x, 1.5, pb.z + 0.5, 1, -PI / 4);
  push(pb.x, 2.5, pb.z, 1, PI / 10);

  // Defensive wall
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

  // Semi-circle pattern
  const circleCenter = vec3(5, 0, -12);
  const circleRadius = 5;
  const circleCount = 8;
  for (let i = 0; i < circleCount; i++) {
    const angle = (i / circleCount) * PI;
    push(
      circleCenter.x + Math.cos(angle) * circleRadius,
      0.5,
      circleCenter.z + Math.sin(angle) * circleRadius,
      0.9 + rng.next() * 0.3,
      rng.next() * PI
    );
  }

  // Sniper tower
  const tb = vec3(-15, 0, 10);
  const ts = 1.2;
  push(tb.x - ts / 2, 0.6, tb.z - ts / 2, ts, 0);
  push(tb.x + ts / 2, 0.6, tb.z - ts / 2, ts, 0);
  push(tb.x - ts / 2, 0.6, tb.z + ts / 2, ts, 0);
  push(tb.x + ts / 2, 0.6, tb.z + ts / 2, ts, 0);
  push(tb.x - ts / 4, ts + 0.6, tb.z, ts, PI / 4);
  push(tb.x + ts / 4, ts + 0.6, tb.z, ts, -PI / 4);
  push(tb.x, ts * 2 + 0.6, tb.z, ts * 1.2, PI / 5);

  // Corner clusters
  const corners = [
    { position: vec3(18, 0, 18), size: { x: 3, z: 3 }, fillRate: 0.7 },
    { position: vec3(-18, 0, -18), size: { x: 4, z: 3 }, fillRate: 0.6 },
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

function generateCones(rng: Rng): ConeSpec[] {
  const cones: ConeSpec[] = [];

  // Line of cones
  const lineStart = vec3(10, 0, 11);
  for (let i = 0; i < 7; i++) {
    cones.push({ position: vec3(lineStart.x + i * 0.8, 0, lineStart.z), rotation: 0 });
  }

  // Curved line of cones
  const curveCenter = vec3(-5, 0, -8);
  const curveCount = 9;
  for (let i = 0; i < curveCount; i++) {
    const angle = (i / (curveCount - 1)) * PI;
    cones.push({
      position: vec3(
        curveCenter.x + Math.cos(angle) * 4,
        0,
        curveCenter.z + Math.sin(angle) * 4
      ),
      rotation: rng.next() * 0.5 - 0.25,
    });
  }

  // Scattered cones near the crash site (first car)
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
      rotation: rng.next() * PI * 2,
    });
  }

  // Tower base cones
  cones.push({ position: vec3(-16.5, 0, 8.5), rotation: 0 });
  cones.push({ position: vec3(-13.5, 0, 8.5), rotation: 0 });
  cones.push({ position: vec3(-15, 0, 8), rotation: 0 });

  // Shop entrance cones
  cones.push({ position: vec3(-3, 0, -15), rotation: 0 });
  cones.push({ position: vec3(3, 0, -15), rotation: 0 });
  cones.push({ position: vec3(-2, 0, -17), rotation: 0 });
  cones.push({ position: vec3(2, 0, -17), rotation: 0 });

  return cones;
}

function generateTrees(rng: Rng, blockers: AABB[]): TreeSpec[] {
  const trees: TreeSpec[] = [];

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
          scale: 0.8 + rng.next() * 0.4,
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
        scale: 0.9 + rng.next() * 0.3,
      });
    }
  }

  return trees;
}

function generateBushes(rng: Rng, blockers: AABB[]): BushSpec[] {
  const bushes: BushSpec[] = [];

  const clusters = [
    { position: vec3(-18, 0, -18), radius: 6, count: 8 },
    { position: vec3(12, 0, 12), radius: 2.5, count: 4 },
    { position: vec3(-10, 0, -10), radius: 2.5, count: 3 },
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
    vec3(3, 0, 8),
  ];
  for (const target of individuals) {
    const clear = findClearPosition(rng, target, 0.8, blockers);
    if (clear) {
      bushes.push({ position: clear, rotation: rng.next() * PI * 2 });
    }
  }

  return bushes;
}

/**
 * Return `target` if a prop of `radius` fits there without overlapping any
 * blocker (in the XZ plane), otherwise try a few nearby spots, otherwise null.
 */
function findClearPosition(
  rng: Rng,
  target: Vec3,
  radius: number,
  blockers: AABB[]
): Vec3 | null {
  const isClear = (p: Vec3) =>
    !blockers.some(
      (b) =>
        p.x + radius > b.min.x &&
        p.x - radius < b.max.x &&
        p.z + radius > b.min.z &&
        p.z - radius < b.max.z
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

/** World AABB of a crate (axis aligned, matching the client's collider). */
export const crateBox = (crate: CrateSpec): AABB =>
  aabbFromCenterSize(crate.position, vec3(crate.size, crate.size, crate.size));

/** World AABB enclosing a rotated car. */
export const carBox = (car: CarSpec): AABB =>
  aabbFromRotatedBox(
    vec3(car.position.x, car.position.y + CAR_SIZE.y / 2, car.position.z),
    CAR_SIZE,
    car.rotation
  );

export const streetLightBox = (base: Vec3): AABB =>
  aabbFromBaseSize(base, STREET_LIGHT_SIZE);

export const shopBox = (map: MapLayout): AABB =>
  aabbFromBaseSize(map.shop.position, map.shop.size);
