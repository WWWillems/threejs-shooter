import * as THREE from "three";

// Define street light collision dimensions if needed for collision detection
export interface StreetLightCollisionInfo {
  dimensions: THREE.Vector3;
  heightOffset: number;
}

// Create a street light model using basic geometry
function createStreetLightModel(): THREE.Group {
  const streetLightGroup = new THREE.Group();

  // Pole base - wider at the bottom
  const baseGeometry = new THREE.CylinderGeometry(0.3, 0.4, 0.3, 8);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.8,
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.15;
  base.castShadow = true;
  base.receiveShadow = true;
  streetLightGroup.add(base);

  // Main pole
  const poleGeometry = new THREE.CylinderGeometry(0.15, 0.2, 6, 8);
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x444444,
    metalness: 0.5,
    roughness: 0.6,
  });
  const pole = new THREE.Mesh(poleGeometry, poleMaterial);
  pole.position.y = 3.3; // Half of height + base height
  pole.castShadow = true;
  pole.receiveShadow = true;
  streetLightGroup.add(pole);

  // Horizontal arm extending from the pole
  const armGeometry = new THREE.BoxGeometry(1.5, 0.15, 0.15);
  const arm = new THREE.Mesh(armGeometry, poleMaterial);
  arm.position.set(0.7, 6.1, 0); // Position it near the top of the pole with some extension
  arm.castShadow = true;
  streetLightGroup.add(arm);

  // Light fixture housing
  const fixtureGeometry = new THREE.BoxGeometry(0.6, 0.2, 0.4);
  const fixtureMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.7,
  });
  const fixture = new THREE.Mesh(fixtureGeometry, fixtureMaterial);
  fixture.position.set(1.4, 6, 0); // At the end of the arm
  fixture.castShadow = true;
  streetLightGroup.add(fixture);

  // Light bulb (emissive material) - facing downward
  const bulbGeometry = new THREE.BoxGeometry(0.5, 0.1, 0.3);
  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xffcc88, // Warmer color for a cozy vibe
    emissive: 0xffcc88,
    emissiveIntensity: 1.2, // Increased from 0.8 for brighter glow
    roughness: 0.1,
  });
  const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
  bulb.position.set(1.4, 5.9, 0); // Just below the fixture
  streetLightGroup.add(bulb);

  // Add a spotlight to shine downward - more performant than point light
  const warmColor = 0xffcc88; // Warm, orangish-yellow light for cozy night feel
  const spotlight = new THREE.SpotLight(warmColor, 4, 25, Math.PI / 4, 0.5, 1); // Increased intensity from 2 to 4, distance from 20 to 25
  spotlight.position.set(1.4, 5.9, 0); // Position at the bulb

  // Target for the spotlight to aim at the ground
  const target = new THREE.Object3D();
  target.position.set(1.4, 0, 0); // Target on the ground directly below the light
  streetLightGroup.add(target);
  spotlight.target = target;

  // Configure shadow properties
  spotlight.castShadow = true;
  spotlight.shadow.mapSize.width = 512;
  spotlight.shadow.mapSize.height = 512;
  spotlight.shadow.camera.near = 0.5;
  spotlight.shadow.camera.far = 20;
  spotlight.shadow.bias = -0.001;

  streetLightGroup.add(spotlight);

  return streetLightGroup;
}

// Get collision dimensions for the street light
function getCollisionDimensions(): StreetLightCollisionInfo {
  return {
    dimensions: new THREE.Vector3(0.4, 6.3, 0.4), // Width, height, depth
    heightOffset: 3.15, // Center of the collision box should be this height from the ground
  };
}

// Add a street light to the scene at the specified position
export function addToScene(
  scene: THREE.Scene,
  position: THREE.Vector3
): THREE.Group {
  const streetLight = createStreetLightModel();
  streetLight.position.copy(position);
  scene.add(streetLight);
  return streetLight;
}

export const StreetLight = {
  createStreetLightModel,
  addToScene,
  getCollisionDimensions,
};
