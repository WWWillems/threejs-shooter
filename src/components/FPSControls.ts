import * as THREE from "three";
import { Bullet } from "./Bullet";
import { WeaponSystem } from "./Weapon";
import type { Weapon } from "./Weapon";
import { Car } from "./Car";

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
  clientX: number;
  clientY: number;
  button: number;
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
  private isCrouching = false;
  private isRunning = false;
  private velocity = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private prevTime = performance.now();

  // Mouse control variables
  private mousePosition = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private targetPoint = new THREE.Vector3();
  private isMovingTowardsMouse = false;
  private isMovingAwayFromMouse = false;
  private scene: THREE.Scene;

  // Movement settings
  private speed = 10.0;
  private crouchSpeed = 5.0;
  private runSpeed = 20.0;
  private jumpStrength = 5.0;
  private gravity = 30.0;

  // Camera settings
  private cameraHeight = 15;
  private crouchCameraHeight = 8;
  private cameraDistance = 20;
  private enabled = true;

  // Player dimensions
  private normalHeight = 2;
  private crouchHeight = 1;

  // Weapon system
  private weaponSystem: WeaponSystem;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLCanvasElement,
    player: THREE.Mesh
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.player = player;
    this.scene = player.parent as THREE.Scene;

    // Initialize weapon system
    this.weaponSystem = new WeaponSystem(this.scene, this.player);

    // Set up isometric camera view
    this.setupIsometricView();

    // Initialize controls
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

  private initControls() {
    // Prevent context menu on right-click
    this.domElement.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });

    // Mouse move event
    this.domElement.addEventListener("mousemove", (event: Event) => {
      const mouseEvent = event as unknown as MouseEvent;
      // Calculate mouse position in normalized device coordinates (-1 to +1)
      this.mousePosition.x = (mouseEvent.clientX / window.innerWidth) * 2 - 1;
      this.mousePosition.y = -(mouseEvent.clientY / window.innerHeight) * 2 + 1;

      // Update player rotation immediately when mouse moves
      this.updatePlayerRotation();
      this.weaponSystem.updateWeaponPosition(this.isCrouching);
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
        case "ControlLeft":
        case "ControlRight":
          if (!this.isCrouching) {
            this.isCrouching = true;
            this.crouch();
          }
          break;
        case "ShiftLeft":
        case "ShiftRight":
          if (!this.isCrouching) {
            this.isRunning = true;
          }
          break;
        case "KeyR":
          this.weaponSystem.reload();
          break;
        // Add weapon switching using number keys
        case "Digit1":
          this.weaponSystem.switchToWeapon(0);
          break;
        case "Digit2":
          this.weaponSystem.switchToWeapon(1);
          break;
        case "Digit3":
          this.weaponSystem.switchToWeapon(2);
          break;
        // Scroll through weapons with Q and E
        case "KeyQ":
          this.weaponSystem.previousWeapon();
          break;
        case "KeyE":
          this.weaponSystem.nextWeapon();
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
        case "ControlLeft":
        case "ControlRight":
          if (this.isCrouching) {
            this.isCrouching = false;
            this.standUp();
          }
          break;
        case "ShiftLeft":
        case "ShiftRight":
          this.isRunning = false;
          break;
      }
    });

    // Mouse click event for shooting
    this.domElement.addEventListener("mousedown", (event: Event) => {
      const mouseEvent = event as unknown as MouseEvent;
      if (mouseEvent.button === 0) {
        // Left mouse button
        this.weaponSystem.shoot(this.scene);
      }
    });
  }

  private crouch() {
    if (this.player.geometry instanceof THREE.BoxGeometry) {
      this.player.geometry.dispose();
      const newGeometry = new THREE.BoxGeometry(1, this.crouchHeight, 1);
      this.player.geometry = newGeometry;
    }

    this.player.position.y -= (this.normalHeight - this.crouchHeight) / 2;

    // Update weapon position when crouching
    this.weaponSystem.updateWeaponPosition(true);
  }

  private standUp() {
    if (this.player.geometry instanceof THREE.BoxGeometry) {
      this.player.geometry.dispose();
      const newGeometry = new THREE.BoxGeometry(1, this.normalHeight, 1);
      this.player.geometry = newGeometry;
    }

    this.player.position.y += (this.normalHeight - this.crouchHeight) / 2;

    // Update weapon position when standing up
    this.weaponSystem.updateWeaponPosition(false);
  }

  private updatePlayerRotation() {
    // Cast a ray from the camera through the mouse position
    this.raycaster.setFromCamera(this.mousePosition, this.camera);

    // Find the point of intersection with the ground plane
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const targetPoint = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(groundPlane, targetPoint);

    // Calculate the direction the player should face
    const direction = new THREE.Vector3()
      .subVectors(targetPoint, this.player.position)
      .setY(0) // Ensure we only rotate in the XZ plane
      .normalize();

    // Skip if the direction is too small (mouse is directly over player)
    if (direction.lengthSq() < 0.001) return;

    // Calculate the angle to rotate the player
    const angle = Math.atan2(direction.x, direction.z);

    // Rotate the player to face the mouse
    // Add PI (180 degrees) to make the player face toward the mouse instead of away from it
    this.player.rotation.y = angle + Math.PI;

    // Save target point for movement
    this.targetPoint.copy(targetPoint);
  }

  public update() {
    if (!this.enabled) return;

    const time = performance.now();
    const delta = (time - this.prevTime) / 1000;

    // Check if reloading is complete for current weapon
    if (this.weaponSystem.isReloading()) {
      if (this.weaponSystem.checkReloadProgress(time)) {
        this.weaponSystem.completeReload();
      }
    }

    // Update player rotation to face the mouse - already called on mouse move
    // but we call it again here to ensure smooth rotation
    this.updatePlayerRotation();

    // Make sure weapon position is updated
    this.weaponSystem.updateWeaponPosition(this.isCrouching);

    // Apply gravity
    this.velocity.y -= this.gravity * delta;

    // Direction calculation for cardinal directions
    this.direction.set(0, 0, 0);

    // Create vectors for camera-aligned movement
    const cameraAngle = Math.PI / 4; // 45 degrees, matching the camera's angle

    // Define movement directions based on camera perspective
    const forwardDir = new THREE.Vector3(
      -Math.sin(cameraAngle),
      0,
      -Math.cos(cameraAngle)
    );

    const rightDir = new THREE.Vector3(
      Math.cos(cameraAngle),
      0,
      -Math.sin(cameraAngle)
    );

    // Apply movement based on camera-aligned directions
    if (this.moveForward) {
      this.direction.add(forwardDir);
    }
    if (this.moveBackward) {
      this.direction.sub(forwardDir);
    }
    if (this.moveRight) {
      this.direction.add(rightDir);
    }
    if (this.moveLeft) {
      this.direction.sub(rightDir);
    }

    // Normalize direction if moving diagonally
    if (this.direction.lengthSq() > 0) {
      this.direction.normalize();
    }

    // Apply movement speed based on state
    let currentSpeed = this.speed;
    if (this.isCrouching) {
      currentSpeed = this.crouchSpeed;
    } else if (this.isRunning) {
      currentSpeed = this.runSpeed;
    }

    // Set velocity directly from direction
    this.velocity.x = this.direction.x * currentSpeed;
    this.velocity.z = this.direction.z * currentSpeed;

    // Update player position
    this.player.position.x += this.velocity.x * delta;
    this.player.position.y += this.velocity.y * delta;
    this.player.position.z += this.velocity.z * delta;

    // Simple ground collision detection
    const playerHeight = this.isCrouching
      ? this.crouchHeight
      : this.normalHeight;
    if (this.player.position.y < playerHeight / 2) {
      // Player should not go below y=playerHeight/2 (which is half player height above ground)
      this.velocity.y = 0;
      this.player.position.y = playerHeight / 2;
      this.canJump = true;
    }

    // Update camera position to follow player with appropriate height
    this.updateCameraPosition();

    // Make the camera look at the player
    this.camera.lookAt(this.player.position);

    // Update bullets
    this.weaponSystem.updateBullets(delta);

    this.prevTime = time;
  }

  private updateCameraPosition() {
    // Calculate camera position based on player position
    const angle = Math.PI / 4; // 45 degrees
    // Remove the camera height adjustment based on crouching state
    // const currentCameraHeight = this.isCrouching ? this.crouchCameraHeight : this.cameraHeight;

    this.camera.position.set(
      this.player.position.x + this.cameraDistance * Math.sin(angle),
      this.player.position.y + this.cameraHeight, // Always use the normal camera height
      this.player.position.z + this.cameraDistance * Math.cos(angle)
    );
  }

  // Get ammo info for HUD
  public getAmmoInfo() {
    return this.weaponSystem.getAmmoInfo();
  }

  // Get weapon inventory for HUD
  public getInventory(): Weapon[] {
    return this.weaponSystem.getInventory();
  }

  // Get current weapon index for HUD
  public getCurrentWeaponIndex(): number {
    return this.weaponSystem.getCurrentWeaponIndex();
  }

  // Get current gun (for backwards compatibility)
  get gun(): THREE.Group {
    return this.weaponSystem.getCurrentWeapon().model;
  }

  // Update the addCarToScene method
  public addCarToScene(position: THREE.Vector3): THREE.Group {
    return Car.addToScene(this.scene, position);
  }
}
