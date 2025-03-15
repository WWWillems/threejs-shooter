import * as THREE from "three";

export class GameScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;

  constructor() {
    // Initialize the scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111111);

    // Create a fog effect but increase distance for isometric view
    this.scene.fog = new THREE.FogExp2(0x111111, 0.02); // More subtle exponential fog with lower density

    // Setup the camera
    this.camera = new THREE.PerspectiveCamera(
      45, // Use a narrower FOV for isometric-like view
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    // Setup the renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Append renderer to DOM
    const appElement = document.getElementById("app");
    if (appElement) {
      appElement.appendChild(this.renderer.domElement);
    }

    // Handle window resize
    window.addEventListener("resize", this.onWindowResize.bind(this));
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Method to add lights to the scene
  public addLights(): void {
    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0x404040);
    this.scene.add(ambientLight);

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
    this.scene.add(directionalLight);
  }
}
