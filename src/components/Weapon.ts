import * as THREE from "three";
import { Bullet } from "./Bullet";
import type { CollisionDetector } from "./CollisionInterface";

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

export class WeaponSystem {
  private weapons: Weapon[] = [];
  private currentWeaponIndex = 0;
  private scene: THREE.Scene;
  private player: THREE.Mesh;
  private bullets: Bullet[] = [];
  private gunOffset = new THREE.Vector3(0.7, -0.1, -0.3);

  constructor(scene: THREE.Scene, player: THREE.Mesh) {
    this.scene = scene;
    this.player = player;

    // Initialize weapons
    this.initializeWeapons();
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

    // Create new bullet
    const bullet = new Bullet(barrelPosition, direction, scene);
    this.bullets.push(bullet);

    // Return the bullet for further processing if needed
    return bullet;
  }

  // Update all bullets
  public updateBullets(delta: number, collisionDetector?: CollisionDetector) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];

      // Update bullet and check if it's still alive
      if (!bullet.update(delta)) {
        // Remove bullet from scene
        bullet.remove(this.scene);
        // Remove from bullets array
        this.bullets.splice(i, 1);
        continue;
      }

      // Check for collision with cars if collision detector is provided
      if (collisionDetector?.checkForBulletCollision(bullet.getPosition())) {
        // Bullet hit a car - remove it
        bullet.remove(this.scene);
        // Remove from bullets array
        this.bullets.splice(i, 1);
        // Could add effects here (sound, visual impact, etc.)
      }

      // Here you could add more collision detection for bullets
      // e.g., check if bullet hit other obstacles or enemies
    }
  }

  // Start the reload process
  public reload() {
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

      // Add new weapon to scene
      this.scene.add(this.getCurrentWeapon().model);

      // Update weapon position
      this.updateWeaponPosition(false);
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

  // Get ammo info for HUD
  public getAmmoInfo() {
    const currentWeapon = this.getCurrentWeapon();
    return {
      current: currentWeapon.bulletsInMagazine,
      total: currentWeapon.totalBullets,
      isReloading: currentWeapon.isReloading,
    };
  }
}
