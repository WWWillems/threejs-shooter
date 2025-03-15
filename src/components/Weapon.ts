import * as THREE from "three";
import { Bullet } from "./Bullet";
import type { CollisionDetector } from "./CollisionInterface";
import { WeaponPickup } from "./WeaponPickup";
import type { PickupManager } from "./PickupManager";
import { NetworkedEntity } from "../events/networkedEntity";
import type { WeaponEvent } from "../events/types";
import { GAME_EVENTS } from "../events/constants";

// Define the Weapon interface
export interface Weapon {
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

// Enum for weapon types
export enum WeaponType {
  PISTOL = "pistol",
  RIFLE = "rifle",
  SHOTGUN = "shotgun",
  SNIPER = "sniper",
  DEFAULT = "default",
}

// Define a type for impact animation functions
type ImpactAnimationFn = (delta: number) => void;

// Add window interface augmentation
declare global {
  interface Window {
    __impactAnimations: ImpactAnimationFn[];
  }
}

export class WeaponSystem extends NetworkedEntity {
  private weapons: Weapon[] = [];
  private currentWeaponIndex = 0;
  private scene: THREE.Scene;
  private player: THREE.Mesh;
  private bullets: Bullet[] = [];
  private gunOffset = new THREE.Vector3(0.7, -0.1, -0.3);
  private pickupManager: PickupManager | null = null;

  // Add muzzle flash properties
  private muzzleFlash: THREE.Mesh | null = null;
  private muzzleFlashDuration = 0.05; // in seconds
  private muzzleFlashTimer = 0;

  constructor(
    scene: THREE.Scene,
    player: THREE.Mesh,
    pickupManager?: PickupManager
  ) {
    super();

    this.scene = scene;
    this.player = player;
    this.pickupManager = pickupManager || null;

    // Initialize weapons
    this.initializeWeapons();

    // Initialize impact animations array
    if (!window.__impactAnimations) {
      window.__impactAnimations = [];
    }
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

  // Update weapon position based on player state
  public updateWeaponPosition(isCrouching: boolean) {
    const currentWeapon = this.getCurrentWeapon();
    if (!currentWeapon || !currentWeapon.model) return;

    // Set gun position with appropriate height based on crouch state
    const gunPositionY = isCrouching
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
  public shoot(scene: THREE.Scene): Bullet | null {
    const currentTime = performance.now() / 1000;
    const currentWeapon = this.getCurrentWeapon();

    // Don't shoot if the weapon is empty
    if (currentWeapon.name === "Empty") {
      return null;
    }

    // Check if enough time has passed since last shot (fire rate control)
    if (currentTime - currentWeapon.lastShotTime < currentWeapon.fireRate) {
      return null;
    }

    // Don't shoot if reloading
    if (currentWeapon.isReloading) {
      return null;
    }

    // Check if we have bullets in the magazine
    if (currentWeapon.bulletsInMagazine <= 0) {
      // Don't auto-reload anymore, just return
      return null;
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

    // Create the bullet
    const bullet = this.createBullet(scene, barrelPosition, direction);

    // Emit weapon event for network synchronization
    this.emit<WeaponEvent>(GAME_EVENTS.WEAPON.SHOOT, {
      weaponType: currentWeapon.name,
      action: "shoot",
      data: {
        ammo: currentWeapon.bulletsInMagazine,
        totalAmmo: currentWeapon.totalBullets,
        position: {
          x: barrelPosition.x,
          y: barrelPosition.y,
          z: barrelPosition.z,
        },
        direction: {
          x: direction.x,
          y: direction.y,
          z: direction.z,
        },
      },
    });

    return bullet;
  }

  // Method to create a bullet for remote players
  public shootRemote(
    scene: THREE.Scene,
    position: THREE.Vector3,
    direction: THREE.Vector3
  ): Bullet | null {
    const currentTime = performance.now() / 1000;
    const currentWeapon = this.getCurrentWeapon();

    // Update last shot time
    currentWeapon.lastShotTime = currentTime;

    // Create the bullet
    return this.createBullet(scene, position, direction);
  }

  // Helper method to create a bullet with given position and direction
  private createBullet(
    scene: THREE.Scene,
    position: THREE.Vector3,
    direction: THREE.Vector3
  ): Bullet | null {
    const currentWeapon = this.getCurrentWeapon();
    let primaryBullet: Bullet | null = null;

    // Normalize the direction vector to ensure consistent speed
    const normalizedDirection = direction.clone().normalize();

    // Check if current weapon is shotgun
    if (currentWeapon.name === "Shotgun") {
      // Shotgun spread - create 3 bullets with different angles
      // Parameters for spread
      const spreadAngle = 0.1; // Angle in radians for the spread (about 5.7 degrees)

      // Create main bullet (straight ahead)
      primaryBullet = new Bullet(
        position.clone(),
        normalizedDirection.clone(),
        scene
      );
      this.bullets.push(primaryBullet);

      // Create bullet with spread to the right
      const rightDirection = normalizedDirection.clone();
      rightDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), -spreadAngle);
      const rightBullet = new Bullet(position.clone(), rightDirection, scene);
      this.bullets.push(rightBullet);

      // Create bullet with spread to the left
      const leftDirection = normalizedDirection.clone();
      leftDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), spreadAngle);
      const leftBullet = new Bullet(position.clone(), leftDirection, scene);
      this.bullets.push(leftBullet);
    } else {
      // For all other weapons, create a single bullet
      primaryBullet = new Bullet(position.clone(), normalizedDirection, scene);
      this.bullets.push(primaryBullet);
    }

    // Create muzzle flash
    this.createMuzzleFlash(position, Math.atan2(direction.x, direction.z));

    return primaryBullet;
  }

  // Create muzzle flash effect
  private createMuzzleFlash(position: THREE.Vector3, rotation: number): void {
    // Remove existing muzzle flash if it exists
    if (this.muzzleFlash) {
      this.scene.remove(this.muzzleFlash);
      if (this.muzzleFlash.geometry) this.muzzleFlash.geometry.dispose();
      if (this.muzzleFlash.material instanceof THREE.Material)
        this.muzzleFlash.material.dispose();
    }

    // Create muzzle flash geometry - a small circle facing forward
    const flashGeometry = new THREE.CircleGeometry(0.2, 16);

    // Create bright glowing material
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });

    this.muzzleFlash = new THREE.Mesh(flashGeometry, flashMaterial);

    // Position at gun barrel tip
    this.muzzleFlash.position.copy(position);

    // Rotate to face outward from the barrel
    this.muzzleFlash.rotation.y = rotation;
    this.muzzleFlash.rotation.x = Math.PI / 2;

    // Add slight random rotation for variation
    this.muzzleFlash.rotation.z = Math.random() * Math.PI * 2;

    // Add to scene
    this.scene.add(this.muzzleFlash);

    // Start timer for removal
    this.muzzleFlashTimer = this.muzzleFlashDuration;
  }

  // Update all bullets
  public updateBullets(
    delta: number,
    collisionDetector?: CollisionDetector
  ): void {
    // Update muzzle flash timer and remove if expired
    if (this.muzzleFlash && this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= delta;
      if (this.muzzleFlashTimer <= 0) {
        this.scene.remove(this.muzzleFlash);
        this.muzzleFlash = null;
      } else {
        // Animate the muzzle flash (pulsing/fading effect)
        const scale = 1 + Math.sin(this.muzzleFlashTimer * 100) * 0.2;
        this.muzzleFlash.scale.set(scale, scale, scale);

        if (this.muzzleFlash.material instanceof THREE.Material) {
          this.muzzleFlash.material.opacity =
            this.muzzleFlashTimer / this.muzzleFlashDuration;
        }
      }
    }

    // Log number of active bullets

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];
      const position = bullet.getPosition();

      // Update bullet and check if it's still alive
      if (!bullet.update(delta)) {
        // Remove bullet from scene
        bullet.remove(this.scene);
        // Remove from bullets array
        this.bullets.splice(i, 1);
        continue;
      }

      // Check for collision with cars if collision detector is provided
      if (collisionDetector) {
        console.log(`Checking collision for bullet ${i}`);
        if (collisionDetector.checkForBulletCollision(position)) {
          console.log(`Bullet ${i} collided with an object`);
          // Create impact effect at the bullet's position
          this.createImpactEffect(position);

          // Remove bullet from scene
          bullet.remove(this.scene);
          // Remove from bullets array
          this.bullets.splice(i, 1);
        }
      }

      // Here you could add more collision detection for bullets
      // e.g., check if bullet hit other obstacles or enemies
    }
  }

  // Create impact effect where bullets hit
  private createImpactEffect(position: THREE.Vector3): void {
    // Create particle system for impact
    const particleCount = 20; // Slightly more particles for better effect

    // Create individual particle velocities and initial positions
    const particleVelocities: THREE.Vector3[] = [];
    const initialPositions: THREE.Vector3[] = [];

    // Physics parameters
    const gravity = 9.8; // Gravity constant
    const initialSpeed = 2.0; // Initial outward velocity
    const lifetime = 1.0; // Longer lifetime in seconds

    // Create geometry for particle system
    const particles = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const color = new THREE.Color();

    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
      // Random initial direction
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.05; // Small initial radius
      const height = Math.random() * 0.05;

      // Initial position - slightly randomized around impact point
      const initialPosition = new THREE.Vector3(
        position.x + Math.cos(angle) * radius,
        position.y + height,
        position.z + Math.sin(angle) * radius
      );

      // Store initial position
      initialPositions.push(initialPosition.clone());

      // Set up initial positions in the buffer
      positions[i * 3] = initialPosition.x;
      positions[i * 3 + 1] = initialPosition.y;
      positions[i * 3 + 2] = initialPosition.z;

      // Calculate initial velocity - outward and upward
      const initialVelocity = new THREE.Vector3(
        Math.cos(angle) * initialSpeed * (0.5 + Math.random()),
        initialSpeed * (0.5 + Math.random()), // Upward component
        Math.sin(angle) * initialSpeed * (0.5 + Math.random())
      );

      // Store velocity
      particleVelocities.push(initialVelocity);

      // Yellow/orange/red spark colors
      const hue = 0.05 + Math.random() * 0.1; // Narrower range of yellow-orange-red
      color.setHSL(hue, 1.0, 0.5 + Math.random() * 0.5);

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      // Random size
      sizes[i] = Math.random() * 0.04 + 0.01;
    }

    // Set attributes
    particles.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    particles.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    particles.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    // Material for particles - add blending for better glow effect
    const particleMaterial = new THREE.PointsMaterial({
      size: 0.04,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
    });

    // Create particle system and add to scene
    const particleSystem = new THREE.Points(particles, particleMaterial);
    this.scene.add(particleSystem);

    // Animation variables
    let age = 0;

    // Update function called each frame
    const updateImpact = (delta: number) => {
      age += delta;

      if (age >= lifetime) {
        // Remove the particle system
        this.scene.remove(particleSystem);
        particles.dispose();
        particleMaterial.dispose();

        // Remove this update function
        window.__impactAnimations = (window.__impactAnimations || []).filter(
          (fn: ImpactAnimationFn) => fn !== updateImpact
        );
      } else {
        // Update positions based on physics
        const positions = particles.getAttribute(
          "position"
        ) as THREE.BufferAttribute;

        // Update each particle
        for (let i = 0; i < particleCount; i++) {
          // Apply gravity to y-velocity
          particleVelocities[i].y -= gravity * delta;

          // Update position with velocity
          const x = positions.getX(i) + particleVelocities[i].x * delta;
          const y = positions.getY(i) + particleVelocities[i].y * delta;
          const z = positions.getZ(i) + particleVelocities[i].z * delta;

          // Check for ground collision (y = 0)
          if (y <= 0) {
            // Bounce with friction or stop
            if (Math.abs(particleVelocities[i].y) < 0.5) {
              // Too slow, just stop at ground level
              particleVelocities[i].set(0, 0, 0);
              positions.setY(i, 0);
            } else {
              // Bounce with damping
              particleVelocities[i].y *= -0.3; // Lose energy on bounce
              particleVelocities[i].x *= 0.7; // Friction
              particleVelocities[i].z *= 0.7; // Friction
              positions.setY(i, 0);
            }
          } else {
            // Normal update
            positions.setXYZ(i, x, y, z);
          }
        }

        positions.needsUpdate = true;

        // Fade out the particles as they age
        particleMaterial.opacity = 1.0 - age / lifetime;
      }
    };

    // Add update function to global array
    window.__impactAnimations = window.__impactAnimations || [];
    window.__impactAnimations.push(updateImpact);
  }

  // Start the reload process
  public reload() {
    const currentWeapon = this.getCurrentWeapon();

    // Don't reload if the weapon is empty
    if (currentWeapon.name === "Empty") {
      return;
    }

    // Check if reloading is allowed
    if (!this.canReload(currentWeapon)) {
      return;
    }

    // Start reloading
    currentWeapon.isReloading = true;
    currentWeapon.reloadStartTime = performance.now();

    this.emit<WeaponEvent>(GAME_EVENTS.WEAPON.RELOAD, {
      weaponType: currentWeapon.name,
      action: "reload",
      data: {
        ammo: currentWeapon.bulletsInMagazine,
        totalAmmo: currentWeapon.totalBullets,
      },
    });
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
  public completeReload() {
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

  // Check if weapon is reloading
  public isReloading(): boolean {
    return this.getCurrentWeapon().isReloading;
  }

  // Check reload progress
  public checkReloadProgress(time: number): boolean {
    const currentWeapon = this.getCurrentWeapon();
    if (currentWeapon.isReloading) {
      const reloadProgress = (time - currentWeapon.reloadStartTime) / 1000;
      if (reloadProgress >= currentWeapon.reloadTime) {
        return true;
      }
    }
    return false;
  }

  // Switch to previous weapon
  public previousWeapon() {
    const prevIndex =
      (this.currentWeaponIndex - 1 + this.weapons.length) % this.weapons.length;
    this.switchToWeapon(prevIndex);
  }

  // Switch to next weapon
  public nextWeapon() {
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

      // Get the new current weapon
      const newWeapon = this.getCurrentWeapon();

      // Only add to scene if it's not empty
      if (newWeapon.name !== "Empty") {
        this.scene.add(newWeapon.model);

        // Update weapon position
        this.updateWeaponPosition(false);
      }

      // Emit weapon switch event
      this.emit<WeaponEvent>(GAME_EVENTS.WEAPON.SWITCH, {
        weaponType: newWeapon.name,
        action: "switch",
        data: {
          ammo: newWeapon.bulletsInMagazine,
          totalAmmo: newWeapon.totalBullets,
        },
      });
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

  // Drop the current weapon
  public dropCurrentWeapon(): Weapon | null {
    // Cannot drop if there's only one weapon left
    if (this.weapons.length <= 1) {
      return null;
    }

    // Get the current weapon before replacing it
    const droppedWeapon = this.getCurrentWeapon();

    // Remove current weapon from scene
    this.scene.remove(droppedWeapon.model);

    // Create a visual representation of the dropped weapon in the world
    const droppedModel = droppedWeapon.model.clone();

    // Position the model on the ground near the player
    const playerPosition = this.player.position.clone();
    // Position it slightly ahead of the player based on rotation
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(this.player.quaternion);
    direction.multiplyScalar(2); // Drop 2 units ahead

    playerPosition.add(direction);

    // Position the weapon to hover above the ground
    playerPosition.y = 0.5; // Floating 0.5 units above the ground

    // Rotate the weapon to stand upright (pointing up)
    // Reset initial rotation
    droppedModel.rotation.set(0, 0, 0);

    // Different rotation based on weapon type for better visual appearance
    if (droppedWeapon.name === "Pistol") {
      // Pistols look better slightly tilted
      droppedModel.rotateZ(Math.PI / 2); // Rotate 90 degrees around Z to point upward
      droppedModel.rotateX(Math.PI / 12); // Small tilt
    } else if (droppedWeapon.name === "Shotgun") {
      // Shotguns are held horizontally, so rotate differently
      droppedModel.rotateZ(Math.PI / 2); // Rotate 90 degrees around Z
      droppedModel.rotateY(Math.PI / 2); // Rotate 90 degrees around Y
    } else {
      // Rifles and other weapons
      droppedModel.rotateZ(Math.PI / 2); // Rotate 90 degrees around Z to point upward
    }

    // Add a small random rotation for variety
    droppedModel.rotateY((Math.random() * Math.PI) / 12); // Small random rotation around Y axis

    // Create a weapon pickup
    if (this.pickupManager) {
      // Use the pickup manager if available
      this.pickupManager.createWeaponPickup(
        playerPosition,
        droppedWeapon,
        droppedModel
      );
    } else {
      // Fallback to direct creation if no pickup manager is available
      new WeaponPickup(this.scene, playerPosition, droppedWeapon, droppedModel);
    }

    // Instead of removing the weapon from inventory, replace it with an empty slot
    const emptyWeapon: Weapon = {
      name: "Empty",
      model: new THREE.Group(), // Empty group
      bulletsInMagazine: 0,
      totalBullets: 0,
      maxMagazineSize: 0,
      fireRate: 0,
      isReloading: false,
      reloadTime: 0,
      reloadStartTime: 0,
      lastShotTime: 0,
    };

    // Replace the current weapon with the empty slot
    this.weapons[this.currentWeaponIndex] = emptyWeapon;

    // Try to switch to a non-empty weapon if possible
    this.switchToNonEmptyWeapon();

    // Return the dropped weapon info
    return droppedWeapon;
  }

  // Switch to a non-empty weapon if available
  private switchToNonEmptyWeapon(): void {
    // Find the first non-empty weapon
    for (let i = 0; i < this.weapons.length; i++) {
      if (i !== this.currentWeaponIndex && this.weapons[i].name !== "Empty") {
        this.switchToWeapon(i);
        return;
      }
    }

    // If we get here, there are no non-empty weapons, so keep the current (empty) one
  }

  // Get ammo info for HUD
  public getAmmoInfo() {
    const currentWeapon = this.getCurrentWeapon();
    return {
      current: currentWeapon.bulletsInMagazine,
      total: currentWeapon.totalBullets,
      isReloading: currentWeapon.isReloading,
      isEmpty: currentWeapon.name === "Empty",
    };
  }

  /**
   * Add a weapon to the player's inventory
   * @param weapon The weapon to add
   * @returns True if weapon was added successfully, false otherwise
   */
  public addWeapon(weapon: Weapon): boolean {
    // First, check if we have an empty slot to replace
    // Note: If you're seeing a TypeScript error about findIndex,
    // update your tsconfig.json to include "lib": ["es2015", "dom"] or later
    const emptySlotIndex = this.weapons.findIndex(
      (w: Weapon) => w.name === "Empty"
    );

    if (emptySlotIndex !== -1) {
      // We found an empty slot, replace it with the new weapon

      // Create a new model for the weapon based on its name
      let newModel: THREE.Group;
      switch (weapon.name) {
        case "Pistol":
          newModel = this.createPistol();
          break;
        case "Assault Rifle":
          newModel = this.createRifle();
          break;
        case "Shotgun":
          newModel = this.createShotgun();
          break;
        default:
          // If we don't recognize the weapon type, create a default model
          newModel = new THREE.Group();
          console.warn(`Unknown weapon type: ${weapon.name}`);
      }

      // Update the weapon with the new model
      weapon.model = newModel;

      // Replace the empty slot with the new weapon
      this.weapons[emptySlotIndex] = weapon;

      // If this is the current weapon, add it to the scene
      if (emptySlotIndex === this.currentWeaponIndex) {
        this.scene.add(weapon.model);
        this.updateWeaponPosition(false);
      }

      console.log(
        `Added ${weapon.name} to inventory at slot ${emptySlotIndex}`
      );
      return true;
    }

    // If we don't have an empty slot but have fewer than 3 weapons, add it
    if (this.weapons.length < 3) {
      // Create a new model for the weapon based on its name
      let newModel: THREE.Group;
      switch (weapon.name) {
        case "Pistol":
          newModel = this.createPistol();
          break;
        case "Assault Rifle":
          newModel = this.createRifle();
          break;
        case "Shotgun":
          newModel = this.createShotgun();
          break;
        default:
          // If we don't recognize the weapon type, create a default model
          newModel = new THREE.Group();
          console.warn(`Unknown weapon type: ${weapon.name}`);
      }

      // Update the weapon with the new model
      weapon.model = newModel;

      // Add the weapon to the inventory
      this.weapons.push(weapon);

      console.log(`Added ${weapon.name} to inventory as new weapon`);
      return true;
    }

    // If we get here, we couldn't add the weapon
    console.log("Could not add weapon - inventory full");
    return false;
  }

  /**
   * Set the pickup manager
   */
  public setPickupManager(pickupManager: PickupManager): void {
    this.pickupManager = pickupManager;
  }
}
