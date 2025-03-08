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
  clientX: number;
  clientY: number;
  button: number;
}

// Bullet class to manage bullet behavior
class Bullet {
  private mesh: THREE.Mesh;
  private velocity: THREE.Vector3;
  private lifespan = 3.0; // Seconds before bullet is removed
  private speed = 30.0;
  private alive = true;

  constructor(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    scene: THREE.Scene
  ) {
    // Create bullet geometry - small sphere
    const geometry = new THREE.SphereGeometry(0.1, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    this.mesh = new THREE.Mesh(geometry, material);

    // Position bullet at gun barrel
    this.mesh.position.copy(position);

    // Set velocity based on normalized direction and speed
    this.velocity = direction.normalize().multiplyScalar(this.speed);

    // Add to scene
    scene.add(this.mesh);

    // Enable shadows
    this.mesh.castShadow = true;
  }

  update(delta: number): boolean {
    // Update lifespan
    this.lifespan -= delta;

    // Check if bullet should be removed
    if (this.lifespan <= 0) {
      this.alive = false;
      return false;
    }

    // Update position
    this.mesh.position.x += this.velocity.x * delta;
    this.mesh.position.y += this.velocity.y * delta;
    this.mesh.position.z += this.velocity.z * delta;

    return true;
  }

  remove(scene: THREE.Scene) {
    scene.remove(this.mesh);
    // Clean up geometry and material
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  isAlive(): boolean {
    return this.alive;
  }

  getPosition(): THREE.Vector3 {
    return this.mesh.position;
  }
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

  // Gun properties
  private gun: THREE.Group;
  private gunOffset = new THREE.Vector3(0.7, -0.1, -0.3); // Adjusted to position gun in front of the rotated player

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

  private bullets: Bullet[] = [];
  private lastShotTime = 0;
  private fireRate = 0.25; // Time in seconds between shots

  constructor(
    camera: THREE.Camera,
    domElement: HTMLCanvasElement,
    player: THREE.Mesh
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.player = player;
    this.scene = player.parent as THREE.Scene;

    // Create the gun and add it to the scene
    this.gun = this.createGun();
    this.scene.add(this.gun);

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
      this.updateGunPosition();
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
        this.shoot();
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

    // Update gun position when crouching
    this.updateGunPosition();
  }

  private standUp() {
    if (this.player.geometry instanceof THREE.BoxGeometry) {
      this.player.geometry.dispose();
      const newGeometry = new THREE.BoxGeometry(1, this.normalHeight, 1);
      this.player.geometry = newGeometry;
    }

    this.player.position.y += (this.normalHeight - this.crouchHeight) / 2;

    // Update gun position when standing up
    this.updateGunPosition();
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

    // Update player rotation to face the mouse - already called on mouse move
    // but we call it again here to ensure smooth rotation
    this.updatePlayerRotation();

    // Make sure gun position is updated
    this.updateGunPosition();

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
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];

      // Update bullet and check if it's still alive
      if (!bullet.update(delta)) {
        // Remove bullet from scene
        bullet.remove(this.scene);
        // Remove from bullets array
        this.bullets.splice(i, 1);
      }

      // Here you could add collision detection for bullets
      // e.g., check if bullet hit an enemy or obstacle
    }

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

  // Create a simple gun model using basic geometries
  private createGun(): THREE.Group {
    const gunGroup = new THREE.Group();

    // Create gun barrel (cylinder)
    const barrelGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8);
    const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    // Position barrel to point forward (player's forward direction is negative Z)
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.4;

    // Create gun body (box)
    const bodyGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.6);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.z = 0;

    // Create gun handle (box)
    const handleGeometry = new THREE.BoxGeometry(0.15, 0.4, 0.15);
    const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const handle = new THREE.Mesh(handleGeometry, handleMaterial);
    handle.position.y = -0.3;
    handle.position.z = 0.15; // Position at back of gun

    // Add a sight/scope (small box on top)
    const sightGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.2);
    const sightMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const sight = new THREE.Mesh(sightGeometry, sightMaterial);
    sight.position.y = 0.15;
    sight.position.z = -0.1;

    // Add all parts to the gun group
    gunGroup.add(barrel);
    gunGroup.add(body);
    gunGroup.add(handle);
    gunGroup.add(sight);

    // Add cast shadow for all parts
    barrel.castShadow = true;
    body.castShadow = true;
    handle.castShadow = true;
    sight.castShadow = true;

    // Rotate the entire gun group to position it properly at the player's side
    // This maintains the forward orientation while being held at the side
    gunGroup.rotation.z = Math.PI / 12; // Slightly tilt the gun

    return gunGroup;
  }

  // Update gun position based on player state
  private updateGunPosition() {
    if (!this.gun) return;

    // Set gun position with appropriate height based on crouch state
    const gunPositionY = this.isCrouching
      ? this.player.position.y - 0.3
      : this.player.position.y - 0.1;

    // Calculate gun position in world space based on player's position and rotation
    // Forward vector based on player's rotation
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.rotation.y);

    // Right vector (perpendicular to forward)
    const right = new THREE.Vector3(1, 0, 0);
    right.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.rotation.y);

    // Calculate gun position relative to player
    // Adjust the gun offset to be in front of the player now that they're rotated correctly
    const gunPosition = new THREE.Vector3(
      this.player.position.x +
        right.x * this.gunOffset.x +
        forward.x * this.gunOffset.z,
      gunPositionY,
      this.player.position.z +
        right.z * this.gunOffset.x +
        forward.z * this.gunOffset.z
    );

    // Update gun position
    this.gun.position.copy(gunPosition);

    // Update gun rotation to match player rotation
    this.gun.rotation.y = this.player.rotation.y;
  }

  // Method to create and shoot a bullet
  private shoot() {
    const currentTime = performance.now() / 1000;

    // Check if enough time has passed since last shot (fire rate control)
    if (currentTime - this.lastShotTime < this.fireRate) {
      return;
    }

    // Update last shot time
    this.lastShotTime = currentTime;

    // Get gun barrel position (front of the gun)
    const barrelPosition = new THREE.Vector3();
    // Get world position of the gun
    this.gun.getWorldPosition(barrelPosition);

    // Offset to the barrel tip
    const barrelTip = new THREE.Vector3(0, 0, -0.6); // Adjust based on your gun model
    barrelTip.applyQuaternion(this.gun.quaternion);
    barrelPosition.add(barrelTip);

    // Get direction based on player rotation
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(this.player.quaternion);

    // Create new bullet
    const bullet = new Bullet(barrelPosition, direction, this.scene);
    this.bullets.push(bullet);

    // Play shoot sound or add muzzle flash effect here if desired
  }
}
