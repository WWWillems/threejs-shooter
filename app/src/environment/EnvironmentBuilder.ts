import * as THREE from "three";
import type { MapLayout, Vec3 } from "@threejs-shooter/shared";
import { Car } from "../components/Car";
import { StreetLight } from "../components/StreetLight";
import { WoodenCrate, type DestructibleCrate } from "../components/WoodenCrate";
import { ShopBuilding } from "../components/ShopBuilding";
import { TrafficCone } from "../components/TrafficCone";
import { Tree } from "../components/Tree";
import { addYardProp } from "../components/YardProp";
import { Bush } from "../components/Bush";
import { Building } from "../components/Building";

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
    this.placeBuildings();
    this.placeShopBuilding();
    this.placeCrates();
    this.placeTrafficCones();
    this.placeTrees();
    this.placeBushes();
    this.addWalls();
    for (const prop of this.map.props) {
      const visual = addYardProp(this.scene, prop.type, toVector3(prop.position));
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
   * Walls around the game area; geometry mirrors `generateWalls` in shared.
   */
  private addWalls(): void {
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.8,
      metalness: 0.2,
    });

    for (const wall of this.map.walls) {
      const box = wall.box;
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
      const wallMesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        wallMaterial
      );
      wallMesh.position.copy(center);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      this.scene.add(wallMesh);
    }
  }
}
