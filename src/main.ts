import "./style.css";
import * as THREE from "three";
import { IsometricControls } from "./components/IsometricControls";
import { HUD } from "./components/HUD";

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
const textureRepeat = 30; // Increased repeat for more subtle texture appearance
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

// Add isometric controls and pass the player object
const controls = new IsometricControls(camera, renderer.domElement, player);

// Initialize HUD
let hud: HUD | null = null;
if (appElement) {
  hud = new HUD(appElement, controls);
}

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
  color: 0x888888, // Slightly darker gray for a more concrete-like appearance
  roughness: 0.8,
  normalScale: new THREE.Vector2(0.5, 0.5), // Reduce normal map intensity for subtlety
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
ground.position.y = 0;
ground.receiveShadow = true;
scene.add(ground);

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
const cube1 = createCube(2, 0xff4444, -3, 0, 0);
const cube2 = createCube(2, 0x44ff44, 0, 0, 0);
const cube3 = createCube(2, 0x4444ff, 3, 0, 0);
scene.add(cube1, cube2, cube3);

// Add a car to the scene
const carPosition = new THREE.Vector3(10, 0, 5);
const car = controls.addCarToScene(carPosition);
// Rotate the car to face a different direction
car.rotation.y = -Math.PI / 4; // 45 degrees

// Add a street light pole near the car
const streetLightPosition = new THREE.Vector3(12, 0, 7);
const streetLight = controls.addStreetLightToScene(streetLightPosition);

// Add wooden crates to the scene
// A small cluster of crates near the starting area
const crate1 = controls.addWoodenCrateToScene(
  new THREE.Vector3(-5, 0.5, -5),
  1,
  Math.PI / 6
);
const crate2 = controls.addWoodenCrateToScene(
  new THREE.Vector3(-6.5, 0.5, -4.5),
  1,
  -Math.PI / 8
);
const crate3 = controls.addWoodenCrateToScene(
  new THREE.Vector3(-5.5, 0.6, -6.5),
  1.2,
  Math.PI / 3
);

// A stack of crates (smaller one on top of larger one)
const largeCrate = controls.addWoodenCrateToScene(
  new THREE.Vector3(8, 0.6, -7),
  1.2,
  Math.PI / 5
);
const smallCrate = controls.addWoodenCrateToScene(
  new THREE.Vector3(8, 1.8, -7),
  0.8,
  Math.PI / 2
);

// Some scattered crates in different areas
const crate4 = controls.addWoodenCrateToScene(
  new THREE.Vector3(15, 0.5, 2),
  1,
  Math.PI / 4
);
const crate5 = controls.addWoodenCrateToScene(
  new THREE.Vector3(-12, 0.55, 9),
  1.1,
  -Math.PI / 7
);
const crate6 = controls.addWoodenCrateToScene(
  new THREE.Vector3(3, 0.5, -15),
  1,
  Math.PI / 9
);

// Add a more interesting grouping of crates (wall-like arrangement)
const crateWall1 = controls.addWoodenCrateToScene(
  new THREE.Vector3(-10, 0.5, -10),
  1,
  0
);
const crateWall2 = controls.addWoodenCrateToScene(
  new THREE.Vector3(-10, 0.5, -11),
  1,
  Math.PI / 4
);
const crateWall3 = controls.addWoodenCrateToScene(
  new THREE.Vector3(-10, 0.5, -12),
  1,
  Math.PI / 8
);
const crateWall4 = controls.addWoodenCrateToScene(
  new THREE.Vector3(-10, 1.5, -10.5),
  1,
  Math.PI / 6
);
const crateWall5 = controls.addWoodenCrateToScene(
  new THREE.Vector3(-10, 1.5, -11.5),
  1,
  -Math.PI / 10
);
const crateWall6 = controls.addWoodenCrateToScene(
  new THREE.Vector3(-10, 2.5, -11),
  1,
  Math.PI / 3
);

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

  // Update controls
  controls.update();

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
