import * as THREE from "three";

// Add type extensions for pointer lock
interface Document {
  mozPointerLockElement?: Element;
  mozExitPointerLock?: () => void;
}

interface HTMLElement {
  mozRequestPointerLock?: () => void;
}

interface MouseEvent {
  mozMovementX?: number;
  mozMovementY?: number;
}

export class IsometricControls {
  private camera: THREE.Camera;
  private domElement: HTMLCanvasElement;
  private player: THREE.Mesh;
  private moveForward = false;
  private moveBackward = false;
  private moveLeft = false;
  private moveRight = false;
  private canJump = false;
  private velocity = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private prevTime = performance.now();

  // Movement settings
  private speed = 10.0;
  private jumpStrength = 5.0;
  private gravity = 30.0;

  // Camera settings
  private cameraHeight = 15;
  private cameraDistance = 20;
  private enabled = true;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLCanvasElement,
    player: THREE.Mesh
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.player = player;

    // Set up isometric camera position and rotation
    this.setupIsometricView();
    this.initControls();
  }

  private setupIsometricView() {
    // Position the camera for isometric view
    // Typical isometric angle is 45 degrees horizontally and 35.264 degrees vertically
    const angle = Math.PI / 4; // 45 degrees in radians
    const elevation = Math.atan(1 / Math.sqrt(2)); // ~35.264 degrees

    // Update camera position relative to player
    this.updateCameraPosition();

    // Point camera to player
    this.camera.lookAt(this.player.position);
  }

  private updateCameraPosition() {
    // Calculate camera position based on player position
    const angle = Math.PI / 4; // 45 degrees

    this.camera.position.set(
      this.player.position.x + this.cameraDistance * Math.sin(angle),
      this.player.position.y + this.cameraHeight,
      this.player.position.z + this.cameraDistance * Math.cos(angle)
    );
  }

  private initControls() {
    // Key down events
    document.addEventListener("keydown", (event) => {
      switch (event.code) {
        case "KeyW":
          this.moveForward = true;
          break;
        case "KeyA":
          this.moveLeft = true;
          break;
        case "KeyS":
          this.moveBackward = true;
          break;
        case "KeyD":
          this.moveRight = true;
          break;
        case "Space":
          if (this.canJump) {
            this.velocity.y = this.jumpStrength;
            this.canJump = false;
          }
          break;
      }
    });

    // Key up events
    document.addEventListener("keyup", (event) => {
      switch (event.code) {
        case "KeyW":
          this.moveForward = false;
          break;
        case "KeyA":
          this.moveLeft = false;
          break;
        case "KeyS":
          this.moveBackward = false;
          break;
        case "KeyD":
          this.moveRight = false;
          break;
      }
    });
  }

  public update() {
    if (!this.enabled) return;

    const time = performance.now();
    const delta = (time - this.prevTime) / 1000;

    // Apply gravity
    this.velocity.y -= this.gravity * delta;

    // Reset direction
    this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
    this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
    this.direction.normalize();

    // Get the camera angle (45 degrees)
    const angle = Math.PI / 4;

    // Calculate movement direction aligned with camera view
    // For isometric view, we need to rotate the movement vector by the camera angle
    const moveX = (this.direction.x - this.direction.z) * Math.cos(angle);
    const moveZ = (this.direction.x + this.direction.z) * Math.sin(angle);

    // Apply movement speed
    this.velocity.x = moveX * this.speed;
    this.velocity.z = -moveZ * this.speed;

    // Update player position
    this.player.position.x += this.velocity.x * delta;
    this.player.position.y += this.velocity.y * delta;
    this.player.position.z += this.velocity.z * delta;

    // Simple ground collision detection
    if (this.player.position.y < 1) {
      // Half the player's height
      this.velocity.y = 0;
      this.player.position.y = 1;
      this.canJump = true;
    }

    // Update camera position to follow player
    this.updateCameraPosition();

    // Make the camera look at the player
    this.camera.lookAt(this.player.position);

    this.prevTime = time;
  }
}
