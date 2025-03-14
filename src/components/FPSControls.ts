import * as THREE from "three";
import { Bullet } from "./Bullet";

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

// Define a Weapon interface
interface Weapon {
  name: string;
  model: THREE.Group;
  bulletsInMagazine: number;
  totalBullets: number;
  maxMagazineSize: number;
  fireRate: number;
  isReloading: boolean;
  reloadTime: number;
  reloadStartTime: number;
  lastShotTime: number;
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
  private weapons: Weapon[] = [];
  private currentWeaponIndex = 0;
  private bullets: Bullet[] = [];

  // Inventory system
  private inventorySize = 3;
  private gunOffset = new THREE.Vector3(0.7, -0.1, -0.3); // Adjusted to position gun in front of the rotated player

  constructor(
    camera: THREE.Camera,
    domElement: HTMLCanvasElement,
    player: THREE.Mesh
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.player = player;
    this.scene = player.parent as THREE.Scene;

    // Initialize weapons
    this.initializeWeapons();

    // Set up isometric camera view
    this.setupIsometricView();

    // Initialize controls
    this.initControls();
  }

  // Initialize available weapons
  private initializeWeapons() {
    // Create first weapon (pistol)
    const pistol = {
      name: "Pistol",
      model: this.createPistol(),
      bulletsInMagazine: 12,
      totalBullets: 120,
      maxMagazineSize: 12,
      fireRate: 0.4, // Slower fire rate than rifle
      isReloading: false,
      reloadTime: 1.2,
      reloadStartTime: 0,
      lastShotTime: 0,
    };

    // Create second weapon (rifle)
    const rifle = {
      name: "Assault Rifle",
      model: this.createRifle(),
      bulletsInMagazine: 30,
      totalBullets: 150,
      maxMagazineSize: 30,
      fireRate: 0.1, // Faster fire rate
      isReloading: false,
      reloadTime: 2.0,
      reloadStartTime: 0,
      lastShotTime: 0,
    };

    // Create third weapon (shotgun)
    const shotgun = {
      name: "Shotgun",
      model: this.createShotgun(),
      bulletsInMagazine: 6,
      totalBullets: 30,
      maxMagazineSize: 6,
      fireRate: 0.8, // Slowest fire rate
      isReloading: false,
      reloadTime: 0.5, // Per shell reload
      reloadStartTime: 0,
      lastShotTime: 0,
    };

    // Add weapons to the inventory
    this.weapons.push(pistol, rifle, shotgun);

    // Initially set first weapon and add to scene
    this.scene.add(this.getCurrentWeapon().model);
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
      this.updateWeaponPosition();
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
          this.reload();
          break;
        // Add weapon switching using number keys
        case "Digit1":
          this.switchToWeapon(0);
          break;
        case "Digit2":
          this.switchToWeapon(1);
          break;
        case "Digit3":
          this.switchToWeapon(2);
          break;
        // Scroll through weapons with Q and E
        case "KeyQ":
          this.previousWeapon();
          break;
        case "KeyE":
          this.nextWeapon();
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

  // Switch to previous weapon
  private previousWeapon() {
    const prevIndex =
      (this.currentWeaponIndex - 1 + this.weapons.length) % this.weapons.length;
    this.switchToWeapon(prevIndex);
  }

  // Switch to next weapon
  private nextWeapon() {
    const nextIndex = (this.currentWeaponIndex + 1) % this.weapons.length;
    this.switchToWeapon(nextIndex);
  }

  // Switch to specific weapon by index
  public switchToWeapon(index: number) {
    if (
      index >= 0 &&
      index < this.weapons.length &&
      index !== this.currentWeaponIndex
    ) {
      // Remove current weapon from scene
      this.scene.remove(this.getCurrentWeapon().model);

      // Update current weapon index
      this.currentWeaponIndex = index;

      // Add new weapon to scene
      this.scene.add(this.getCurrentWeapon().model);

      // Update weapon position
      this.updateWeaponPosition();
    }
  }

  // Get the current weapon
  public getCurrentWeapon(): Weapon {
    return this.weapons[this.currentWeaponIndex];
  }

  // Get all weapons in inventory
  public getInventory(): Weapon[] {
    return this.weapons;
  }

  // Get current weapon index
  public getCurrentWeaponIndex(): number {
    return this.currentWeaponIndex;
  }

  private crouch() {
    if (this.player.geometry instanceof THREE.BoxGeometry) {
      this.player.geometry.dispose();
      const newGeometry = new THREE.BoxGeometry(1, this.crouchHeight, 1);
      this.player.geometry = newGeometry;
    }

    this.player.position.y -= (this.normalHeight - this.crouchHeight) / 2;

    // Update weapon position when crouching
    this.updateWeaponPosition();
  }

  private standUp() {
    if (this.player.geometry instanceof THREE.BoxGeometry) {
      this.player.geometry.dispose();
      const newGeometry = new THREE.BoxGeometry(1, this.normalHeight, 1);
      this.player.geometry = newGeometry;
    }

    this.player.position.y += (this.normalHeight - this.crouchHeight) / 2;

    // Update weapon position when standing up
    this.updateWeaponPosition();
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
    const currentWeapon = this.getCurrentWeapon();
    if (currentWeapon.isReloading) {
      const reloadProgress = (time - currentWeapon.reloadStartTime) / 1000;
      if (reloadProgress >= currentWeapon.reloadTime) {
        this.completeReload();
      }
    }

    // Update player rotation to face the mouse - already called on mouse move
    // but we call it again here to ensure smooth rotation
    this.updatePlayerRotation();

    // Make sure weapon position is updated
    this.updateWeaponPosition();

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

  // Create pistol model
  private createPistol(): THREE.Group {
    const gunGroup = new THREE.Group();

    // Create gun barrel (shorter than rifle)
    const barrelGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8);
    const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.3;

    // Create gun body (smaller than rifle)
    const bodyGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.4);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.z = 0;

    // Create gun handle
    const handleGeometry = new THREE.BoxGeometry(0.12, 0.35, 0.15);
    const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const handle = new THREE.Mesh(handleGeometry, handleMaterial);
    handle.position.y = -0.25;
    handle.position.z = 0.1;

    // Add all parts to the gun group
    gunGroup.add(barrel);
    gunGroup.add(body);
    gunGroup.add(handle);

    // Add cast shadow for all parts
    barrel.castShadow = true;
    body.castShadow = true;
    handle.castShadow = true;

    // Rotate the entire gun group
    gunGroup.rotation.z = Math.PI / 12;

    return gunGroup;
  }

  // Create rifle model (larger than pistol)
  private createRifle(): THREE.Group {
    const gunGroup = new THREE.Group();

    // Create gun barrel (longer than pistol)
    const barrelGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8);
    const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.5;

    // Create gun body
    const bodyGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.8);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.z = 0;

    // Create stock (extends behind body)
    const stockGeometry = new THREE.BoxGeometry(0.15, 0.25, 0.4);
    const stockMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    const stock = new THREE.Mesh(stockGeometry, stockMaterial);
    stock.position.z = 0.6;
    stock.position.y = -0.1;

    // Create gun handle
    const handleGeometry = new THREE.BoxGeometry(0.15, 0.4, 0.15);
    const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const handle = new THREE.Mesh(handleGeometry, handleMaterial);
    handle.position.y = -0.3;
    handle.position.z = 0.15;

    // Add a sight/scope
    const sightGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.2);
    const sightMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const sight = new THREE.Mesh(sightGeometry, sightMaterial);
    sight.position.y = 0.15;
    sight.position.z = -0.1;

    // Add all parts to the gun group
    gunGroup.add(barrel);
    gunGroup.add(body);
    gunGroup.add(stock);
    gunGroup.add(handle);
    gunGroup.add(sight);

    // Add cast shadow for all parts
    barrel.castShadow = true;
    body.castShadow = true;
    stock.castShadow = true;
    handle.castShadow = true;
    sight.castShadow = true;

    // Rotate the entire gun group
    gunGroup.rotation.z = Math.PI / 12;

    return gunGroup;
  }

  // Create shotgun model
  private createShotgun(): THREE.Group {
    const gunGroup = new THREE.Group();

    // Create gun barrel (wider than rifle)
    const barrelGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.8, 8);
    const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.4;

    // Create second barrel below first (double-barrel shotgun)
    const barrel2 = barrel.clone();
    barrel2.position.y = -0.1;

    // Create gun body
    const bodyGeometry = new THREE.BoxGeometry(0.25, 0.25, 0.7);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.z = 0.2;

    // Create gun handle
    const handleGeometry = new THREE.BoxGeometry(0.15, 0.35, 0.2);
    const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    const handle = new THREE.Mesh(handleGeometry, handleMaterial);
    handle.position.y = -0.25;
    handle.position.z = 0.45;
    handle.rotation.x = Math.PI / 6;

    // Add all parts to the gun group
    gunGroup.add(barrel);
    gunGroup.add(barrel2);
    gunGroup.add(body);
    gunGroup.add(handle);

    // Add cast shadow for all parts
    barrel.castShadow = true;
    barrel2.castShadow = true;
    body.castShadow = true;
    handle.castShadow = true;

    // Rotate the entire gun group
    gunGroup.rotation.z = Math.PI / 12;

    return gunGroup;
  }

  // Update gun position based on player state (renamed from updateGunPosition)
  private updateWeaponPosition() {
    const currentWeapon = this.getCurrentWeapon();
    if (!currentWeapon || !currentWeapon.model) return;

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
    currentWeapon.model.position.copy(gunPosition);

    // Update gun rotation to match player rotation
    currentWeapon.model.rotation.y = this.player.rotation.y;
  }

  // Method to create and shoot a bullet
  private shoot() {
    const currentTime = performance.now() / 1000;
    const currentWeapon = this.getCurrentWeapon();

    // Check if enough time has passed since last shot (fire rate control)
    if (currentTime - currentWeapon.lastShotTime < currentWeapon.fireRate) {
      return;
    }

    // Don't shoot if reloading
    if (currentWeapon.isReloading) {
      return;
    }

    // Check if we have bullets in the magazine
    if (currentWeapon.bulletsInMagazine <= 0) {
      // Don't auto-reload anymore, just return
      return;
    }

    // Update last shot time
    currentWeapon.lastShotTime = currentTime;

    // Decrease bullets in magazine
    currentWeapon.bulletsInMagazine--;

    // Get gun barrel position (front of the gun)
    const barrelPosition = new THREE.Vector3();
    // Get world position of the gun
    currentWeapon.model.getWorldPosition(barrelPosition);

    // Offset to the barrel tip
    const barrelTip = new THREE.Vector3(0, 0, -0.6); // Adjust based on your gun model
    barrelTip.applyQuaternion(currentWeapon.model.quaternion);
    barrelPosition.add(barrelTip);

    // Get direction based on player rotation
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(this.player.quaternion);

    // Create new bullet
    const bullet = new Bullet(barrelPosition, direction, this.scene);
    this.bullets.push(bullet);

    // Play shoot sound or add muzzle flash effect here if desired
  }

  // Start the reload process
  private reload() {
    const currentWeapon = this.getCurrentWeapon();

    // Check if reloading is allowed
    if (!this.canReload(currentWeapon)) {
      return;
    }

    // Start reloading
    currentWeapon.isReloading = true;
    currentWeapon.reloadStartTime = performance.now();
  }

  // Check if reload is allowed
  private canReload(weapon: Weapon): boolean {
    // Don't reload if already reloading
    if (weapon.isReloading) {
      return false;
    }

    // Don't reload if magazine is full
    if (weapon.bulletsInMagazine >= weapon.maxMagazineSize) {
      return false;
    }

    // Don't reload if no bullets left
    if (weapon.totalBullets <= 0) {
      return false;
    }

    return true;
  }

  // Complete the reload process
  private completeReload() {
    const currentWeapon = this.getCurrentWeapon();

    // Calculate how many bullets are needed to fill the magazine
    const bulletsNeeded =
      currentWeapon.maxMagazineSize - currentWeapon.bulletsInMagazine;

    // Calculate how many bullets we can actually add (limited by total bullets)
    const bulletsToAdd = Math.min(bulletsNeeded, currentWeapon.totalBullets);

    // Add bullets to magazine and remove from total
    currentWeapon.bulletsInMagazine += bulletsToAdd;
    currentWeapon.totalBullets -= bulletsToAdd;

    // End reloading state
    currentWeapon.isReloading = false;
  }

  // Get ammo info for HUD
  public getAmmoInfo() {
    const currentWeapon = this.getCurrentWeapon();
    return {
      current: currentWeapon.bulletsInMagazine,
      total: currentWeapon.totalBullets,
      isReloading: currentWeapon.isReloading,
    };
  }

  // Get current gun (for backwards compatibility)
  get gun(): THREE.Group {
    return this.getCurrentWeapon().model;
  }

  // Create a car model using basic geometry
  private createCar(): THREE.Group {
    const carGroup = new THREE.Group();

    // Car body - main chassis
    const bodyGeometry = new THREE.BoxGeometry(2, 0.9, 4);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x2255bb,
      metalness: 0.6,
      roughness: 0.2,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.55;
    body.castShadow = true;
    body.receiveShadow = true;

    // Create slightly curved hood
    const hoodGeometry = new THREE.BoxGeometry(1.8, 0.1, 1.2);
    const hood = new THREE.Mesh(hoodGeometry, bodyMaterial);
    hood.position.set(0, 0.95, -1.3);
    hood.rotation.x = -0.1; // Slight angle for the hood
    hood.castShadow = true;

    // Car cabin/roof with slightly curved top
    const roofGeometry = new THREE.BoxGeometry(1.8, 0.25, 2);
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: 0x2255bb,
      metalness: 0.7,
      roughness: 0.2,
    });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = 1.5;
    roof.position.z = -0.4;
    roof.castShadow = true;

    // Add curved roof top - smaller and more subtle
    const roofTopGeometry = new THREE.BoxGeometry(1.75, 0.08, 1.95);
    const roofTop = new THREE.Mesh(roofTopGeometry, roofMaterial);
    roofTop.position.y = 1.66;
    roofTop.position.z = -0.4;
    roofTop.scale.x = 0.92; // More narrower for a better curved look
    roofTop.castShadow = true;

    // Roof supports (pillars) - adjust height for thinner roof
    const pillarGeometry = new THREE.BoxGeometry(0.1, 0.6, 0.1);
    const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });

    // Front pillars
    const frontLeftPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    frontLeftPillar.position.set(-0.85, 1.25, -1.4);
    const frontRightPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    frontRightPillar.position.set(0.85, 1.25, -1.4);

    // Rear pillars
    const rearLeftPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    rearLeftPillar.position.set(-0.85, 1.25, 0.6);
    const rearRightPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    rearRightPillar.position.set(0.85, 1.25, 0.6);

    // Improved wheels with rims and tires
    const wheelRadius = 0.4;
    const wheelThickness = 0.2;

    // Tire geometry (black outer part)
    const tireGeometry = new THREE.CylinderGeometry(
      wheelRadius,
      wheelRadius,
      wheelThickness,
      24
    );
    const tireMaterial = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.9,
    });

    // Rim geometry (silver inner part)
    const rimGeometry = new THREE.CylinderGeometry(
      wheelRadius * 0.6,
      wheelRadius * 0.6,
      wheelThickness + 0.01,
      12
    );
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0xaaaaaa,
      metalness: 0.8,
      roughness: 0.2,
    });

    // Create wheel assemblies (tire + rim)
    function createWheel(x: number, y: number, z: number) {
      const wheelGroup = new THREE.Group();

      // Create tire
      const tire = new THREE.Mesh(tireGeometry, tireMaterial);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;

      // Create rim
      const rim = new THREE.Mesh(rimGeometry, rimMaterial);
      rim.rotation.z = Math.PI / 2;

      // Add spokes to the rim
      const spokeGeometry = new THREE.BoxGeometry(
        wheelRadius * 1.1,
        0.02,
        0.04
      );
      const spokeMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });

      for (let i = 0; i < 5; i++) {
        const spoke = new THREE.Mesh(spokeGeometry, spokeMaterial);
        spoke.rotation.z = (i / 5) * Math.PI * 2;
        rim.add(spoke);
      }

      // Add tire and rim to wheel group
      wheelGroup.add(tire);
      wheelGroup.add(rim);

      // Position the wheel
      wheelGroup.position.set(x, y, z);

      return wheelGroup;
    }

    // Create all four wheels
    const wheelFL = createWheel(-1.05, 0.4, -1.3);
    const wheelFR = createWheel(1.05, 0.4, -1.3);
    const wheelRL = createWheel(-1.05, 0.4, 1.3);
    const wheelRR = createWheel(1.05, 0.4, 1.3);

    // Front bumper
    const bumperFGeometry = new THREE.BoxGeometry(1.9, 0.2, 0.3);
    const bumperFMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.8,
    });
    const bumperF = new THREE.Mesh(bumperFGeometry, bumperFMaterial);
    bumperF.position.set(0, 0.3, -2.05);
    bumperF.castShadow = true;

    // Rear bumper
    const bumperRGeometry = new THREE.BoxGeometry(1.9, 0.2, 0.3);
    const bumperR = new THREE.Mesh(bumperRGeometry, bumperFMaterial);
    bumperR.position.set(0, 0.3, 2.05);
    bumperR.castShadow = true;

    // Front grille
    const grilleGeometry = new THREE.BoxGeometry(1.4, 0.3, 0.05);
    const grilleMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.9,
    });
    const grille = new THREE.Mesh(grilleGeometry, grilleMaterial);
    grille.position.set(0, 0.6, -2.025);

    // License plates
    const plateGeometry = new THREE.BoxGeometry(0.6, 0.2, 0.02);
    const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const frontPlate = new THREE.Mesh(plateGeometry, plateMaterial);
    frontPlate.position.set(0, 0.3, -2.21);
    const rearPlate = new THREE.Mesh(plateGeometry, plateMaterial);
    rearPlate.position.set(0, 0.3, 2.21);

    // Door lines and panels
    const doorLineGeometry = new THREE.BoxGeometry(0.03, 0.6, 1.8);
    const doorLineMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
    });
    const leftDoorLine = new THREE.Mesh(doorLineGeometry, doorLineMaterial);
    leftDoorLine.position.set(-1.005, 0.7, -0.2);
    const rightDoorLine = new THREE.Mesh(doorLineGeometry, doorLineMaterial);
    rightDoorLine.position.set(1.005, 0.7, -0.2);

    // Door panels - add some depth to doors
    const doorPanelGeometry = new THREE.BoxGeometry(0.05, 0.7, 1.8);
    const doorPanelMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e4eaa, // Slightly different blue for contrast
      metalness: 0.6,
      roughness: 0.3,
    });

    // Left door panel
    const leftDoorPanel = new THREE.Mesh(doorPanelGeometry, doorPanelMaterial);
    leftDoorPanel.position.set(-1.02, 0.7, -0.2);

    // Right door panel
    const rightDoorPanel = new THREE.Mesh(doorPanelGeometry, doorPanelMaterial);
    rightDoorPanel.position.set(1.02, 0.7, -0.2);

    // Door handles
    const handleGeometry = new THREE.BoxGeometry(0.05, 0.08, 0.2);
    const handleMaterial = new THREE.MeshStandardMaterial({
      color: 0xdddddd,
      metalness: 0.8,
    });
    const leftHandle = new THREE.Mesh(handleGeometry, handleMaterial);
    leftHandle.position.set(-1.05, 0.8, -0.5);
    const rightHandle = new THREE.Mesh(handleGeometry, handleMaterial);
    rightHandle.position.set(1.05, 0.8, -0.5);

    // Side mirrors
    const mirrorArmGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.2);
    const mirrorFaceGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.03);
    const mirrorMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });

    // Left mirror
    const leftMirrorArm = new THREE.Mesh(mirrorArmGeometry, bodyMaterial);
    leftMirrorArm.position.set(-1.025, 1.05, -0.9);
    const leftMirrorFace = new THREE.Mesh(mirrorFaceGeometry, mirrorMaterial);
    leftMirrorFace.position.set(-1.15, 1.05, -1.0);

    // Right mirror
    const rightMirrorArm = new THREE.Mesh(mirrorArmGeometry, bodyMaterial);
    rightMirrorArm.position.set(1.025, 1.05, -0.9);
    const rightMirrorFace = new THREE.Mesh(mirrorFaceGeometry, mirrorMaterial);
    rightMirrorFace.position.set(1.15, 1.05, -1.0);

    // Window material (transparent blue glass)
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.5,
      metalness: 0.2,
    });

    // Windshield (front window) - with more realistic angle
    const windshieldGeometry = new THREE.BoxGeometry(1.7, 0.85, 0.1);
    const windshield = new THREE.Mesh(windshieldGeometry, windowMaterial);
    windshield.position.set(0, 1.3, -1.35);
    windshield.rotation.x = Math.PI / 5; // Steeper angle for the windshield

    // Side windows - left with window frame
    const sideWindowGeometry = new THREE.BoxGeometry(0.05, 0.4, 1.8);
    const leftWindow = new THREE.Mesh(sideWindowGeometry, windowMaterial);
    leftWindow.position.set(-0.98, 1.25, -0.3);

    // Window frame - left
    const windowFrameGeometry = new THREE.BoxGeometry(0.07, 0.05, 1.8);
    const windowFrameMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
    });
    const leftWindowTopFrame = new THREE.Mesh(
      windowFrameGeometry,
      windowFrameMaterial
    );
    leftWindowTopFrame.position.set(-0.98, 1.45, -0.3);

    // Side windows - right with window frame
    const rightWindow = new THREE.Mesh(sideWindowGeometry, windowMaterial);
    rightWindow.position.set(0.98, 1.25, -0.3);

    // Window frame - right
    const rightWindowTopFrame = new THREE.Mesh(
      windowFrameGeometry,
      windowFrameMaterial
    );
    rightWindowTopFrame.position.set(0.98, 1.45, -0.3);

    // Rear window
    const rearWindowGeometry = new THREE.BoxGeometry(1.6, 0.55, 0.1);
    const rearWindow = new THREE.Mesh(rearWindowGeometry, windowMaterial);
    rearWindow.position.set(0, 1.3, 0.55);
    rearWindow.rotation.x = -Math.PI / 5; // Angle the rear window

    // Headlights with stronger emission
    const headlightGeometry = new THREE.BoxGeometry(0.4, 0.2, 0.1);
    const headlightMaterial = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 1.0,
    });

    // Left headlight
    const headlightL = new THREE.Mesh(headlightGeometry, headlightMaterial);
    headlightL.position.set(-0.7, 0.6, -2.05);

    // Right headlight
    const headlightR = new THREE.Mesh(headlightGeometry, headlightMaterial);
    headlightR.position.set(0.7, 0.6, -2.05);

    // Add actual light sources for the headlights
    const leftLight = new THREE.SpotLight(0xff0000, 1.5);
    leftLight.position.copy(headlightL.position);
    leftLight.target.position.set(
      headlightL.position.x - 2,
      headlightL.position.y - 0.5,
      headlightL.position.z - 5
    );
    leftLight.angle = Math.PI / 8;
    leftLight.penumbra = 0.2;
    leftLight.decay = 2;
    leftLight.distance = 30;
    leftLight.castShadow = true;
    carGroup.add(leftLight.target);

    const rightLight = new THREE.SpotLight(0xff0000, 1.5);
    rightLight.position.copy(headlightR.position);
    rightLight.target.position.set(
      headlightR.position.x + 2,
      headlightR.position.y - 0.5,
      headlightR.position.z - 5
    );
    rightLight.angle = Math.PI / 8;
    rightLight.penumbra = 0.2;
    rightLight.decay = 2;
    rightLight.distance = 30;
    rightLight.castShadow = true;
    carGroup.add(rightLight.target);

    // Brake lights (rear lights) with enhanced emissive properties
    const brakeGeometry = new THREE.BoxGeometry(0.35, 0.2, 0.05);
    const brakeMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffcc,
      emissive: 0xffffcc,
      emissiveIntensity: 1.0, // Increased from 0.5
    });

    // Left brake light
    const brakeL = new THREE.Mesh(brakeGeometry, brakeMaterial);
    brakeL.position.set(-0.7, 0.6, 2.05);

    // Right brake light
    const brakeR = new THREE.Mesh(brakeGeometry, brakeMaterial);
    brakeR.position.set(0.7, 0.6, 2.05);

    // Add actual light sources for brake lights
    const leftBrakeLight = new THREE.PointLight(0xffffcc, 0.5);
    leftBrakeLight.position.copy(brakeL.position);
    leftBrakeLight.position.z += 0.1; // Offset slightly to be behind the brake light
    leftBrakeLight.decay = 2;
    leftBrakeLight.distance = 5;

    const rightBrakeLight = new THREE.PointLight(0xffffcc, 0.5);
    rightBrakeLight.position.copy(brakeR.position);
    rightBrakeLight.position.z += 0.1; // Offset slightly to be behind the brake light
    rightBrakeLight.decay = 2;
    rightBrakeLight.distance = 5;

    // Exhaust pipe
    const exhaustGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8);
    const exhaustMaterial = new THREE.MeshStandardMaterial({
      color: 0x777777,
      metalness: 0.7,
      roughness: 0.3,
    });
    const exhaust = new THREE.Mesh(exhaustGeometry, exhaustMaterial);
    exhaust.rotation.z = Math.PI / 2;
    exhaust.position.set(-0.7, 0.2, 2.1);

    // Add all parts to the car group
    carGroup.add(body);
    carGroup.add(hood);
    carGroup.add(roof);
    carGroup.add(roofTop); // Add new roof top part
    carGroup.add(frontLeftPillar);
    carGroup.add(frontRightPillar);
    carGroup.add(rearLeftPillar);
    carGroup.add(rearRightPillar);
    carGroup.add(wheelFL);
    carGroup.add(wheelFR);
    carGroup.add(wheelRL);
    carGroup.add(wheelRR);
    carGroup.add(bumperF);
    carGroup.add(bumperR);
    carGroup.add(grille);
    carGroup.add(frontPlate);
    carGroup.add(rearPlate);
    carGroup.add(leftDoorPanel); // Add new door panel
    carGroup.add(rightDoorPanel); // Add new door panel
    carGroup.add(leftDoorLine);
    carGroup.add(rightDoorLine);
    carGroup.add(leftHandle);
    carGroup.add(rightHandle);
    carGroup.add(leftMirrorArm);
    carGroup.add(leftMirrorFace);
    carGroup.add(rightMirrorArm);
    carGroup.add(rightMirrorFace);
    carGroup.add(windshield);
    carGroup.add(leftWindow);
    carGroup.add(rightWindow);
    carGroup.add(leftWindowTopFrame); // Add window frame
    carGroup.add(rightWindowTopFrame); // Add window frame
    carGroup.add(rearWindow);
    carGroup.add(headlightL);
    carGroup.add(headlightR);
    carGroup.add(leftLight);
    carGroup.add(rightLight);
    carGroup.add(brakeL);
    carGroup.add(brakeR);
    carGroup.add(leftBrakeLight);
    carGroup.add(rightBrakeLight);
    carGroup.add(exhaust);

    return carGroup;
  }

  // Add a car to the scene at the specified position
  public addCarToScene(position: THREE.Vector3): THREE.Group {
    const car = this.createCar();
    car.position.copy(position);
    this.scene.add(car);
    return car;
  }
}
