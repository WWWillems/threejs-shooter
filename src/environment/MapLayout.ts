import * as THREE from "three";

export interface PositionData {
  position: THREE.Vector3;
  rotation?: number;
  scale?: number;
}

export class MapLayout {
  // Cars
  public static readonly CAR_POSITIONS: PositionData[] = [
    { position: new THREE.Vector3(8, 0, 9), rotation: -Math.PI / 5 },
    { position: new THREE.Vector3(12, 0, 15), rotation: Math.PI / 3 },
    { position: new THREE.Vector3(-15, 0, -12), rotation: Math.PI / 8 },
  ];

  // Street lights
  public static readonly STREET_LIGHT_POSITIONS: PositionData[] = [
    { position: new THREE.Vector3(10, 0, 12) },
    { position: new THREE.Vector3(-10, 0, -8) },
    { position: new THREE.Vector3(-5, 0, 15) },
    { position: new THREE.Vector3(15, 0, -15) },
  ];

  // Shop position
  public static readonly SHOP_POSITION: THREE.Vector3 = new THREE.Vector3(
    0,
    0,
    -20
  );

  // Traffic cones
  public static readonly TRAFFIC_CONE_LAYOUTS = {
    // Line of cones
    LINE: {
      start: new THREE.Vector3(10, 0, 11),
      count: 7,
      spacing: 0.8,
    },

    // Curved line of cones
    CURVE: {
      center: new THREE.Vector3(-5, 0, -8),
      radius: 4,
      count: 9,
    },

    // Scattered cones near crash site
    CRASH_SITE: {
      center: new THREE.Vector3(8, 0, 9), // Location of first car
      count: 5,
      radius: { min: 2, max: 5 },
    },

    // Tower base cones
    TOWER_BASE: [
      { position: new THREE.Vector3(-15 - 1.5, 0, 10 - 1.5) },
      { position: new THREE.Vector3(-15 + 1.5, 0, 10 - 1.5) },
      { position: new THREE.Vector3(-15, 0, 10 - 2) },
    ],

    // Shop entrance cones
    SHOP_ENTRANCE: [
      { position: new THREE.Vector3(-3, 0, -15) },
      { position: new THREE.Vector3(3, 0, -15) },
      { position: new THREE.Vector3(-2, 0, -17) },
      { position: new THREE.Vector3(2, 0, -17) },
    ],
  };

  // Wooden crate layouts
  public static readonly CRATE_LAYOUTS = {
    // Main pyramid formation
    PYRAMID: {
      base: new THREE.Vector3(5, 0, 5),
      layers: [
        { count: 4, height: 0.5, offset: 1.1 }, // Bottom layer
        { count: 2, height: 1.5, offset: 0.5 }, // Middle layer
        { count: 1, height: 2.5, offset: 0 }, // Top layer
      ],
    },

    // Defensive wall
    WALL: {
      start: new THREE.Vector3(-8, 0, 6),
      length: 5,
      spacing: 1.2,
      height: 2, // Layers
    },

    // Semi-circle pattern
    CIRCLE: {
      center: new THREE.Vector3(5, 0, -12),
      radius: 5,
      count: 8,
    },

    // Sniper tower
    TOWER: {
      base: new THREE.Vector3(-15, 0, 10),
      baseSize: 1.2,
    },

    // Corner clusters
    CORNERS: [
      {
        position: new THREE.Vector3(18, 0, 18),
        size: { x: 3, z: 3 },
        fillRate: 0.7,
      },
      {
        position: new THREE.Vector3(-18, 0, -18),
        size: { x: 4, z: 3 },
        fillRate: 0.6,
      },
    ],
  };

  // Decoration objects (cubes)
  public static readonly DECORATION_CUBES: PositionData[] = [
    { position: new THREE.Vector3(-8, 1.5, -12), scale: 1 },
    { position: new THREE.Vector3(10, 1.5, 14), scale: 1 },
    { position: new THREE.Vector3(15, 1.5, -10), scale: 1 },
  ];

  // Tree placements
  public static readonly TREE_CLUSTERS = [
    { position: new THREE.Vector3(-18, 0, -18), radius: 4, count: 5 },
  ];

  public static readonly INDIVIDUAL_TREES: THREE.Vector3[] = [
    new THREE.Vector3(15, 0, -15),
    new THREE.Vector3(-12, 0, 10),
    new THREE.Vector3(18, 0, 5),
    new THREE.Vector3(5, 0, 18),
  ];

  // Bush placements
  public static readonly BUSH_CLUSTERS = [
    { position: new THREE.Vector3(-18, 0, -18), radius: 6, count: 8 },
    { position: new THREE.Vector3(12, 0, 12), radius: 2.5, count: 4 },
    { position: new THREE.Vector3(-10, 0, -10), radius: 2.5, count: 3 },
  ];

  public static readonly INDIVIDUAL_BUSHES: THREE.Vector3[] = [
    new THREE.Vector3(10, 0, -8),
    new THREE.Vector3(-5, 0, 5),
    new THREE.Vector3(0, 0, 12),
    new THREE.Vector3(15, 0, 0),
    new THREE.Vector3(-15, 0, -5),
    new THREE.Vector3(5, 0, -15),
    new THREE.Vector3(-8, 0, -3),
    new THREE.Vector3(3, 0, 8),
  ];
}
