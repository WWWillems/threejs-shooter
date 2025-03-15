import * as THREE from "three";
import { MapLayout } from "./MapLayout";
import { PositionUtils } from "../utils/PositionUtils";
import { ShopBuilding } from "../components/ShopBuilding";
import { TrafficCone } from "../components/TrafficCone";
import { Tree } from "../components/Tree";
import { Bush } from "../components/Bush";
import { IsometricControls } from "../components/IsometricControls";
import { CollisionSystem } from "../components/CollisionSystem";

export class EnvironmentBuilder {
  private scene: THREE.Scene;
  private controls: IsometricControls;
  private collisionSystem: CollisionSystem;

  constructor(scene: THREE.Scene, controls: IsometricControls) {
    this.scene = scene;
    this.controls = controls;
    this.collisionSystem = controls.getCollisionSystem();
  }

  /**
   * Build all environment objects
   */
  public buildEnvironment(): void {
    this.createDecorationCubes();
    this.placeCars();
    this.placeStreetLights();
    this.placeShopBuilding();
    this.createCrateFormations();
    this.placeTrafficCones();
    this.placeTrees();
    this.placeBushes();
  }

  /**
   * Create decoration cubes around the scene
   */
  private createDecorationCubes(): void {
    MapLayout.DECORATION_CUBES.forEach((data) => {
      const cube = this.createCube(
        data.scale || 1,
        this.getRandomColor(),
        data.position.x,
        data.position.y,
        data.position.z
      );
      this.scene.add(cube);
    });
  }

  /**
   * Place cars in the environment
   */
  private placeCars(): void {
    MapLayout.CAR_POSITIONS.forEach((data) => {
      const car = this.controls.addCarToScene(data.position);
      if (data.rotation) {
        car.rotation.y = data.rotation;
      }
      // First car is slightly tilted
      if (data.position.equals(new THREE.Vector3(8, 0, 9))) {
        car.rotation.z = Math.PI / 30;
      }
    });
  }

  /**
   * Place street lights in the environment
   */
  private placeStreetLights(): void {
    MapLayout.STREET_LIGHT_POSITIONS.forEach((data) => {
      this.controls.addStreetLightToScene(data.position);
    });
  }

  /**
   * Place shop building in the environment
   */
  private placeShopBuilding(): void {
    new ShopBuilding(MapLayout.SHOP_POSITION, this.scene, this.collisionSystem);
  }

  /**
   * Create crate formations in the environment
   */
  private createCrateFormations(): void {
    // Main pyramid formation
    const pyramidBase = MapLayout.CRATE_LAYOUTS.PYRAMID.base;
    const pyramidLayers = MapLayout.CRATE_LAYOUTS.PYRAMID.layers;

    // Bottom layer of 4 crates
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(pyramidBase.x - 1.1, 0.5, pyramidBase.z - 1.1),
      1,
      0
    );
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(pyramidBase.x + 1.1, 0.5, pyramidBase.z - 1.1),
      1,
      Math.PI / 6
    );
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(pyramidBase.x - 1.1, 0.5, pyramidBase.z + 1.1),
      1,
      -Math.PI / 8
    );
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(pyramidBase.x + 1.1, 0.5, pyramidBase.z + 1.1),
      1,
      Math.PI / 3
    );

    // Middle layer of 2 crates
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(pyramidBase.x, 1.5, pyramidBase.z - 0.5),
      1,
      Math.PI / 4
    );
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(pyramidBase.x, 1.5, pyramidBase.z + 0.5),
      1,
      -Math.PI / 4
    );

    // Top crate
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(pyramidBase.x, 2.5, pyramidBase.z),
      1,
      Math.PI / 10
    );

    // Defensive wall
    const wallLayout = MapLayout.CRATE_LAYOUTS.WALL;
    const wallStart = wallLayout.start;

    // First layer
    for (let i = 0; i < wallLayout.length; i++) {
      this.controls.addWoodenCrateToScene(
        new THREE.Vector3(
          wallStart.x + i * wallLayout.spacing,
          0.5,
          wallStart.z
        ),
        1,
        i % 2 === 0 ? Math.PI / 8 : -Math.PI / 8
      );
    }

    // Second layer (slightly fewer crates)
    for (let i = 1; i < wallLayout.length - 1; i++) {
      this.controls.addWoodenCrateToScene(
        new THREE.Vector3(
          wallStart.x + i * wallLayout.spacing,
          1.5,
          wallStart.z
        ),
        1,
        i % 2 === 0 ? -Math.PI / 6 : Math.PI / 6
      );
    }

    // Semi-circle pattern
    const circleLayout = MapLayout.CRATE_LAYOUTS.CIRCLE;
    for (let i = 0; i < circleLayout.count; i++) {
      const angle = (i / circleLayout.count) * Math.PI; // Half-circle
      const x = circleLayout.center.x + Math.cos(angle) * circleLayout.radius;
      const z = circleLayout.center.z + Math.sin(angle) * circleLayout.radius;
      this.controls.addWoodenCrateToScene(
        new THREE.Vector3(x, 0.5, z),
        0.9 + Math.random() * 0.3, // Slightly varied sizes
        Math.random() * Math.PI // Random rotations
      );
    }

    // Sniper tower
    const towerLayout = MapLayout.CRATE_LAYOUTS.TOWER;
    const towerBase = towerLayout.base;
    const towerBaseSize = towerLayout.baseSize;

    // Level 1 - 4 crates as base
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(
        towerBase.x - towerBaseSize / 2,
        0.6,
        towerBase.z - towerBaseSize / 2
      ),
      towerBaseSize,
      0
    );
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(
        towerBase.x + towerBaseSize / 2,
        0.6,
        towerBase.z - towerBaseSize / 2
      ),
      towerBaseSize,
      0
    );
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(
        towerBase.x - towerBaseSize / 2,
        0.6,
        towerBase.z + towerBaseSize / 2
      ),
      towerBaseSize,
      0
    );
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(
        towerBase.x + towerBaseSize / 2,
        0.6,
        towerBase.z + towerBaseSize / 2
      ),
      towerBaseSize,
      0
    );

    // Level 2 - Add platform
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(
        towerBase.x - towerBaseSize / 4,
        towerBaseSize + 0.6,
        towerBase.z
      ),
      towerBaseSize,
      Math.PI / 4
    );
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(
        towerBase.x + towerBaseSize / 4,
        towerBaseSize + 0.6,
        towerBase.z
      ),
      towerBaseSize,
      -Math.PI / 4
    );

    // Level 3 - Top platform
    this.controls.addWoodenCrateToScene(
      new THREE.Vector3(towerBase.x, towerBaseSize * 2 + 0.6, towerBase.z),
      towerBaseSize * 1.2,
      Math.PI / 5
    );

    // Corner clusters
    MapLayout.CRATE_LAYOUTS.CORNERS.forEach((corner) => {
      for (let i = 0; i < corner.size.x; i++) {
        for (let j = 0; j < corner.size.z; j++) {
          if (Math.random() > 1 - corner.fillRate) {
            // Skip some crates based on fill rate
            this.controls.addWoodenCrateToScene(
              new THREE.Vector3(
                corner.position.x - i * 1.1 - Math.random() * 0.2,
                0.5,
                corner.position.z - j * 1.1 - Math.random() * 0.2
              ),
              0.8 + Math.random() * 0.4,
              Math.random() * Math.PI
            );
          }
        }
      }
    });
  }

  /**
   * Place traffic cones in the environment
   */
  private placeTrafficCones(): void {
    // Line of cones
    const lineLayout = MapLayout.TRAFFIC_CONE_LAYOUTS.LINE;
    for (let i = 0; i < lineLayout.count; i++) {
      const conePosition = new THREE.Vector3(
        lineLayout.start.x + i * lineLayout.spacing,
        0,
        lineLayout.start.z
      );
      new TrafficCone(conePosition, this.scene, this.collisionSystem);
    }

    // Curved line of cones
    const curveLayout = MapLayout.TRAFFIC_CONE_LAYOUTS.CURVE;
    for (let i = 0; i < curveLayout.count; i++) {
      const angle = (i / (curveLayout.count - 1)) * Math.PI; // Creates a semi-circle
      const x = curveLayout.center.x + Math.cos(angle) * curveLayout.radius;
      const z = curveLayout.center.z + Math.sin(angle) * curveLayout.radius;
      // Slight random rotation for more natural placement
      const rotation = Math.random() * 0.5 - 0.25;
      new TrafficCone(
        new THREE.Vector3(x, 0, z),
        this.scene,
        this.collisionSystem,
        rotation
      );
    }

    // Scattered cones near crash site
    const crashLayout = MapLayout.TRAFFIC_CONE_LAYOUTS.CRASH_SITE;
    for (let i = 0; i < crashLayout.count; i++) {
      // Random positions within a radius of the crash site
      const angle = Math.random() * Math.PI * 2;
      const distance =
        crashLayout.radius.min +
        Math.random() * (crashLayout.radius.max - crashLayout.radius.min);
      const x = crashLayout.center.x + Math.cos(angle) * distance;
      const z = crashLayout.center.z + Math.sin(angle) * distance;

      // Random rotation for fallen cones
      const rotation = Math.random() * Math.PI * 2;
      new TrafficCone(
        new THREE.Vector3(x, 0, z),
        this.scene,
        this.collisionSystem,
        rotation
      );
    }

    // Tower base cones
    MapLayout.TRAFFIC_CONE_LAYOUTS.TOWER_BASE.forEach((cone) => {
      new TrafficCone(cone.position, this.scene, this.collisionSystem);
    });

    // Shop entrance cones
    MapLayout.TRAFFIC_CONE_LAYOUTS.SHOP_ENTRANCE.forEach((cone) => {
      new TrafficCone(cone.position, this.scene, this.collisionSystem);
    });
  }

  /**
   * Place trees in the environment
   */
  private placeTrees(): void {
    // Create a small forest area in one corner of the map
    MapLayout.TREE_CLUSTERS.forEach((cluster) => {
      for (let i = 0; i < cluster.count; i++) {
        const randomOffsetX =
          Math.random() * cluster.radius - cluster.radius / 2;
        const randomOffsetZ =
          Math.random() * cluster.radius - cluster.radius / 2;

        const targetPosition = new THREE.Vector3(
          cluster.position.x + randomOffsetX,
          0,
          cluster.position.z + randomOffsetZ
        );

        const clearPosition = PositionUtils.findClearPosition(
          targetPosition,
          1.2
        );

        if (clearPosition) {
          const randomRotation = Math.random() * Math.PI * 2;
          const randomScale = 0.8 + Math.random() * 0.4; // Scale between 0.8 and 1.2
          new Tree(
            clearPosition,
            this.scene,
            this.collisionSystem,
            randomRotation,
            randomScale
          );
        }
      }
    });

    // Create individual trees around the map
    MapLayout.INDIVIDUAL_TREES.forEach((position) => {
      const clearPosition = PositionUtils.findClearPosition(position, 1.2);

      if (clearPosition) {
        const randomRotation = Math.random() * Math.PI * 2;
        const randomScale = 0.9 + Math.random() * 0.3;
        new Tree(
          clearPosition,
          this.scene,
          this.collisionSystem,
          randomRotation,
          randomScale
        );
      }
    });
  }

  /**
   * Place bushes in the environment
   */
  private placeBushes(): void {
    // Place bush clusters
    MapLayout.BUSH_CLUSTERS.forEach((cluster) => {
      for (let i = 0; i < cluster.count; i++) {
        const randomOffsetX =
          Math.random() * cluster.radius - cluster.radius / 2;
        const randomOffsetZ =
          Math.random() * cluster.radius - cluster.radius / 2;

        const targetPosition = new THREE.Vector3(
          cluster.position.x + randomOffsetX,
          0,
          cluster.position.z + randomOffsetZ
        );

        const clearPosition = PositionUtils.findClearPosition(
          targetPosition,
          0.8
        );

        if (clearPosition) {
          const randomRotation = Math.random() * Math.PI * 2;
          new Bush(
            clearPosition,
            this.scene,
            this.collisionSystem,
            randomRotation
          );
        }
      }
    });

    // Place individual bushes
    MapLayout.INDIVIDUAL_BUSHES.forEach((position) => {
      const clearPosition = PositionUtils.findClearPosition(position, 0.8);

      if (clearPosition) {
        const randomRotation = Math.random() * Math.PI * 2;
        new Bush(
          clearPosition,
          this.scene,
          this.collisionSystem,
          randomRotation
        );
      }
    });
  }

  /**
   * Create cube helper method
   */
  private createCube(
    size: number,
    color: number,
    x: number,
    y: number,
    z: number
  ): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(size, size, size);
    const material = new THREE.MeshStandardMaterial({ color });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.set(x, y, z);
    cube.castShadow = true;
    cube.receiveShadow = true;
    return cube;
  }

  /**
   * Helper to generate a random color
   */
  private getRandomColor(): number {
    const colors = [0xff4444, 0x44ff44, 0x4444ff];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
