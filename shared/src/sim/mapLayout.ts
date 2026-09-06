import type { Vec3 } from "../types";
import {
  type AABB,
  aabbFromBaseSize,
  aabbFromCenterSize,
  aabbFromRotatedBox,
} from "./aabb";
import type { Collider } from "./projectile";
import { Rng } from "./rng";
import { scale, vec3 } from "./vec3";
import { propBoxes, isMovementOnlyProp, isDynamicProp, type PropSpec, type PropType } from "./props";
import { SPAWN_POINTS, type SpawnPoint } from "./spawnPoints";

/**
 * The map, generated deterministically from a seed so the server and every
 * client agree on where every prop is. Clients render these specs; both ends
 * turn them into colliders through `solidColliders` / `movementOnlyColliders`.
 */

export const MAP_SEED = 20240913;
export const GROUND_SIZE = 76;
export const WALL_HEIGHT = 2.5;
export const WALL_THICKNESS = 0.5;

export const CAR_SIZE: Vec3 = vec3(2.4, 1.8, 5.0);
export const STREET_LIGHT_SIZE: Vec3 = vec3(0.4, 6.3, 0.4);
export const SHOP_SIZE: Vec3 = vec3(10, 4, 8);
export const WAREHOUSE_SIZE: Vec3 = vec3(14, 5.5, 10);
export const TENEMENT_SIZE: Vec3 = vec3(7, 7.5, 8);
export const CRATE_MAX_HP = 100;
/** Trunk of a scale-1 tree; the canopy is decoration. */
export const TREE_TRUNK_SIZE: Vec3 = vec3(0.6, 1.5, 0.6);
/** Footprint of a bush (movement-only). */
export const BUSH_SIZE: Vec3 = vec3(1.4, 1.0, 1.4);
/** Footprint of a traffic cone (movement-only). */
export const CONE_SIZE: Vec3 = vec3(0.5, 0.8, 0.5);

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
  scale: number;
  /** Small roll for the crashed car. */
  tiltZ: number;
}

export interface ConeSpec {
  scale: number;
  position: Vec3;
  rotation: number;
}

export interface TreeSpec {
  id: string;
  position: Vec3;
  rotation: number;
  scale: number;
}

export interface BushSpec {
  id: string;
  position: Vec3;
  rotation: number;
  scale: number;
}

export interface WallSpec {
  id: string;
  box: AABB;
}

export interface StreetLightSpec {
  rotation: number;
  id: string;
  position: Vec3;
  scale: number;
}

export type BuildingType = "warehouse" | "tenement";

export interface BuildingSpec {
  id: string;
  type: BuildingType;
  /** Ground-based origin, matching the Blender models. */
  position: Vec3;
  rotation: number;
  scale: number;
}

export interface MapLayout {
  seed: number;
  walls: WallSpec[];
  shop: { id: string; position: Vec3; size: Vec3 };
  buildings: BuildingSpec[];
  cars: CarSpec[];
  streetLights: StreetLightSpec[];
  crates: CrateSpec[];
  cones: (ConeSpec & { id: string })[];
  trees: TreeSpec[];
  bushes: BushSpec[];
  /** Where players (re)spawn; each point belongs to one team. */
  spawnPoints: SpawnPoint[];
  props: PropSpec[];
}

const PI = Math.PI;

/**
 * A two-sided arena for five against five. Reading from the south wall
 * (negative Z) towards the centre, each team gets:
 *
 * - a **spawn street** along its wall (z < -28): five spawn points, lamps and
 *   litter, no cover to fight over;
 * - a **cover line** (z ≈ -27): a parked car, two crate bunkers and two crate
 *   walls that break every sightline from mid into the street, each with a
 *   spawn point tucked behind it. The gaps between them are the exits;
 * - a **yard** (-27 < z < -12): the approach, with a crate wall, a forklift and
 *   barrels to leapfrog between, fenced off from the flanks by chain-link that
 *   bullets cross but players do not;
 * - **mid** (|z| < 12): the shop in the centre splits it into an east and a
 *   west lane, each with a crate pyramid at one end and low cover at the
 *   other. Forklifts wedged in the fence gaps make the gates to the flanks;
 * - two **flanks** (|x| > 19) running the full length of the map along the
 *   walls: a wreck, a crate tower and trees for cover, the long way round mid.
 *
 * Everything is authored once for the south team and rotated 180° about the
 * centre for the north team, so both sides play the same map.
 */
export function generateMap(seed: number = MAP_SEED): MapLayout {
  const arena = new ArenaBuilder(new Rng(seed));
  layoutSpawnStreet(arena);
  layoutCoverLine(arena);
  layoutYard(arena);
  layoutMid(arena);
  layoutFlanks(arena);
  arena.prop('tire-stack','tires-yard',10.5,-16,0);
  arena.prop('cover-panel','cover-yard',-11,-13,0.2);
  arena.prop('fire-barrel','fire-flank',23,-13,0);
  arena.prop('explosive-barrel','fuel-yard',6.1,-13.4,0);
  arena.prop('explosive-barrel','fuel-mid',6,-6,0.3);
  arena.prop('smoke-zone','smoke-flank',-16,-8,0);
  arena.prop('alarm-zone','alarm-yard',17,-11,0);
  arena.prop('warning-light','beacon-yard',-17,-11,0);


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
      team: point.team,
    })),
  };
}

/**
 * The north team's copy of a south-side position: rotated 180° about the
 * centre. `|| 0` keeps positions on the axes at 0 rather than -0, which JSON
 * would not round-trip.
 */
const mirrored = (p: Vec3): Vec3 => vec3(-p.x || 0, p.y, -p.z || 0);

/**
 * Collects placements for the south side and adds the north side's rotated
 * copy of each. Ids stay unique and stable: numbered kinds count up across
 * both copies, named props get a `-s` / `-n` suffix. The rng only jitters
 * decoration (cone, tree and bush rotations); cover is placed by hand.
 */
class ArenaBuilder {
  readonly buildings: BuildingSpec[] = [];
  readonly cars: CarSpec[] = [];
  readonly streetLights: StreetLightSpec[] = [];
  readonly crates: CrateSpec[] = [];
  readonly cones: (ConeSpec & { id: string })[] = [];
  readonly trees: TreeSpec[] = [];
  readonly bushes: BushSpec[] = [];
  readonly props: PropSpec[] = [];

  constructor(private readonly rng: Rng) {}

  building(type: BuildingType, id: string, x: number, z: number, rotation = 0): void {
    this.both(vec3(x, 0, z), (position, turn, side) =>
      this.buildings.push({
        id: `${id}-${side}`,
        type,
        position,
        rotation: rotation + turn,
        scale: 1,
      })
    );
  }

  /** Run `place` for the south-side position and again for its north-side mirror. */
  private both(
    position: Vec3,
    place: (position: Vec3, turn: number, side: "s" | "n") => void
  ): void {
    place(position, 0, "s");
    place(mirrored(position), PI, "n");
  }

  car(x: number, z: number, rotation: number, tiltZ = 0): void {
    this.both(vec3(x, 0, z), (position, turn) =>
      this.cars.push({
        id: `car-${this.cars.length}`,
        position,
        rotation: rotation + turn,
        scale: 1,
        tiltZ,
      })
    );
  }

  light(x: number, z: number): void {
    this.both(vec3(x, 0, z), (position, turn) =>
      this.streetLights.push({
        id: `light-${this.streetLights.length}`,
        position,
        rotation: turn,
        scale: 1,
      })
    );
  }

  /** A crate of `size` resting on `level` crates of the same size. */
  crate(x: number, z: number, size: number, rotation: number, level = 0): void {
    this.both(vec3(x, size * (level + 0.5), z), (position, turn) =>
      this.crates.push({
        id: `crate-${this.crates.length}`,
        position,
        size,
        rotation: rotation + turn,
      })
    );
  }

  /** Four crates in a square with one on top: hard cover you cannot see over. */
  bunker(x: number, z: number): void {
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
  pyramid(x: number, z: number, size = 1): void {
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
  crateWall(x: number, z: number, count: number): void {
    const spacing = 1.25;
    const start = x - ((count - 1) * spacing) / 2;
    for (let i = 0; i < count; i++) {
      this.crate(start + i * spacing, z, 1, i % 2 === 0 ? PI / 12 : -PI / 12);
    }
    for (let i = 0; i < count - 1; i++) {
      this.crate(start + (i + 0.5) * spacing, z, 1, i % 2 === 0 ? -PI / 14 : PI / 14, 1);
    }
  }

  /** Oversized crates stacked three high: the flank landmark. */
  tower(x: number, z: number): void {
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

  cone(x: number, z: number): void {
    const rotation = this.rng.next() * PI * 2;
    this.both(vec3(x, 0, z), (position, turn) =>
      this.cones.push({
        id: `cone-${this.cones.length}`,
        position,
        scale: 1,
        rotation: rotation + turn,
      })
    );
  }

  tree(x: number, z: number, scale: number): void {
    const rotation = this.rng.next() * PI * 2;
    this.both(vec3(x, 0, z), (position, turn) =>
      this.trees.push({
        id: `tree-${this.trees.length}`,
        position,
        rotation: rotation + turn,
        scale,
      })
    );
  }

  bush(x: number, z: number): void {
    const rotation = this.rng.next() * PI * 2;
    this.both(vec3(x, 0, z), (position, turn) =>
      this.bushes.push({
        id: `bush-${this.bushes.length}`,
        position,
        rotation: rotation + turn,
        scale: 1,
      })
    );
  }

  prop(type: PropType, id: string, x: number, z: number, rotation = 0): void {
    this.both(vec3(x, 0, z), (position, turn, side) =>
      this.props.push({
        id: `${id}-${side}`,
        type,
        position,
        rotation: rotation + turn,
        scale: 1,
      })
    );
  }
}

/** Each team's safe strip along its wall: lamps and litter, nothing to hide behind. */
function layoutSpawnStreet(arena: ArenaBuilder): void {
  arena.light(-22, -35);
  arena.light(17, -30);
  arena.prop("trash-bag", "bag-street-0", -4, -37.2, 0.5);
  arena.prop("trash-bag", "bag-street-1", -3.0, -37.2, -1.1);
  arena.prop("trash-bag", "bag-street-2", 10.6, -37.2, 2.2);
  arena.tree(-31.5, -36.2, 0.9);
  arena.bush(-33.2, -35.6);
  arena.bush(-29.8, -36.5);
}

/**
 * Shields the spawn street from mid. A car is parked across the middle exit,
 * crate bunkers and walls cover the sides; the gaps between them are the exits
 * into the yard, and a wreck at the flank entrance covers the long way round.
 */
function layoutCoverLine(arena: ArenaBuilder): void {
  arena.car(0, -26, PI / 2);
  arena.bunker(-11, -27);
  arena.bunker(11, -27);
  arena.crateWall(-15.3, -27, 2);
  arena.crateWall(15.3, -27, 2);
}

/**
 * The approach to mid. Chain-link at x = ±19 fences the yard off from the
 * flanks (bullets cross it, players do not); the crate wall on the west and
 * the forklift on the east are the hard cover to push up behind.
 */
function layoutYard(arena: ArenaBuilder): void {
  for (const side of ["west", "east"] as const) {
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

/**
 * The shop at the centre splits mid into a west and an east lane. Each lane
 * has a pyramid at one end and low cover at the other (the mirror puts the
 * pyramid on the far side), a loading dock hugs the shop, and a forklift in
 * each fence gap is the gate to the flank.
 */
function layoutMid(arena: ArenaBuilder): void {
  arena.pyramid(-11, -7);
  arena.crate(8, -8, 1.2, 0.3);
  arena.crate(9.2, -7.2, 1, -0.2);
  arena.prop("oil-barrel", "barrel-mid", 7, -6.9, 0.6);

  arena.crateWall(-2.5, -5.3, 2);
  arena.prop("oil-barrel", "barrel-dock-0", 1.4, -5.0, 0.3);
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

/**
 * The outer lanes along the walls, the long way round mid. Trees line the
 * walls; a low crate cluster on the west and a tower plus crate wall on the
 * east give a flanker somewhere to stop.
 */
function layoutFlanks(arena: ArenaBuilder): void {
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

function generateWalls(): WallSpec[] {
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
      ),
    },
    {
      id: "wall-south",
      box: aabbFromBaseSize(
        vec3(0, 0, -half - t / 2),
        vec3(GROUND_SIZE + t, h, t)
      ),
    },
    // East (+X) and West (-X)
    {
      id: "wall-east",
      box: aabbFromBaseSize(
        vec3(half + t / 2, 0, 0),
        vec3(t, h, GROUND_SIZE + t * 2)
      ),
    },
    {
      id: "wall-west",
      box: aabbFromBaseSize(
        vec3(-half - t / 2, 0, 0),
        vec3(t, h, GROUND_SIZE + t * 2)
      ),
    },
  ];
}

/** World AABB of a crate (axis aligned, matching the client's collider). */
export const crateBox = (crate: CrateSpec): AABB =>
  aabbFromCenterSize(crate.position, vec3(crate.size, crate.size, crate.size));

/** World AABB enclosing a rotated car. */
export const carBox = (car: CarSpec): AABB =>
  aabbFromRotatedBox(
    vec3(car.position.x, car.position.y + CAR_SIZE.y / 2, car.position.z),
    scale(CAR_SIZE, car.scale),
    car.rotation
  );

export const streetLightBox = (base: Vec3, multiplier = 1): AABB =>
  aabbFromBaseSize(base, scale(STREET_LIGHT_SIZE, multiplier));

export const shopBox = (map: MapLayout): AABB =>
  aabbFromBaseSize(map.shop.position, map.shop.size);

const buildingSize = (type: BuildingType): Vec3 =>
  type === "warehouse" ? WAREHOUSE_SIZE : TENEMENT_SIZE;

export const buildingBox = (building: BuildingSpec): AABB => {
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

export const treeTrunkBox = (tree: TreeSpec): AABB =>
  aabbFromBaseSize(tree.position, scale(TREE_TRUNK_SIZE, tree.scale));

export const bushBox = (bush: BushSpec): AABB =>
  aabbFromBaseSize(bush.position, scale(BUSH_SIZE, bush.scale));

export const coneBox = (cone: ConeSpec): AABB =>
  aabbFromBaseSize(cone.position, scale(CONE_SIZE, cone.scale));

/** Tag on a piece of solid geometry; ids are stable per map. */
export interface StaticTag {
  kind: "static";
  id: string;
}

/**
 * The static world both ends must agree on for bullets and grenades: walls,
 * shop, cars, street lights, tree trunks. Crates are solid too but live
 * (HP, destruction), so callers add `crateBox` for the survivors themselves.
 */
export function solidColliders(map: MapLayout): Collider<StaticTag>[] {
  const colliders: Collider<StaticTag>[] = [];
  map.walls.forEach((wall) =>
    colliders.push({
      box: wall.box,
      tag: { kind: "static", id: wall.id },
    })
  );
  colliders.push({
    box: shopBox(map),
    tag: { kind: "static", id: map.shop.id },
  });
  for (const building of map.buildings) {
    colliders.push({
      box: buildingBox(building),
      tag: { kind: "static", id: building.id },
    });
  }
  for (const car of map.cars) {
    colliders.push({ box: carBox(car), tag: { kind: "static", id: car.id } });
  }
  map.streetLights.forEach((light) =>
    colliders.push({
      box: streetLightBox(light.position, light.scale),
      tag: { kind: "static", id: light.id },
    })
  );
  map.trees.forEach((tree) =>
    colliders.push({
      box: treeTrunkBox(tree),
      tag: { kind: "static", id: tree.id },
    })
  );
  for (const prop of map.props) {
    if (isMovementOnlyProp(prop.type) || isDynamicProp(prop.type)) continue;
    propBoxes(prop).forEach((box, index) => colliders.push({
      box, tag: { kind: "static", id: `${prop.id}:${index}` },
    }));
  }
  return colliders;
}

/**
 * Geometry that blocks a player's movement but lets bullets pass: bushes and
 * traffic cones. Movement is client-owned, so only clients consult these.
 */
export function movementOnlyColliders(
  map: MapLayout
): { id: string; box: AABB }[] {
  return [
    ...map.props.filter((prop) => isMovementOnlyProp(prop.type) && !isDynamicProp(prop.type)).flatMap((prop) =>
      propBoxes(prop).map((box, index) => ({ id: `${prop.id}:${index}`, box }))),
    ...map.bushes.map((bush) => ({ id: bush.id, box: bushBox(bush) })),
    ...map.cones.map((cone) => ({ id: cone.id, box: coneBox(cone) })),
  ];
}
