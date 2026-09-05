import type { Vec3 } from "../types";
import {
  type AABB,
  aabbFromCenterSize,
  aabbIntersects,
} from "./aabb";
import {
  type BushSpec,
  type BuildingSpec,
  type BuildingType,
  type CarSpec,
  type ConeSpec,
  type CrateSpec,
  type MapLayout,
  type StreetLightSpec,
  type TreeSpec,
  type WallSpec,
  GROUND_SIZE,
  MAP_SEED,
  carBox,
  crateBox,
  generateMap,
  shopBox,
  solidColliders,
  treeTrunkBox,
  movementOnlyColliders,
  BUSH_SIZE,
  CONE_SIZE,
  SHOP_SIZE,
  CAR_SIZE,
  STREET_LIGHT_SIZE,
  TREE_TRUNK_SIZE,
} from "./mapLayout";
import { PROP_TYPES, type PropSpec } from "./props";
import { PLAYER_SIZE, SPAWN_POINTS } from "./spawnPoints";

export const LEVEL_SCHEMA_VERSION = 1 as const;

export const LEVEL_OBJECT_TYPES = [
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
  ...PROP_TYPES,
] as const;

export type LevelObjectType = (typeof LEVEL_OBJECT_TYPES)[number];

export interface LevelTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface LevelObject {
  id: string;
  type: LevelObjectType;
  transform: LevelTransform;
}

export interface LevelSpawnPoint {
  id: string;
  position: Vec3;
}

export interface LevelDocument {
  schemaVersion: typeof LEVEL_SCHEMA_VERSION;
  id: string;
  name: string;
  seed: number;
  groundSize: number;
  objects: LevelObject[];
  spawnPoints: LevelSpawnPoint[];
}

export interface LevelDiagnostic {
  path: string;
  message: string;
  severity: "error" | "warning";
}

const LEVEL_OBJECT_TYPE_SET = new Set<string>(LEVEL_OBJECT_TYPES);

const zeroRotation = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const unitScale = (): Vec3 => ({ x: 1, y: 1, z: 1 });
const copyVec3 = (value: Vec3): Vec3 => ({
  x: value.x,
  y: value.y,
  z: value.z,
});

const transform = (
  position: Vec3,
  rotation: Vec3 = zeroRotation(),
  scale: Vec3 = unitScale()
): LevelTransform => ({
  position: copyVec3(position),
  rotation: copyVec3(rotation),
  scale: copyVec3(scale),
});

const levelObject = (
  id: string,
  type: LevelObjectType,
  objectTransform: LevelTransform
): LevelObject => ({
  id,
  type,
  transform: objectTransform,
});

function centerOf(box: AABB): Vec3 {
  return {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
}

function sizeOf(box: AABB): Vec3 {
  return {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
  };
}

function objectFromBuilding(building: BuildingSpec): LevelObject {
  return levelObject(
    building.id,
    building.type,
    transform(
      building.position,
      { x: 0, y: building.rotation, z: 0 },
      { x: building.scale, y: building.scale, z: building.scale }
    )
  );
}

function objectFromCar(car: CarSpec): LevelObject {
  return levelObject(
    car.id,
    "car",
    transform(
      car.position,
      { x: 0, y: car.rotation, z: car.tiltZ },
      { x: car.scale, y: car.scale, z: car.scale }
    )
  );
}

function objectFromCrate(crate: CrateSpec): LevelObject {
  return levelObject(
    crate.id,
    "crate",
    transform(
      crate.position,
      { x: 0, y: crate.rotation, z: 0 },
      { x: crate.size, y: crate.size, z: crate.size }
    )
  );
}

function objectFromStreetLight(light: StreetLightSpec): LevelObject {
  return levelObject(
    light.id,
    "street-light",
    transform(
      light.position,
      { x: 0, y: light.rotation, z: 0 },
      { x: light.scale, y: light.scale, z: light.scale }
    )
  );
}

function objectFromTree(tree: TreeSpec): LevelObject {
  return levelObject(
    tree.id,
    "tree",
    transform(
      tree.position,
      { x: 0, y: tree.rotation, z: 0 },
      { x: tree.scale, y: tree.scale, z: tree.scale }
    )
  );
}

export function levelFromMap(
  map: MapLayout,
  id = "default",
  name = "Default level"
): LevelDocument {
  const objects: LevelObject[] = [
    ...map.props.map((prop) => levelObject(prop.id, prop.type, transform(
      prop.position, { x: 0, y: prop.rotation, z: 0 },
      { x: prop.scale, y: prop.scale, z: prop.scale }
    ))),
    ...map.walls.map((wall) =>
      levelObject(wall.id, "wall", transform(centerOf(wall.box), zeroRotation(), sizeOf(wall.box)))
    ),
    levelObject(map.shop.id, "shop", transform(map.shop.position)),
    ...map.buildings.map(objectFromBuilding),
    ...map.cars.map(objectFromCar),
    ...map.streetLights.map(objectFromStreetLight),
    ...map.crates.map(objectFromCrate),
    ...map.cones.map((cone) =>
      levelObject(
        cone.id,
        "traffic-cone",
        transform(
          cone.position,
          { x: 0, y: cone.rotation, z: 0 },
          { x: cone.scale, y: cone.scale, z: cone.scale }
        )
      )
    ),
    ...map.trees.map(objectFromTree),
    ...map.bushes.map((bush) =>
      levelObject(
        bush.id,
        "bush",
        transform(
          bush.position,
          { x: 0, y: bush.rotation, z: 0 },
          { x: bush.scale, y: bush.scale, z: bush.scale }
        )
      )
    ),
  ];

  return {
    schemaVersion: LEVEL_SCHEMA_VERSION,
    id,
    name,
    seed: map.seed,
    groundSize: GROUND_SIZE,
    objects,
    spawnPoints: map.spawnPoints.map((position, index) => ({
      id: `spawn-${index}`,
      position: copyVec3(position),
    })),
  };
}

export function defaultLevel(): LevelDocument {
  return levelFromMap(generateMap());
}

function asVec3(objectTransform: LevelTransform): Vec3 {
  return copyVec3(objectTransform.position);
}

function uniformScale(objectTransform: LevelTransform, path: string): number {
  const { x, y, z } = objectTransform.scale;
  if (Math.abs(x - y) > 0.0001 || Math.abs(x - z) > 0.0001) {
    throw new Error(`${path}.scale must be uniform`);
  }
  return x;
}

export function mapFromLevel(level: LevelDocument): MapLayout {
  const walls: WallSpec[] = [];
  let shop: MapLayout["shop"] | undefined;
  const buildings: BuildingSpec[] = [];
  const cars: CarSpec[] = [];
  const streetLights: StreetLightSpec[] = [];
  const crates: CrateSpec[] = [];
  const cones: (ConeSpec & { id: string })[] = [];
  const trees: TreeSpec[] = [];
  const bushes: BushSpec[] = [];
  const props: PropSpec[] = [];

  for (const object of level.objects) {
    const objectTransform = object.transform;
    const position = asVec3(objectTransform);
    switch (object.type) {
      case "fence":
      case "fence-gate":
      case "trash-bag":
      case "oil-barrel":
      case "forklift":
        props.push({ id: object.id, type: object.type, position,
          rotation: objectTransform.rotation.y,
          scale: uniformScale(objectTransform, `objects.${object.id}.transform`) });
        break;
      case "wall":
        walls.push({
          id: object.id,
          box: aabbFromCenterSize(position, copyVec3(objectTransform.scale)),
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
            z: SHOP_SIZE.z * objectTransform.scale.z,
          },
        };
        break;
      case "warehouse":
      case "tenement":
        buildings.push({
          id: object.id,
          type: object.type as BuildingType,
          position,
          rotation: objectTransform.rotation.y,
          scale: uniformScale(
            objectTransform,
            `objects.${object.id}.transform`
          ),
        });
        break;
      case "car":
        cars.push({
          id: object.id,
          position,
          rotation: objectTransform.rotation.y,
          scale: uniformScale(objectTransform, `objects.${object.id}.transform`),
          tiltZ: objectTransform.rotation.z,
        });
        break;
      case "street-light":
        streetLights.push({
          rotation: objectTransform.rotation.y,
          id: object.id,
          position,
          scale: uniformScale(objectTransform, `objects.${object.id}.transform`),
        });
        break;
      case "crate":
        crates.push({
          id: object.id,
          position,
          size: uniformScale(objectTransform, `objects.${object.id}.transform`),
          rotation: objectTransform.rotation.y,
        });
        break;
      case "traffic-cone":
        cones.push({
          id: object.id,
          position,
          scale: uniformScale(objectTransform, `objects.${object.id}.transform`),
          rotation: objectTransform.rotation.y,
        });
        break;
      case "tree":
        trees.push({
          id: object.id,
          position,
          rotation: objectTransform.rotation.y,
          scale: uniformScale(objectTransform, `objects.${object.id}.transform`),
        });
        break;
      case "bush":
        bushes.push({
          id: object.id,
          position,
          rotation: objectTransform.rotation.y,
          scale: uniformScale(objectTransform, `objects.${object.id}.transform`),
        });
        break;
      default: {
        const unhandled: never = object.type;
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
    spawnPoints: level.spawnPoints.map((spawn) => copyVec3(spawn.position)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateVec3(
  value: unknown,
  path: string,
  diagnostics: LevelDiagnostic[]
): value is Vec3 {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.z)
  ) {
    diagnostics.push({
      path,
      message: "Expected a vector with finite x, y, and z values",
      severity: "error",
    });
    return false;
  }
  return true;
}

export function validateLevel(
  value: unknown
): LevelDiagnostic[] {
  const diagnostics: LevelDiagnostic[] = [];
  if (!isRecord(value)) {
    return [{ path: "", message: "Expected a level object", severity: "error" }];
  }

  if (value.schemaVersion !== LEVEL_SCHEMA_VERSION) {
    diagnostics.push({
      path: "schemaVersion",
      message: `Expected schema version ${LEVEL_SCHEMA_VERSION}`,
      severity: "error",
    });
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    diagnostics.push({
      path: "id",
      message: "Level ID must be a non-empty string",
      severity: "error",
    });
  }
  if (typeof value.name !== "string" || value.name.trim() === "") {
    diagnostics.push({
      path: "name",
      message: "Level name must be a non-empty string",
      severity: "error",
    });
  }
  if (!isFiniteNumber(value.seed)) {
    diagnostics.push({
      path: "seed",
      message: "Seed must be a finite number",
      severity: "error",
    });
  }
  if (!isFiniteNumber(value.groundSize) || value.groundSize <= 0) {
    diagnostics.push({
      path: "groundSize",
      message: "Ground size must be a positive number",
      severity: "error",
    });
  }

  const objects = Array.isArray(value.objects) ? value.objects : [];
  if (!Array.isArray(value.objects)) {
    diagnostics.push({
      path: "objects",
      message: "Objects must be an array",
      severity: "error",
    });
  }

  const ids = new Set<string>();
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
    if (
      !isRecord(objectTransform) ||
      !validateVec3(objectTransform.position, `${path}.transform.position`, diagnostics) ||
      !validateVec3(objectTransform.rotation, `${path}.transform.rotation`, diagnostics) ||
      !validateVec3(objectTransform.scale, `${path}.transform.scale`, diagnostics)
    ) {
      return;
    }

    if ((type === "trash-bag" || type === "oil-barrel" || type === "forklift" || type === "fence" || type === "fence-gate") &&
      (Math.abs(objectTransform.rotation.x) > .0001 || Math.abs(objectTransform.rotation.z) > .0001)) {
      diagnostics.push({ path: `${path}.transform.rotation`,
        message: `${type} supports rotation around the Y axis only`, severity: "error" });
    }
    if (
      (type === "warehouse" || type === "tenement") &&
      (Math.abs(objectTransform.rotation.x) > .0001 ||
        Math.abs(objectTransform.rotation.z) > .0001)
    ) {
      diagnostics.push({
        path: `${path}.transform.rotation`,
        message: `${type} supports rotation around the Y axis only`,
        severity: "error",
      });
    }
    const position = objectTransform.position;
    const scale = objectTransform.scale;
    if (scale.x <= 0 || scale.y <= 0 || scale.z <= 0) {
      diagnostics.push({
        path: `${path}.transform.scale`,
        message: "Scale values must be positive",
        severity: "error",
      });
    }
    if (
      isFiniteNumber(value.groundSize) &&
      (Math.abs(position.x) > value.groundSize || Math.abs(position.z) > value.groundSize)
    ) {
      diagnostics.push({
        path: `${path}.transform.position`,
        message: "Object is outside the playable world bounds",
        severity: "error",
      });
    }
    if (
      type === "car" ||
      type === "warehouse" ||
      type === "tenement" ||
      type === "street-light" ||
      type === "crate" ||
      type === "traffic-cone" ||
      type === "tree" ||
      type === "bush" ||
      type === "trash-bag" || type === "oil-barrel" || type === "forklift" || type === "fence" || type === "fence-gate"
    ) {
      if (Math.abs(scale.x - scale.y) > 0.0001 || Math.abs(scale.x - scale.z) > 0.0001) {
        diagnostics.push({
          path: `${path}.transform.scale`,
          message: `${type} scale must be uniform`,
          severity: "error",
        });
      }
    }
  });

  if (wallCount < 4) {
    diagnostics.push({
      path: "objects",
      message: "A playable level needs at least four boundary walls",
      severity: "error",
    });
  }
  if (shopCount !== 1) {
    diagnostics.push({
      path: "objects",
      message: "A playable level needs exactly one shop",
      severity: "error",
    });
  }

  const spawns = Array.isArray(value.spawnPoints) ? value.spawnPoints : [];
  if (!Array.isArray(value.spawnPoints)) {
    diagnostics.push({
      path: "spawnPoints",
      message: "Spawn points must be an array",
      severity: "error",
    });
  }
  if (spawns.length === 0) {
    diagnostics.push({
      path: "spawnPoints",
      message: "A playable level needs at least one spawn point",
      severity: "error",
    });
  }
  const spawnIds = new Set<string>();
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
    if (
      isFiniteNumber(value.groundSize) &&
      (Math.abs(spawn.position.x) > value.groundSize / 2 ||
        Math.abs(spawn.position.z) > value.groundSize / 2)
    ) {
      diagnostics.push({
        path: `${path}.position`,
        message: "Spawn point is outside the playable ground",
        severity: "error",
      });
    }
  });

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return diagnostics;

  try {
    const level = value as unknown as LevelDocument;
    const map = mapFromLevel(level);
    const colliders = [...solidColliders(map), ...movementOnlyColliders(map)];
    for (const spawn of level.spawnPoints) {
      const playerBox = aabbFromCenterSize(spawn.position, PLAYER_SIZE);
      if (colliders.some((collider) => aabbIntersects(playerBox, collider.box))) {
        diagnostics.push({
          path: `spawnPoints.${spawn.id}`,
          message: "Spawn point overlaps gameplay collision",
          severity: "error",
        });
      }
    }
  } catch (error) {
    diagnostics.push({
      path: "",
      message: error instanceof Error ? error.message : "Level could not be compiled",
      severity: "error",
    });
  }

  return diagnostics;
}

export function parseLevelDocument(input: unknown): LevelDocument {
  const diagnostics = validateLevel(input);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n"));
  }
  return input as LevelDocument;
}

export function serializeLevelDocument(level: LevelDocument): string {
  parseLevelDocument(level);
  return `${JSON.stringify(level, null, 2)}\n`;
}

export function cloneLevelDocument(level: LevelDocument): LevelDocument {
  return JSON.parse(serializeLevelDocument(level)) as LevelDocument;
}

export function levelObjectLabel(type: LevelObjectType): string {
  switch (type) {
    case "fence": return "Chain-link fence";
    case "fence-gate": return "Chain-link gate";
    case "trash-bag": return "Trash bag";
    case "oil-barrel": return "Oil barrel";
    case "forklift": return "Forklift";
    case "wall":
      return "Wall";
    case "shop":
      return "Shop";
    case "warehouse":
      return "Warehouse";
    case "tenement":
      return "Tenement / office";
    case "car":
      return "Car";
    case "street-light":
      return "Street light";
    case "crate":
      return "Crate";
    case "traffic-cone":
      return "Traffic cone";
    case "tree":
      return "Tree";
    case "bush":
      return "Bush";
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

export const LEVEL_DEFAULTS = {
  groundSize: GROUND_SIZE,
  seed: MAP_SEED,
  shopSize: SHOP_SIZE,
  carSize: CAR_SIZE,
  streetLightSize: STREET_LIGHT_SIZE,
  treeTrunkSize: TREE_TRUNK_SIZE,
  bushSize: BUSH_SIZE,
  coneSize: CONE_SIZE,
  defaultSpawnPoints: SPAWN_POINTS,
  carBox,
  crateBox,
  shopBox,
  treeTrunkBox,
};
