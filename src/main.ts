import "./style.css";
import * as THREE from "three";
import { IsometricControls } from "./components/IsometricControls";
import { HUD } from "./components/HUD";

// Initialize the scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

// Create a fog effect but increase distance for isometric view
scene.fog = new THREE.Fog(0x111111, 20, 80);

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
  color: 0x444444,
  roughness: 1.0,
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
