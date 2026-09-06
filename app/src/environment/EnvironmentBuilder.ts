import * as THREE from "three";
import type { MapLayout, Vec3, WallSpec } from "@threejs-shooter/shared";
import { Car } from "../components/Car";
import { StreetLight } from "../components/StreetLight";
import { WoodenCrate, type DestructibleCrate } from "../components/WoodenCrate";
import { ShopBuilding } from "../components/ShopBuilding";
import { TrafficCone } from "../components/TrafficCone";
import { Tree } from "../components/Tree";
import { addYardProp } from "../components/YardProp";
import { Bush } from "../components/Bush";
import { Building } from "../components/Building";
import { surface } from "../core/models";

const toVector3 = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z);

/** Which world axis a boundary wall runs along. */
type WallAxis = "x" | "z";

/** Matches the `fence` prop footprint in `shared/src/sim/props.ts`. */
const FENCE_PANEL_WIDTH = 4.18;
const FENCE_PANELS_PER_BAY = 2;
const FENCE_BAY_LENGTH = FENCE_PANEL_WIDTH * FENCE_PANELS_PER_BAY;
/** Roughly how long a solid brick/concrete bay should be between fence bays. */
const TARGET_BRICK_BAY_LENGTH = 11;

const PLINTH_HEIGHT = 0.18;
const CAP_HEIGHT = 0.22;
const CAP_OVERHANG = 0.12;
const PILLAR_WIDTH = 0.6;
const PILLAR_FOOTPRINT_EXTRA = 0.5;
const PILLAR_EXTRA_HEIGHT = 0.35;
const PILLAR_CAP_HEIGHT = 0.14;
const PILLAR_CAP_OVERHANG = 0.08;

interface WallBay {
  kind: "brick" | "fence";
  /** Length along the wall's run axis. */
  length: number;
}

/** Alternating brick/fence bays that fill `length` exactly, brick on both ends. */
function layoutBays(length: number): WallBay[] {
  const fenceBays = Math.max(
    1,
    Math.floor(length / (TARGET_BRICK_BAY_LENGTH + FENCE_BAY_LENGTH))
  );
  const brickBays = fenceBays + 1;
  const brickLength = (length - fenceBays * FENCE_BAY_LENGTH) / brickBays;
  const bays: WallBay[] = [];
  for (let i = 0; i < brickBays + fenceBays; i++) {
    bays.push(i % 2 === 0 ? { kind: "brick", length: brickLength } : { kind: "fence", length: FENCE_BAY_LENGTH });
  }
  return bays;
}

/**
 * Renders the shared, deterministic map. Every prop's position comes from the
 * `MapLayout`, so this client sees exactly the world the server simulates.
 * Meshes only: collision lives in `WorldColliders`, built from the same map.
 */
export class EnvironmentBuilder {
  /** Crate meshes by shared crate id, for `CrateSync` to damage and remove. */
  readonly propVisuals = new Map<string, THREE.Group>();
  private readonly crates = new Map<string, DestructibleCrate>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly map: MapLayout
  ) {}

  public getMap(): MapLayout {
    return this.map;
  }

  public getCrate(crateId: string): DestructibleCrate | undefined {
    return this.crates.get(crateId);
  }

  /**
   * Build all environment objects
   */
  public buildEnvironment(): void {
    this.placeCars();
    this.placeStreetLights();
    this.placeBuildings();
    this.placeShopBuilding();
    this.placeCrates();
    this.placeTrafficCones();
    this.placeTrees();
    this.placeBushes();
    this.addWalls();
    for (const prop of this.map.props) {
      const visual = addYardProp(this.scene, prop.type, toVector3(prop.position));
      this.propVisuals.set(prop.id, visual);
      visual.rotation.y = prop.rotation;
      visual.scale.setScalar(prop.scale);
    }
  }

  private placeCars(): void {
    for (const spec of this.map.cars) {
      const car = Car.addToScene(this.scene, toVector3(spec.position));
      car.rotation.y = spec.rotation;
      car.rotation.z = spec.tiltZ;
      car.scale.setScalar(spec.scale);
    }
  }

  private placeStreetLights(): void {
    for (const light of this.map.streetLights) {
      const streetLight = StreetLight.addToScene(
        this.scene,
        toVector3(light.position)
      );
      streetLight.scale.setScalar(light.scale);
      streetLight.rotation.y = light.rotation;
    }
  }

  private placeShopBuilding(): void {
    new ShopBuilding(toVector3(this.map.shop.position), this.scene);
  }

  private placeBuildings(): void {
    for (const spec of this.map.buildings) {
      const building = new Building(spec.type, toVector3(spec.position), this.scene);
      building.getObject3D().rotation.y = spec.rotation;
      building.getObject3D().scale.setScalar(spec.scale);
    }
  }

  private placeCrates(): void {
    for (const spec of this.map.crates) {
      const crate = WoodenCrate.addToScene(
        this.scene,
        toVector3(spec.position),
        spec.size,
        spec.rotation,
        spec.id
      );
      this.crates.set(spec.id, crate);
    }
  }

  private placeTrafficCones(): void {
    for (const cone of this.map.cones) {
      const trafficCone = new TrafficCone(
        toVector3(cone.position),
        this.scene,
        cone.rotation
      );
      trafficCone.getObject3D().scale.setScalar(cone.scale);
    }
  }

  private placeTrees(): void {
    for (const tree of this.map.trees) {
      new Tree(toVector3(tree.position), this.scene, tree.rotation, tree.scale);
    }
  }

  private placeBushes(): void {
    for (const bush of this.map.bushes) {
      const bushMesh = new Bush(toVector3(bush.position), this.scene, bush.rotation);
      bushMesh.getObject3D().scale.setScalar(bush.scale);
    }
  }

  /**
   * Boundary walls: brick/concrete bays framed by concrete pillars, with
   * chain-link fence bays for sightlines to the fog beyond. Collision is the
   * single solid AABB from `generateWalls` in shared; this only dresses it.
   */
  private addWalls(): void {
    const brickMaterial = surface("brick-soot");
    const concreteMaterial = surface("weathered-concrete");
    if (!brickMaterial || !concreteMaterial) return;

    for (const wall of this.map.walls) {
      this.buildWall(wall, brickMaterial, concreteMaterial);
    }
  }

  private buildWall(
    wall: WallSpec,
    brickMaterial: THREE.MeshStandardMaterial,
    concreteMaterial: THREE.MeshStandardMaterial
  ): void {
    const box = wall.box;
    const sizeX = box.max.x - box.min.x;
    const sizeZ = box.max.z - box.min.z;
    const axis: WallAxis = sizeX >= sizeZ ? "x" : "z";
    const length = axis === "x" ? sizeX : sizeZ;
    const thickness = axis === "x" ? sizeZ : sizeX;
    const height = box.max.y - box.min.y;
    const perp = axis === "x" ? (box.min.z + box.max.z) / 2 : (box.min.x + box.max.x) / 2;
    const start = axis === "x" ? box.min.x : box.min.z;

    const along = (center: number, perpOffset: number, y: number): THREE.Vector3 =>
      axis === "x"
        ? new THREE.Vector3(center, y, perp + perpOffset)
        : new THREE.Vector3(perp + perpOffset, y, center);

    const dims = (bayLength: number, thicknessSize: number, heightSize: number): THREE.Vector3 =>
      axis === "x"
        ? new THREE.Vector3(bayLength, heightSize, thicknessSize)
        : new THREE.Vector3(thicknessSize, heightSize, bayLength);

    const addBox = (
      size: THREE.Vector3,
      position: THREE.Vector3,
      material: THREE.MeshStandardMaterial
    ): void => {
      const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
      applyWorldUnitUV(geometry, size);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };

    const addPillar = (centerAlong: number): void => {
      const pillarHeight = height + PILLAR_EXTRA_HEIGHT;
      addBox(
        dims(PILLAR_WIDTH, thickness + PILLAR_FOOTPRINT_EXTRA, pillarHeight),
        along(centerAlong, 0, pillarHeight / 2),
        concreteMaterial
      );
      addBox(
        dims(
          PILLAR_WIDTH + PILLAR_CAP_OVERHANG * 2,
          thickness + PILLAR_FOOTPRINT_EXTRA + PILLAR_CAP_OVERHANG * 2,
          PILLAR_CAP_HEIGHT
        ),
        along(centerAlong, 0, pillarHeight + PILLAR_CAP_HEIGHT / 2),
        concreteMaterial
      );
    };

    const addBrickBay = (bayStart: number, bayLength: number): void => {
      const center = bayStart + bayLength / 2;
      const bodyHeight = height - PLINTH_HEIGHT - CAP_HEIGHT;
      addBox(dims(bayLength, thickness, PLINTH_HEIGHT), along(center, 0, PLINTH_HEIGHT / 2), concreteMaterial);
      addBox(
        dims(bayLength, thickness, bodyHeight),
        along(center, 0, PLINTH_HEIGHT + bodyHeight / 2),
        brickMaterial
      );
      addBox(
        dims(bayLength, thickness + CAP_OVERHANG * 2, CAP_HEIGHT),
        along(center, 0, height - CAP_HEIGHT / 2),
        concreteMaterial
      );
    };

    const addFenceBay = (bayStart: number): void => {
      for (let i = 0; i < FENCE_PANELS_PER_BAY; i++) {
        const panelCenter = bayStart + FENCE_PANEL_WIDTH * (i + 0.5);
        const position = along(panelCenter, 0, 0);
        const visual = addYardProp(this.scene, "fence", position);
        visual.rotation.y = axis === "x" ? 0 : Math.PI / 2;
      }
    };

    let offset = 0;
    const bays = layoutBays(length);
    bays.forEach((bay, index) => {
      const bayStart = start + offset;
      if (bay.kind === "brick") addBrickBay(bayStart, bay.length);
      else addFenceBay(bayStart);
      offset += bay.length;
      if (index < bays.length - 1) addPillar(bayStart + bay.length);
    });
  }
}

/**
 * Scales a box's UV so the texture tiles once per world metre on every face,
 * matching the box-projected UVs the Blender buildings already use.
 */
function applyWorldUnitUV(geometry: THREE.BoxGeometry, size: THREE.Vector3): void {
  const uv = geometry.attributes.uv;
  const faceDims: Array<[number, number]> = [
    [size.z, size.y], // +x
    [size.z, size.y], // -x
    [size.x, size.z], // +y
    [size.x, size.z], // -y
    [size.x, size.y], // +z
    [size.x, size.y], // -z
  ];
  for (let face = 0; face < faceDims.length; face++) {
    const [u, v] = faceDims[face];
    for (let vertex = 0; vertex < 4; vertex++) {
      const i = face * 4 + vertex;
      uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
    }
  }
  uv.needsUpdate = true;
}
