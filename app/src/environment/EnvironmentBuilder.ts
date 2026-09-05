import * as THREE from "three";
import { generateMap, type MapLayout } from "@threejs-shooter/shared";
import { ShopBuilding } from "../components/ShopBuilding";
import { TrafficCone } from "../components/TrafficCone";
import { Tree } from "../components/Tree";
import { Bush } from "../components/Bush";
import { IsometricControls } from "../components/IsometricControls";
import { CollisionSystem } from "../components/CollisionSystem";

const toVector3 = (v: { x: number; y: number; z: number }) =>
  new THREE.Vector3(v.x, v.y, v.z);

/**
 * Renders the shared, deterministic map. Every prop's position comes from
 * `generateMap`, so this client sees exactly the world the server simulates.
 */
export class EnvironmentBuilder {
  private scene: THREE.Scene;
  private controls: IsometricControls;
  private collisionSystem: CollisionSystem;
  private readonly map: MapLayout;

  constructor(
    scene: THREE.Scene,
    controls: IsometricControls,
    map: MapLayout = generateMap()
  ) {
    this.scene = scene;
    this.controls = controls;
    this.collisionSystem = controls.getCollisionSystem();
    this.map = map;
  }

  public getMap(): MapLayout {
    return this.map;
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
      const car = this.controls.addCarToScene(toVector3(spec.position));
      car.rotation.y = spec.rotation;
      car.rotation.z = spec.tiltZ;
    }
  }

  private placeStreetLights(): void {
    for (const position of this.map.streetLights) {
      this.controls.addStreetLightToScene(toVector3(position));
    }
  }

  private placeShopBuilding(): void {
    new ShopBuilding(
      toVector3(this.map.shop.position),
      this.scene,
      this.collisionSystem
    );
  }

  private placeCrates(): void {
    for (const crate of this.map.crates) {
      this.controls.addWoodenCrateToScene(
        toVector3(crate.position),
        crate.size,
        crate.rotation,
        crate.id
      );
    }
  }

  private placeTrafficCones(): void {
    for (const cone of this.map.cones) {
      new TrafficCone(
        toVector3(cone.position),
        this.scene,
        this.collisionSystem,
        cone.rotation
      );
    }
  }

  private placeTrees(): void {
    for (const tree of this.map.trees) {
      new Tree(
        toVector3(tree.position),
        this.scene,
        this.collisionSystem,
        tree.rotation,
        tree.scale
      );
    }
  }

  private placeBushes(): void {
    for (const bush of this.map.bushes) {
      new Bush(
        toVector3(bush.position),
        this.scene,
        this.collisionSystem,
        bush.rotation
      );
    }
  }

  /**
   * Add walls around the game area; geometry mirrors `generateWalls` in shared.
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

      this.collisionSystem.addCustomObstacle(
        new THREE.Box3(toVector3(box.min), toVector3(box.max))
      );
    }
  }
}
