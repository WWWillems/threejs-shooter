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

export class FPSControls {
  private camera: THREE.Camera;
  private domElement: HTMLCanvasElement;
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

  // Mouse control
  private enabled = false;
  private euler = new THREE.Euler(0, 0, 0, "YXZ");
  private mouseSensitivity = 0.002;

  constructor(camera: THREE.Camera, domElement: HTMLCanvasElement) {
    this.camera = camera;
    this.domElement = domElement;

    // Initial camera position
    this.camera.position.y = 2;

    this.initControls();
  }

  private initControls() {
    // Click to enable controls
    this.domElement.addEventListener("click", () => {
      if (!this.enabled) {
        this.domElement.requestPointerLock?.();
        this.enabled = true;
      }
    });

    // Handle pointer lock changes
    document.addEventListener("pointerlockchange", () => {
      this.enabled = document.pointerLockElement === this.domElement;
    });

    // Mouse movement
    document.addEventListener("mousemove", (event) => {
      if (this.enabled) {
        this.euler.setFromQuaternion(this.camera.quaternion);

        this.euler.y -= event.movementX * this.mouseSensitivity;
        this.euler.x -= event.movementY * this.mouseSensitivity;

        // Limit vertical rotation
        this.euler.x = Math.max(
          -Math.PI / 2,
          Math.min(Math.PI / 2, this.euler.x)
        );

        this.camera.quaternion.setFromEuler(this.euler);
      }
    });

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

    // Calculate movement based on camera direction
    const cameraDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0;
    cameraDirection.normalize();

    // Move forward/backward
    if (this.moveForward || this.moveBackward) {
      this.velocity.z = -this.direction.z * this.speed;
    } else {
      this.velocity.z = 0;
    }

    // Move left/right
    if (this.moveLeft || this.moveRight) {
      this.velocity.x = -this.direction.x * this.speed;
    } else {
      this.velocity.x = 0;
    }

    // Rotate movement vector by camera rotation
    const angle = Math.atan2(cameraDirection.x, cameraDirection.z);
    const rotatedVelocity = new THREE.Vector3(
      this.velocity.x * Math.cos(angle) - this.velocity.z * Math.sin(angle),
      this.velocity.y,
      this.velocity.x * Math.sin(angle) + this.velocity.z * Math.cos(angle)
    );

    // Update camera position
    this.camera.position.x += rotatedVelocity.x * delta;
    this.camera.position.y += rotatedVelocity.y * delta;
    this.camera.position.z += rotatedVelocity.z * delta;

    // Simple ground collision detection
    if (this.camera.position.y < 2) {
      this.velocity.y = 0;
      this.camera.position.y = 2;
      this.canJump = true;
    }

    this.prevTime = time;
  }
}
