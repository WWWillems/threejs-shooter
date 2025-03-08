import "./style.css";
import * as THREE from "three";
import { FPSControls } from "./components/FPSControls";

// Initialize the scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

// Create a fog effect
scene.fog = new THREE.Fog(0x111111, 10, 50);

// Setup the camera
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 2, 10);
camera.lookAt(0, 0, 0);

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

// Add first person controls
const controls = new FPSControls(camera, renderer.domElement);

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
ground.position.y = -1;
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

// UI overlay
const uiOverlay = document.createElement("div");
uiOverlay.className = "ui-overlay";
uiOverlay.innerHTML = `
  <h2>Three.js Shooter</h2>
  <p>FPS: <span id="fps">0</span></p>
`;
const appContainer = document.getElementById("app");
if (appContainer) {
  appContainer.appendChild(uiOverlay);
}

// FPS counter
let frameCount = 0;
let lastTime = performance.now();
const fpsElement = document.getElementById("fps");

// Handle window resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  // Rotate the cubes
  cube1.rotation.y += 0.01;
  cube2.rotation.x += 0.01;
  cube3.rotation.z += 0.01;

  // Update controls
  controls.update();

  // Update FPS counter
  frameCount++;
  const currentTime = performance.now();
  if (currentTime - lastTime >= 1000) {
    const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
    if (fpsElement) {
      fpsElement.textContent = fps.toString();
    }
    frameCount = 0;
    lastTime = currentTime;
  }

  // Render the scene
  renderer.render(scene, camera);
}

// Start the animation loop
animate();
