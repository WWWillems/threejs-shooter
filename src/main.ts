import "./style.css";
import * as THREE from "three";
import { IsometricControls } from "./components/IsometricControls";
import { HUD } from "./components/HUD";
import { PickupManager } from "./components/PickupManager";
import { ShopBuilding } from "./components/ShopBuilding";

import { RemotePlayerManager } from "./components/RemotePlayerManager";
import { EventEmitter } from "./events/eventEmitter";
import { GAME_EVENTS } from "./events/constants";

// Initialize the scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

// Create a fog effect but increase distance for isometric view
scene.fog = new THREE.FogExp2(0x111111, 0.02); // More subtle exponential fog with lower density

// Setup the camera
const camera = new THREE.PerspectiveCamera(
  45, // Use a narrower FOV for isometric-like view
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
// Camera position will be set by IsometricControls

// Setup the renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const appElement = document.getElementById("app");
if (appElement) {
  appElement.appendChild(renderer.domElement);
}

// Load concrete texture for the ground
const textureLoader = new THREE.TextureLoader();
const concreteBaseColor = textureLoader.load(
  "/textures/concrete/concrete_diffuse.jpg"
);
const concreteNormalMap = textureLoader.load(
  "/textures/concrete/concrete_normal.jpg"
);
const concreteRoughnessMap = textureLoader.load(
  "/textures/concrete/concrete_roughness.jpg"
);

// Set texture repeat for a realistic scale
const textureRepeat = 15; // Reduced from 30 to see more texture detail
concreteBaseColor.wrapS = concreteBaseColor.wrapT = THREE.RepeatWrapping;
concreteBaseColor.repeat.set(textureRepeat, textureRepeat);
concreteNormalMap.wrapS = concreteNormalMap.wrapT = THREE.RepeatWrapping;
concreteNormalMap.repeat.set(textureRepeat, textureRepeat);
concreteRoughnessMap.wrapS = concreteRoughnessMap.wrapT = THREE.RepeatWrapping;
concreteRoughnessMap.repeat.set(textureRepeat, textureRepeat);

// Create a player object
const playerGeometry = new THREE.BoxGeometry(1, 2, 1); // A bit taller than wide
const playerMaterial = new THREE.MeshStandardMaterial({ color: 0xffaa00 }); // Orange-yellow color
const player = new THREE.Mesh(playerGeometry, playerMaterial);
player.position.set(0, 1, 0); // Position at origin, 1 unit above ground (half player height)
player.castShadow = true;
player.receiveShadow = true;
scene.add(player);

// Initialize controls
const controls = new IsometricControls(camera, renderer.domElement, player);

// Initialize HUD
const hud = new HUD(document.body, controls);

// Store HUD reference in scene.userData
scene.userData.hud = hud;

// Initialize RemotePlayerManager
const remotePlayerManager = new RemotePlayerManager(scene, hud);

// Update controls with RemotePlayerManager
controls.updateCollisionSystem(remotePlayerManager);

// Set collision detector for RemotePlayerManager
remotePlayerManager.setCollisionDetector(controls.getCollisionSystem());

// Initialize pickup manager
const pickupManager = new PickupManager(
  scene,
  player,
  controls.getPlayerController(),
  hud,
  controls.getCollisionSystem()
);

// Set pickup manager in controls
controls.setPickupManager(pickupManager);

// Add ambient light
const ambientLight = new THREE.AmbientLight(0x404040);
scene.add(ambientLight);

// Add directional light (like the sun)
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 7.5);
directionalLight.castShadow = true;

// Configure shadow properties
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 50;
directionalLight.shadow.bias = -0.001;

// Set the light's shadow camera bounds
const d = 15;
directionalLight.shadow.camera.left = -d;
directionalLight.shadow.camera.right = d;
directionalLight.shadow.camera.top = d;
directionalLight.shadow.camera.bottom = -d;
scene.add(directionalLight);

// Create a ground plane
const groundGeometry = new THREE.PlaneGeometry(100, 100);
const groundMaterial = new THREE.MeshStandardMaterial({
  map: concreteBaseColor,
  normalMap: concreteNormalMap,
  roughnessMap: concreteRoughnessMap,
  color: 0x666666, // Darker gray for a more concrete-like appearance
  roughness: 1.0, // Increased roughness for a more matte finish
  metalness: 0.05, // Slight metalness to add subtle variation
  normalScale: new THREE.Vector2(1.0, 1.0), // Increased normal map intensity for more visible texture
  displacementScale: 0.2, // Subtle displacement for more surface detail
});

// Add noise to the concrete material for more realism
const noiseTexture = new THREE.DataTexture(
  generateNoiseTexture(64, 64),
  64,
  64,
  THREE.RGBAFormat,
  THREE.FloatType
);
noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;
noiseTexture.repeat.set(5, 5);
noiseTexture.needsUpdate = true;

// Use the noise texture to influence material properties
groundMaterial.onBeforeCompile = (shader) => {
  // Add noise uniform
  shader.uniforms.noiseTexture = { value: noiseTexture };

  // Add to shader header
  shader.fragmentShader = `
    uniform sampler2D noiseTexture;
    ${shader.fragmentShader}`;

  // Modify the final color to add noise variation
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <output_fragment>",
    `
    // Add subtle noise variation to color
    vec4 noise = texture2D(noiseTexture, vUv * 5.0);
    vec3 finalColor = outgoingLight * (0.95 + noise.r * 0.1);
    
    gl_FragColor = vec4(finalColor, diffuseColor.a);
    `
  );
};

const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
ground.position.y = 0;
ground.receiveShadow = true;
scene.add(ground);

// Function to generate noise texture data
function generateNoiseTexture(width: number, height: number): Float32Array {
  const size = width * height * 4; // RGBA
  const data = new Float32Array(size);

  for (let i = 0; i < size; i += 4) {
    const value = Math.random() * 0.1 + 0.95; // Subtle noise (0.95-1.05)
    data[i] = value; // R
    data[i + 1] = value; // G
    data[i + 2] = value; // B
    data[i + 3] = 1.0; // A
  }

  return data;
}

// Create some objects
function createCube(
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

// Add some cubes to the scene
const cube1 = createCube(1, 0xff4444, -8, 1.5, -12);
const cube2 = createCube(1, 0x44ff44, 10, 1.5, 14);
const cube3 = createCube(1, 0x4444ff, 15, 1.5, -10);
scene.add(cube1, cube2, cube3);

// CREATING A CINEMATIC SCENE LAYOUT:

// 1. CAR PLACEMENT - Create a small crashed/abandoned car scene
// First car - slightly tilted as if crashed
const carPosition1 = new THREE.Vector3(8, 0, 9);
const car1 = controls.addCarToScene(carPosition1);
car1.rotation.y = -Math.PI / 5; // Angled
car1.rotation.z = Math.PI / 30; // Slightly tilted

// Second car - positioned near the first like a roadblock/barrier
const carPosition2 = new THREE.Vector3(12, 0, 15);
const car2 = controls.addCarToScene(carPosition2);
car2.rotation.y = Math.PI / 3;

// Third car - positioned farther away to create shooting lanes
const carPosition3 = new THREE.Vector3(-15, 0, -12);
const car3 = controls.addCarToScene(carPosition3);
car3.rotation.y = Math.PI / 8;

// 2. STREET LIGHT PLACEMENT - Create atmospheric lighting
// First street light - near the crashed car scene
const streetLightPosition1 = new THREE.Vector3(10, 0, 12);
controls.addStreetLightToScene(streetLightPosition1);

// Create a second street light on the opposite side for contrast
const streetLightPosition2 = new THREE.Vector3(-10, 0, -8);
controls.addStreetLightToScene(streetLightPosition2);

// Create a third street light to illuminate another play area
const streetLightPosition3 = new THREE.Vector3(-12, 0, 15);
controls.addStreetLightToScene(streetLightPosition3);

// Fourth street light - to create shadows and atmosphere
const streetLightPosition4 = new THREE.Vector3(15, 0, -15);
controls.addStreetLightToScene(streetLightPosition4);

// 3. CRATE PLACEMENT - Create strategic cover opportunities
// A) Main battle area - pyramid formation - moved away from player spawn
const mainPyramidBase = new THREE.Vector3(5, 0, 5); // Changed from (0,0,0) to avoid player spawn
// Bottom layer of 4 crates
controls.addWoodenCrateToScene(
  new THREE.Vector3(mainPyramidBase.x - 1.1, 0.5, mainPyramidBase.z - 1.1),
  1,
  0
);
controls.addWoodenCrateToScene(
  new THREE.Vector3(mainPyramidBase.x + 1.1, 0.5, mainPyramidBase.z - 1.1),
  1,
  Math.PI / 6
);
controls.addWoodenCrateToScene(
  new THREE.Vector3(mainPyramidBase.x - 1.1, 0.5, mainPyramidBase.z + 1.1),
  1,
  -Math.PI / 8
);
controls.addWoodenCrateToScene(
  new THREE.Vector3(mainPyramidBase.x + 1.1, 0.5, mainPyramidBase.z + 1.1),
  1,
  Math.PI / 3
);
// Middle layer of 2 crates
controls.addWoodenCrateToScene(
  new THREE.Vector3(mainPyramidBase.x, 1.5, mainPyramidBase.z - 0.5),
  1,
  Math.PI / 4
);
controls.addWoodenCrateToScene(
  new THREE.Vector3(mainPyramidBase.x, 1.5, mainPyramidBase.z + 0.5),
  1,
  -Math.PI / 4
);
// Top crate
controls.addWoodenCrateToScene(
  new THREE.Vector3(mainPyramidBase.x, 2.5, mainPyramidBase.z),
  1,
  Math.PI / 10
);

// B) Create a defensive wall of crates for cover near one of the cars
const wallStart = new THREE.Vector3(-8, 0, 6);
for (let i = 0; i < 5; i++) {
  controls.addWoodenCrateToScene(
    new THREE.Vector3(wallStart.x + i * 1.2, 0.5, wallStart.z),
    1,
    i % 2 === 0 ? Math.PI / 8 : -Math.PI / 8
  );
}
// Add some height to the wall for better cover
for (let i = 1; i < 4; i++) {
  controls.addWoodenCrateToScene(
    new THREE.Vector3(wallStart.x + i * 1.2, 1.5, wallStart.z),
    1,
    i % 2 === 0 ? -Math.PI / 6 : Math.PI / 6
  );
}

// C) Create scattered crates in a semi-circle pattern for a tactical play area
const circleCenter = new THREE.Vector3(5, 0, -12);
const radius = 5;
for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * Math.PI; // Half-circle
  const x = circleCenter.x + Math.cos(angle) * radius;
  const z = circleCenter.z + Math.sin(angle) * radius;
  controls.addWoodenCrateToScene(
    new THREE.Vector3(x, 0.5, z),
    0.9 + Math.random() * 0.3, // Slightly varied sizes
    Math.random() * Math.PI // Random rotations
  );
}

// D) Create a sniper tower with stacked crates
const towerBase = new THREE.Vector3(-15, 0, 10);
// Level 1 - 4 crates as base
const towerBaseSize = 1.2;
controls.addWoodenCrateToScene(
  new THREE.Vector3(
    towerBase.x - towerBaseSize / 2,
    0.6,
    towerBase.z - towerBaseSize / 2
  ),
  towerBaseSize,
  0
);
controls.addWoodenCrateToScene(
  new THREE.Vector3(
    towerBase.x + towerBaseSize / 2,
    0.6,
    towerBase.z - towerBaseSize / 2
  ),
  towerBaseSize,
  0
);
controls.addWoodenCrateToScene(
  new THREE.Vector3(
    towerBase.x - towerBaseSize / 2,
    0.6,
    towerBase.z + towerBaseSize / 2
  ),
  towerBaseSize,
  0
);
controls.addWoodenCrateToScene(
  new THREE.Vector3(
    towerBase.x + towerBaseSize / 2,
    0.6,
    towerBase.z + towerBaseSize / 2
  ),
  towerBaseSize,
  0
);
// Level 2 - Add platform
controls.addWoodenCrateToScene(
  new THREE.Vector3(
    towerBase.x - towerBaseSize / 4,
    towerBaseSize + 0.6,
    towerBase.z
  ),
  towerBaseSize,
  Math.PI / 4
);
controls.addWoodenCrateToScene(
  new THREE.Vector3(
    towerBase.x + towerBaseSize / 4,
    towerBaseSize + 0.6,
    towerBase.z
  ),
  towerBaseSize,
  -Math.PI / 4
);
// Level 3 - Top platform
controls.addWoodenCrateToScene(
  new THREE.Vector3(towerBase.x, towerBaseSize * 2 + 0.6, towerBase.z),
  towerBaseSize * 1.2,
  Math.PI / 5
);

// E) Create some decorative clustered crates in corner areas
const corner1 = new THREE.Vector3(18, 0, 18);
for (let i = 0; i < 3; i++) {
  for (let j = 0; j < 3; j++) {
    if (Math.random() > 0.3) {
      // Occasionally skip to create gaps
      controls.addWoodenCrateToScene(
        new THREE.Vector3(
          corner1.x - i * 1.1 - Math.random() * 0.2,
          0.5,
          corner1.z - j * 1.1 - Math.random() * 0.2
        ),
        0.8 + Math.random() * 0.4,
        Math.random() * Math.PI
      );
    }
  }
}

const corner2 = new THREE.Vector3(-18, 0, -18);
for (let i = 0; i < 4; i++) {
  for (let j = 0; j < 3; j++) {
    if (Math.random() > 0.4) {
      // Occasionally skip to create gaps
      controls.addWoodenCrateToScene(
        new THREE.Vector3(
          corner2.x + i * 1.1 + Math.random() * 0.2,
          0.5,
          corner2.z + j * 1.1 + Math.random() * 0.2
        ),
        0.8 + Math.random() * 0.4,
        Math.random() * Math.PI
      );
    }
  }
}

// Add a shop building to the scene
const shopPosition = new THREE.Vector3(0, 0, -20);
new ShopBuilding(shopPosition, scene, controls.getCollisionSystem());

// Handle window resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  // Calculate delta time for smooth animations
  const time = performance.now();
  const delta = (time - lastFrameTime) / 1000; // Convert to seconds
  lastFrameTime = time;

  // Rotate the cubes
  cube1.rotation.y += 0.01;
  cube2.rotation.x += 0.01;
  cube3.rotation.z += 0.01;

  // Check for player collision with moving cars (player damage)
  const playerPosition = player.position.clone();
  const playerHeight = controls.getPlayerHeight();
  const carColliders = controls.getCarColliders();

  for (const car of carColliders) {
    // Create car collision box
    const carBox = new THREE.Box3();
    carBox.setFromCenterAndSize(
      new THREE.Vector3(
        car.carObj.position.x,
        car.carObj.position.y + car.heightOffset,
        car.carObj.position.z
      ),
      car.dimensions
    );

    // Create player collision box
    const playerBox = new THREE.Box3();
    playerBox.setFromCenterAndSize(
      new THREE.Vector3(
        playerPosition.x,
        playerPosition.y + playerHeight / 2,
        playerPosition.z
      ),
      new THREE.Vector3(1, playerHeight, 1)
    );

    // Check if player is colliding with car
    if (playerBox.intersectsBox(carBox)) {
      // Apply damage to player (20 damage per second while in contact with car)
      const playerController = controls.getPlayerController();
      if (playerController) {
        playerController.takeDamage(20 * delta);
      }

      break;
    }
  }

  // Update controls
  controls.update();

  // Update pickup manager
  pickupManager.update(delta);

  // Update remote players
  remotePlayerManager.update(delta);

  // Update HUD
  if (hud) {
    hud.update();
  }

  // Update bullet impact animations
  if (window.__impactAnimations && window.__impactAnimations.length > 0) {
    // Create a copy of the array to prevent issues if animations modify the array
    const animations = [...window.__impactAnimations];
    for (const animation of animations) {
      animation(delta);
    }
  }

  // Render the scene
  renderer.render(scene, camera);
}

// Track last frame time for delta calculations
let lastFrameTime = performance.now();

// Start the animation loop
animate();

// Remove the test pickups since we'll now have random spawning
// const healthPickupPosition = new THREE.Vector3(5, 0.5, 5);
// pickupManager.createHealthPickup(healthPickupPosition, 25);

// const ammoPickupPosition = new THREE.Vector3(7, 0.5, 5);
// pickupManager.createAmmoPickup(ammoPickupPosition, WeaponType.RIFLE, 30);

const eventEmitter = EventEmitter.getInstance();

setInterval(() => {
  eventEmitter.emit(GAME_EVENTS.PLAYER.POSITION, {
    position: {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
    },
    rotation: player.rotation.y,
  });
}, 100);

//socket.emit("ping", "Ja hallo zeg");
