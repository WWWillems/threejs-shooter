import * as THREE from "three";
import type { MapLayout, Vec3 } from "@threejs-shooter/shared";
import { Car } from "../components/Car";
import { StreetLight } from "../components/StreetLight";
import { WoodenCrate, type DestructibleCrate } from "../components/WoodenCrate";
import { ShopBuilding } from "../components/ShopBuilding";
import { TrafficCone } from "../components/TrafficCone";
import { Tree } from "../components/Tree";
import { Bush } from "../components/Bush";

const toVector3 = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z);

/**
 * Renders the shared, deterministic map. Every prop's position comes from the
 * `MapLayout`, so this client sees exactly the world the server simulates.
 * Meshes only: collision lives in `WorldColliders`, built from the same map.
 */
export class EnvironmentBuilder {
  /** Crate meshes by shared crate id, for `CrateSync` to damage and remove. */
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
    this.placeShopBuilding();
    this.placeCrates();
    this.placeTrafficCones();
    this.placeTrees();
    this.placeBushes();
    this.addWalls();
  }

  private placeCars(): void {
    for (const spec of this.map.cars) {
      const car = Car.addToScene(this.scene, toVector3(spec.position));
      car.rotation.y = spec.rotation;
      car.rotation.z = spec.tiltZ;
    }
  }

  private placeStreetLights(): void {
    for (const position of this.map.streetLights) {
      StreetLight.addToScene(this.scene, toVector3(position));
    }
  }

  private placeShopBuilding(): void {
    new ShopBuilding(toVector3(this.map.shop.position), this.scene);
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
      new TrafficCone(toVector3(cone.position), this.scene, cone.rotation);
    }
  }

  private placeTrees(): void {
    for (const tree of this.map.trees) {
      new Tree(toVector3(tree.position), this.scene, tree.rotation, tree.scale);
    }
  }

  private placeBushes(): void {
    for (const bush of this.map.bushes) {
      new Bush(toVector3(bush.position), this.scene, bush.rotation);
    }
  }

  /**
   * Walls around the game area; geometry mirrors `generateWalls` in shared.
   */
  private addWalls(): void {
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.8,
      metalness: 0.2,
    });

    for (const box of this.map.walls) {
      const size = new THREE.Vector3(
        box.max.x - box.min.x,
        box.max.y - box.min.y,
        box.max.z - box.min.z
      );
      const center = new THREE.Vector3(
        (box.min.x + box.max.x) / 2,
        (box.min.y + box.max.y) / 2,
        (box.min.z + box.max.z) / 2
      );
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        wallMaterial
      );
      wall.position.copy(center);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
    }
  }
}
