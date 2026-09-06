import * as THREE from "three";
import {
  GAME_EVENTS, WEAPONS,
  isWithinPickupReach,
  type PickupSpec,
  type WeaponId,
} from "@threejs-shooter/shared";
import type { PlayerController } from "./PlayerController";
import { WeaponType } from "./Weapon";
import type { Weapon } from "./Weapon";
import { HealthPickup } from "./HealthPickup";
import { AmmoPickup } from "./AmmoPickup";
import { ArsenalPickup } from "./ArsenalPickup";
import { ThrowablePickup } from "./ThrowablePickup";
import { WeaponPickup } from "./WeaponPickup";
import type { HUD } from "./HUD";
import type { NetworkClient } from "../net/NetworkClient";
import {
  prewarmPickupEffects,
  updatePickupEffects,
  type Pickup,
} from "./Pickup";
import { sfx } from "../audio/sfx";

/** Don't re-send a claim for the same pickup more often than this (ms). */
const CLAIM_RETRY_MS = 500;

/**
 * Renders pickups. Health, ammo, weapon and throwable pickups are owned by the
 * server: they appear on PICKUP.SPAWNED, we send PICKUP.CLAIM when the local
 * player is in reach, and they disappear on PICKUP.TAKEN / PICKUP.EXPIRED.
 * Dropped weapons are still purely local (inventory is client-trusted for now).
 */
export class PickupManager {
  private scene: THREE.Scene;
  /** Server-owned pickups keyed by server id. */
  private serverPickups = new Map<string, Pickup>();
  /** Claims in flight: pickup id -> time sent (ms). */
  private pendingClaims = new Map<string, number>();
  /** Client-owned pickups (dropped weapons). */
  private localPickups: Pickup[] = [];
  private playerController: PlayerController;
  private player: THREE.Object3D;
  private net: NetworkClient;
  private collectionDistance = 1.5;
  private hud: HUD | null = null;

  constructor(
    scene: THREE.Scene,
    player: THREE.Object3D,
    playerController: PlayerController,
    net: NetworkClient,
    hud?: HUD
  ) {
    this.scene = scene;
    this.player = player;
    this.playerController = playerController;
    this.net = net;
    this.hud = hud || null;

    // Keep pickup flash lights in the scene before the first gameplay frame.
    // Adding lights during collection can trigger a shader compilation hitch.
    prewarmPickupEffects(scene);

    // Initialize animations array
    if (!window.__pickupAnimations) {
      window.__pickupAnimations = [];
    }

    this.setupNetworkListeners();
  }

  private setupNetworkListeners(): void {
    const { net } = this;

    // Full sync on (re)join: whatever the server has is what exists
    net.on(GAME_EVENTS.GAME.STATE, ({ pickups }) => {
      this.clearServerPickups();
      for (const spec of pickups) this.spawnFromSpec(spec, false);
    });

    net.on(GAME_EVENTS.PICKUP.SPAWNED, (spec) => this.spawnFromSpec(spec, true));

    net.on(GAME_EVENTS.PICKUP.EXPIRED, ({ pickupId }) => {
      this.removeServerPickup(pickupId);
    });

    net.on(GAME_EVENTS.PICKUP.TAKEN, ({ pickup, playerId, hp }) => {
      const position = new THREE.Vector3(
        pickup.position.x,
        pickup.position.y,
        pickup.position.z
      );
      sfx.play(
        pickup.kind === "health" ? "pickup:health" : "pickup:ammo",
        position
      );

      const rendered = this.serverPickups.get(pickup.id);
      rendered?.playCollectionEffect();
      this.removeServerPickup(pickup.id);

      if (playerId !== net.selfId) return;
      this.applyToLocalPlayer(pickup, hp);
    });
  }

  /** The server says we got it: apply the effect and tell the player. */
  private applyToLocalPlayer(pickup: PickupSpec, hp: number): void {
    switch (pickup.kind) {
      case "weapon":
        this.playerController.getWeaponSystem().grantWeapon(pickup.weaponId,pickup.amount);
        this.hud?.showWeaponPickupNotification(WEAPONS[pickup.weaponId].name);
        break;
      case "health":
        this.playerController.applyServerHp(hp);
        this.hud?.showHealthPickupNotification(pickup.amount);
        break;
      case "ammo": {
        const weaponType = toWeaponType(pickup.weaponId);
        this.playerController.addAmmo(weaponType, pickup.amount);
        this.hud?.showAmmoPickupNotification(weaponType, pickup.amount);
        break;
      }
      case "throwable":
        this.playerController.addThrowables(pickup.grenadeKind, pickup.amount);
        this.hud?.showThrowablePickupNotification(pickup.grenadeKind, pickup.amount);
        break;
      default: {
        const unhandled: never = pickup;
        throw new Error(`Unhandled pickup kind: ${String(unhandled)}`);
      }
    }
  }

  private spawnFromSpec(spec: PickupSpec, playSound: boolean): void {
    if (this.serverPickups.has(spec.id)) return;
    const position = new THREE.Vector3(
      spec.position.x,
      spec.position.y,
      spec.position.z
    );

    let pickup: Pickup;
    switch (spec.kind) {
      case "weapon":
        pickup = new ArsenalPickup(this.scene,position,spec.weaponId);
        break;
      case "health":
        pickup = new HealthPickup(this.scene, position, spec.amount);
        break;
      case "ammo":
        pickup = new AmmoPickup(
          this.scene,
          position,
          toWeaponType(spec.weaponId),
          spec.amount
        );
        break;
      case "throwable":
        pickup = new ThrowablePickup(this.scene, position, spec.grenadeKind, spec.amount);
        break;
      default: {
        const unhandled: never = spec;
        throw new Error(`Unhandled pickup kind: ${String(unhandled)}`);
      }
    }
    this.serverPickups.set(spec.id, pickup);
    if (playSound) sfx.play("pickup:spawn", position);
  }

  private removeServerPickup(pickupId: string): void {
    const pickup = this.serverPickups.get(pickupId);
    if (!pickup) return;
    pickup.remove();
    this.serverPickups.delete(pickupId);
    this.pendingClaims.delete(pickupId);
  }

  private clearServerPickups(): void {
    for (const id of [...this.serverPickups.keys()]) {
      this.removeServerPickup(id);
    }
  }

  /**
   * Create a weapon pickup at the specified position (local: dropped weapon)
   */
  public createWeaponPickup(
    position: THREE.Vector3,
    weapon: Weapon,
    model: THREE.Object3D
  ): WeaponPickup {
    const pickup = new WeaponPickup(this.scene, position, weapon, model);
    this.localPickups.push(pickup);
    return pickup;
  }

  /**
   * Per frame: claim server pickups we are standing on, collect local ones,
   * advance hover animations.
   */
  public update(delta: number): void {
    this.claimNearbyServerPickups();
    this.collectLocalPickups();
    updatePickupEffects(this.scene, delta);

    // Update pickup animations
    if (window.__pickupAnimations && window.__pickupAnimations.length > 0) {
      // Update animations and remove any that return false
      window.__pickupAnimations = window.__pickupAnimations.filter((anim) =>
        anim(delta)
      );
    }
  }

  private claimNearbyServerPickups(): void {
    if (this.playerController.getHealth().isDead) return;
    const now = performance.now();
    const playerPos = this.player.position;

    for (const [id, pickup] of this.serverPickups) {
      const target = pickup.getMesh().position;
      if (!isWithinPickupReach(playerPos, target)) continue;

      const lastSent = this.pendingClaims.get(id);
      if (lastSent !== undefined && now - lastSent < CLAIM_RETRY_MS) continue;

      this.pendingClaims.set(id, now);
      this.net.send(GAME_EVENTS.PICKUP.CLAIM, { pickupId: id });
    }
  }

  private collectLocalPickups(): void {
    for (let i = this.localPickups.length - 1; i >= 0; i--) {
      const pickup = this.localPickups[i];

      if (pickup.hasExpired()) {
        pickup.remove();
        this.localPickups.splice(i, 1);
        continue;
      }

      const distance = this.player.position.distanceTo(
        pickup.getMesh().position
      );
      if (distance < this.collectionDistance) {
        const position = pickup.getMesh().position.clone();
        sfx.play("weapon:pickup", position);
        pickup.collect(this.playerController);
        this.localPickups.splice(i, 1);

        const weaponName = pickup.getMesh().userData.weaponName;
        if (this.hud && weaponName) {
          this.hud.showWeaponPickupNotification(weaponName);
        }
      }
    }
  }
}

/** Map a shared weapon id onto the client's WeaponType enum. */
function toWeaponType(weaponId: WeaponId): WeaponType {
  return weaponId as WeaponType;
}

// Add type declaration to window object
declare global {
  interface Window {
    __pickupAnimations?: ((delta: number) => boolean)[];
  }
}
