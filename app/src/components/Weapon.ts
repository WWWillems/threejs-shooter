import * as THREE from "three";
import { alignSupportHand } from "./ArmIK";
import { attachModel } from "../core/models";
import { characterSocket, pulseCharacterShot } from "./CharacterVisual";
import { MuzzleEffect } from "./MuzzleEffect";
import { Bullet } from "./Bullet";
import type { CollisionDetector } from "./CollisionInterface";
import { WeaponPickup } from "./WeaponPickup";
import type { PickupManager } from "./PickupManager";
import type { NetworkClient } from "../net/NetworkClient";
import { sfx } from "../audio/sfx";
import type { SfxKind } from "../audio/recipes";
import {
  GAME_EVENTS,
  WEAPONS, WEAPON_IDS,
  pelletYawOffsets,
  type ClientEventName,
  type OutgoingPayload,
  type WeaponId,
  type WeaponStats,
} from "@threejs-shooter/shared";

// Define the Weapon interface
export interface Weapon {
  /** Shared weapon id; null for the "Empty" placeholder slot. */
  id: WeaponId | null;
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
  ROCKET = "rocket",
  FLAMETHROWER = "flamethrower",
  PRECISION = "precision",
  ARC = "arc",
}

// Define a type for impact animation functions
type ImpactAnimationFn = (delta: number) => void;

function shotSfxKind(id: WeaponId): SfxKind { return `shot:${id}`; }

// Add window interface augmentation
declare global {
  interface Window {
    __impactAnimations: ImpactAnimationFn[];
  }
}

export class WeaponSystem {
  private weapons: Weapon[] = [];
  private currentWeaponIndex = 0;
  private scene: THREE.Scene;
  private player: THREE.Mesh;
  private bullets: Bullet[] = [];
  private gunOffset = new THREE.Vector3(.19, .37, .46);
  private recoil = 0;
  private equip = 0;
  private dead = false;
  private combatAllowed = true;
  private remoteReload = 0;
  private readonly muzzleEffect: MuzzleEffect;
  private pickupManager: PickupManager | null = null;
  private aimTarget: THREE.Vector3 | null = null;
  /** Null for remote players' weapon systems: they mirror the network, never talk to it. */
  private readonly net: NetworkClient | null;

  // Add auto-fire tracking
  private isMouseDown = false;

  constructor(
    scene: THREE.Scene,
    player: THREE.Mesh,
    net: NetworkClient | null,
    pickupManager?: PickupManager
  ) {
    this.scene = scene;
    this.player = player;
    this.muzzleEffect = new MuzzleEffect(scene);
    this.net = net;
    this.pickupManager = pickupManager || null;

    // Initialize weapons
    this.initializeWeapons();

    // Initialize impact animations array
    if (!window.__impactAnimations) {
      window.__impactAnimations = [];
    }
  }

  /** Send to the server if this is the local player's weapon system. */
  private emit<E extends ClientEventName>(
    event: E,
    payload: OutgoingPayload<E>
  ): void {
    this.net?.send(event, payload);
  }

  /** Build a client weapon from the shared stats table (the server validates against the same numbers). */
  private createWeapon(stats: WeaponStats, model: THREE.Group): Weapon {
    return {
      id: stats.id,
      name: stats.name,
      model,
      bulletsInMagazine: stats.magazineSize,
      totalBullets: stats.reserveAmmo,
      maxMagazineSize: stats.magazineSize,
      fireRate: stats.fireRate,
      isReloading: false,
      reloadTime: stats.reloadTime,
      reloadStartTime: 0,
      lastShotTime: 0,
    };
  }

  // Initialize available weapons
  private initializeWeapons() {
    this.weapons.push(
      this.createWeapon(WEAPONS.pistol, this.createPistol()),
      this.createWeapon(WEAPONS.rifle, this.createRifle()),
      this.createWeapon(WEAPONS.shotgun, this.createShotgun())
    );

    // Initially set first weapon and add to scene
    this.scene.add(this.getCurrentWeapon().model);
  }

  private createPistol(): THREE.Group { return this.createHeldModel('pistol'); }
  private createRifle(): THREE.Group { return this.createHeldModel('rifle'); }
  private createShotgun(): THREE.Group { return this.createHeldModel('shotgun'); }
  private createHeldModel(id: WeaponId): THREE.Group {
    const group = new THREE.Group();
    group.name = `held-${id}`;
    attachModel(group, `noir-${id}`, model=>model.traverse(o=>{if(/^(Muzzle|Magazine|Slide|Pump|Bolt)\.\d+$/.test(o.name))o.name=o.name.replace(/\.\d+$/, "");}));
    return group;
  }

  public getReloadFraction(): number {
    const weapon = this.getCurrentWeapon();
    return weapon.isReloading ? THREE.MathUtils.clamp(
      (performance.now() - weapon.reloadStartTime) / (weapon.reloadTime * 1000), .001, 1
    ) : this.remoteReload;
  }
  public setRemoteReload(value: number): void {
    if (this.remoteReload === 0 && value > 0) {
      sfx.play("reload", this.player.position);
    }
    this.remoteReload = value;
  }
  public setDead(dead: boolean): void {
    this.dead = dead;
    this.isMouseDown = false;
    if (dead) for (const weapon of this.weapons) weapon.isReloading = false;
    else { this.recoil = 0; this.equip = 0; }
  }

  /** Between rounds the trigger does nothing; the server rejects shots anyway. */
  public setCombatAllowed(allowed: boolean): void {
    this.combatAllowed = allowed;
    if (!allowed) this.isMouseDown = false;
  }

  public updatePresentation(delta: number, crouched: boolean): void {
    this.recoil *= Math.exp(-Math.min(delta, .05) * 22);
    this.equip = Math.max(0, this.equip - delta * 4);
    this.updateWeaponPosition(crouched);
    this.muzzleEffect.update(delta);
  }

  public updateWeaponPosition(isCrouching: boolean): void {
    const weapon = this.getCurrentWeapon();
    const model = weapon.model;
    const socket = characterSocket(this.player);
    this.player.updateMatrixWorld(true);
    if (socket) {
      socket.getWorldPosition(model.position);
      socket.getWorldQuaternion(model.quaternion);
    } else {
      model.position.copy(this.gunOffset).setZ(-this.gunOffset.z).applyQuaternion(this.player.quaternion).add(this.player.position);
      if (isCrouching) model.position.y -= .25;
      model.quaternion.copy(this.player.quaternion);
    }
    const reload = this.getReloadFraction();
    const reach = reload > 0 ? Math.sin(reload * Math.PI) : 0;
    if (!this.dead) {
      // Preserve hand motion while aiming the barrel toward the crosshair's elevation.
      if (this.aimTarget) {
        const aim = this.aimTarget.clone().sub(model.position);
        model.rotation.set(Math.atan2(aim.y, Math.hypot(aim.x, aim.z)), this.player.rotation.y, 0, 'YXZ');
      }
      model.rotateX(this.recoil * 1.1 - reach * .48 - this.equip * .7);
      model.rotateZ(reach * -.28);
      model.translateZ(this.recoil * .23);
      model.position.y -= this.equip * .12;
    }
    const slide = model.getObjectByName('Slide');
    if (slide) slide.position.z = this.recoil * .35;
    const magazine = model.getObjectByName('Magazine');
    if (magazine) magazine.position.y = -reach * .18;
    const bolt = model.getObjectByName('Bolt');
    if(bolt) {const age=performance.now()/1000-weapon.lastShotTime;bolt.position.z=age>.12&&age<.7?Math.sin((age-.12)/.58*Math.PI)*.085:0;}
    const pump = model.getObjectByName('Pump');
    if (pump) {
      const age = performance.now() / 1000 - weapon.lastShotTime;
      pump.position.z = age > .08 && age < .4 ? Math.sin((age - .08) / .32 * Math.PI) * .10 : 0;
    }
    model.updateMatrixWorld(true);
    if (!this.dead) alignSupportHand(this.player, model, weapon.id === 'pistol', reload);
  }

  // Method to create and shoot a bullet
  public shoot(scene: THREE.Scene): Bullet | null {
    const currentTime = performance.now() / 1000;
    const currentWeapon = this.getCurrentWeapon();

    // Dead players cannot keep firing an already-held automatic trigger.
    if (this.dead || !this.combatAllowed || currentWeapon.id === null) {
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

    this.updateWeaponPosition(false);
    const barrelPosition = new THREE.Vector3();
    const muzzle = currentWeapon.model.getObjectByName('Muzzle');
    if (muzzle) muzzle.getWorldPosition(barrelPosition);
    else currentWeapon.model.localToWorld(barrelPosition.set(0, .023,
      currentWeapon.id === 'pistol' ? -.338 : currentWeapon.id === 'rifle' ? -.76 : -.81));

    // Aim from the barrel to the point under the crosshair. Falling back to
    // player rotation keeps shooting safe before the first aim update.
    const direction = this.aimTarget
      ? this.aimTarget.clone().sub(barrelPosition).normalize()
      : new THREE.Vector3(0, 0, -1).applyQuaternion(this.player.quaternion);

    // Cosmetic bullet only; the server simulates the authoritative one from
    // the intent below and reports hits via COMBAT.HIT.
    const bullet = this.createBullet(scene, barrelPosition, direction);

    this.emit(GAME_EVENTS.WEAPON.SHOOT, {
      weaponType: currentWeapon.id,
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

    if (currentWeapon.id !== null) {
      sfx.play(shotSfxKind(currentWeapon.id), position);
    }

    // Same pellet fan the server simulates, so cosmetic bullets line up with
    // the authoritative ones.
    const offsets = currentWeapon.id
      ? pelletYawOffsets(WEAPONS[currentWeapon.id])
      : [0];
    const up = new THREE.Vector3(0, 1, 0);
    for (const yaw of offsets) {
      const pelletDirection = normalizedDirection
        .clone()
        .applyAxisAngle(up, yaw);
      const bullet = new Bullet(position.clone(), pelletDirection, scene, currentWeapon.id ?? "pistol");
      this.bullets.push(bullet);
      if (yaw === 0 || primaryBullet === null) primaryBullet = bullet;
    }

    // Create muzzle flash
    const strength = currentWeapon.id === 'flamethrower' ? .18 : currentWeapon.id === 'rocket' ? 2 : currentWeapon.id === 'precision' ? 1.7 : currentWeapon.id === 'shotgun' ? 1.5 : currentWeapon.id === 'rifle' ? .75 : 1;
    this.recoil = Math.min(.22, this.recoil + .12 * strength);
    pulseCharacterShot(this.player, strength);
    this.muzzleEffect.fire(position, direction, strength, currentWeapon.id === "arc" ? 0x77ddff : currentWeapon.id === "flamethrower" ? 0xff982e : 0xffd799);

    return primaryBullet;
  }

  // Update all bullets
  public updateBullets(
    delta: number,
    collisionDetector?: CollisionDetector
  ): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];
      const before = bullet.getPosition().clone();
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
        const steps=Math.max(1,Math.ceil(before.distanceTo(position)/.2));
        let collided=false;
        for(let sample=0;sample<=steps;sample++) {
          const point=before.clone().lerp(position,sample/steps);
          if(collisionDetector.checkForBulletCollision(point)){position.copy(point);collided=true;break;}
        }
        if (collided) {
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

    // Reload is a living-player action.
    if (this.dead || currentWeapon.name === "Empty") {
      return;
    }

    // Check if reloading is allowed
    if (!this.canReload(currentWeapon)) {
      return;
    }

    // Start reloading
    currentWeapon.isReloading = true;
    currentWeapon.reloadStartTime = performance.now();
    sfx.play("reload", this.player.position);
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
      this.equip = 1;
      this.recoil = 0;

      // Get the new current weapon
      const newWeapon = this.getCurrentWeapon();

      // Only add to scene if it's not empty
      if (newWeapon.id !== null) {
        this.scene.add(newWeapon.model);

        // Update weapon position
        this.updateWeaponPosition(false);
        sfx.play("switch", this.player.position);

        // Emit weapon switch event (the empty slot has nothing to show remotely)
        this.emit(GAME_EVENTS.WEAPON.SWITCH, {
          weaponType: newWeapon.id,
          action: "switch",
          data: {
            ammo: newWeapon.bulletsInMagazine,
            totalAmmo: newWeapon.totalBullets,
          },
        });
      }
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
    sfx.play("weapon:drop", playerPosition);

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
      id: null,
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
      if (i !== this.currentWeaponIndex && this.weapons[i].id !== null) {
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
      isEmpty: currentWeapon.id === null,
      ammoType: currentWeapon.id ? WEAPONS[currentWeapon.id].ammoType : "",
    };
  }

  /** Build the held model for a weapon id. */
  private createModelFor(id: WeaponId): THREE.Group { return this.createHeldModel(id); }

  private readonly storedAmmo = new Map<WeaponId, number>();
  public addAmmoById(id: WeaponId, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const weapon=this.weapons.find(w=>w.id===id);
    if(weapon) weapon.totalBullets+=amount;
    else this.storedAmmo.set(id,(this.storedAmmo.get(id)??0)+amount);
  }
  /** A fresh crate weapon includes a loaded magazine; duplicates become matching ammo. */
  public grantWeapon(id: WeaponId, reserve=WEAPONS[id].ammoPickup, select=true): void {
    let index=this.weapons.findIndex(w=>w.id===id);
    if(index>=0) {this.addAmmoById(id,reserve+WEAPONS[id].magazineSize);}
    else {
      const weapon=this.createWeapon(WEAPONS[id],this.createHeldModel(id));
      weapon.totalBullets=reserve+(this.storedAmmo.get(id)??0);this.storedAmmo.delete(id);
      index=this.weapons.findIndex(w=>w.id===null);
      if(index<0){index=this.weapons.length;this.weapons.push(weapon);}else this.weapons[index]=weapon;
      if(index===this.currentWeaponIndex)this.scene.add(weapon.model);
    }
    if(select)this.switchToWeapon(index);
  }
  public equipById(id: WeaponId): void {
    const index=this.weapons.findIndex(w=>w.id===id);
    if(index<0)this.grantWeapon(id,0);else this.switchToWeapon(index);
  }

  /**
   * Add a weapon to the player's inventory
   * @param weapon The weapon to add
   * @returns True if weapon was added successfully, false otherwise
   */
  public addWeapon(weapon: Weapon): boolean {
    if(weapon.id && this.weapons.some(w=>w.id===weapon.id)) {
      this.addAmmoById(weapon.id,weapon.totalBullets+weapon.bulletsInMagazine);return true;
    }
    if(weapon.id) {weapon.totalBullets+=this.storedAmmo.get(weapon.id)??0;this.storedAmmo.delete(weapon.id);}
    // First, check if we have an empty slot to replace
    // Note: If you're seeing a TypeScript error about findIndex,
    // update your tsconfig.json to include "lib": ["es2015", "dom"] or later
    const emptySlotIndex = this.weapons.findIndex(
      (w: Weapon) => w.id === null
    );

    if (weapon.id === null) {
      console.warn("Refusing to add an empty weapon slot to the inventory");
      return false;
    }

    if (emptySlotIndex !== -1) {
      // We found an empty slot, replace it with the new weapon
      weapon.model = this.createModelFor(weapon.id);

      // Replace the empty slot with the new weapon
      this.weapons[emptySlotIndex] = weapon;

      // If this is the current weapon, add it to the scene
      if (emptySlotIndex === this.currentWeaponIndex) {
        this.scene.add(weapon.model);
        this.updateWeaponPosition(false);
      }

      return true;
    }

    // If we don't have an empty slot but have fewer than 3 weapons, add it
    if (this.weapons.length < WEAPON_IDS.length) {
      weapon.model = this.createModelFor(weapon.id);

      // Add the weapon to the inventory
      this.weapons.push(weapon);

      return true;
    }

    // If we get here, we couldn't add the weapon
    return false;
  }

  /**
   * Set the pickup manager
   */
  public setPickupManager(pickupManager: PickupManager): void {
    this.pickupManager = pickupManager;
  }

  public dispose(): void {
    for (const weapon of this.weapons) this.scene.remove(weapon.model);
    for (const bullet of this.bullets) bullet.remove(this.scene);
    this.bullets = [];
    this.muzzleEffect.dispose();
  }

  public setAimTarget(target: THREE.Vector3): void {
    this.aimTarget = target.clone();
  }

  // Set mouse down state (call this when mouse button is pressed)
  public setMouseDown(isDown: boolean): void {
    this.isMouseDown = isDown;
  }

  // Method to update auto-fire (call this in the game loop)
  public updateAutoFire(scene: THREE.Scene, _delta: number): void {
    if (this.isMouseDown && !this.dead) {
      const currentWeapon = this.getCurrentWeapon();
      // Only auto-fire for assault rifle
      if (currentWeapon.id && WEAPONS[currentWeapon.id].automatic) {
        this.shoot(scene);
      }
    }
  }
}
