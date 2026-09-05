import * as THREE from "three";
import type { NetworkClient } from "../net/NetworkClient";
import type { Replication, ReplicatedPlayer } from "../net/Replication";
import type { HUD } from "./HUD";
import { WeaponSystem } from "./Weapon";
import {
  GAME_EVENTS,
  type Vec3,
  type WeaponId,
} from "@threejs-shooter/shared";
import type { CollisionDetector } from "./CollisionInterface";
import { PlayerCollider, PLAYER_DIMENSIONS } from "./PlayerCollider";
import { PlayerUtils } from "./PlayerController";

interface RemotePlayer {
  id: string;
  mesh: THREE.Mesh;
  currentHealth: number;
  isDead: boolean;
  weaponSystem: WeaponSystem;
}

/**
 * Presentation of other players. Continuous state (position, rotation) is
 * read from `Replication` every frame; discrete changes (join, leave, death,
 * respawn, weapon switch, shots) arrive as events.
 */
export class RemotePlayerManager {
  private players: Map<string, RemotePlayer> = new Map();
  private scene: THREE.Scene;
  private hud: HUD;
  private net: NetworkClient;
  private replication: Replication;
  private collisionDetector?: CollisionDetector;

  constructor(
    scene: THREE.Scene,
    hud: HUD,
    net: NetworkClient,
    replication: Replication,
    collisionDetector?: CollisionDetector
  ) {
    this.scene = scene;
    this.hud = hud;
    this.net = net;
    this.replication = replication;
    this.collisionDetector = collisionDetector;
    this.setupNetworkListeners();
  }

  private setupNetworkListeners(): void {
    const { net } = this;

    // Players already in the game when we joined
    net.on(GAME_EVENTS.GAME.STATE, ({ players }) => {
      for (const snapshot of players) {
        const player = this.ensurePlayer(snapshot.id);
        if (snapshot.position) {
          player.mesh.position.set(
            snapshot.position.x,
            snapshot.position.y,
            snapshot.position.z
          );
          player.mesh.rotation.y = snapshot.rotation;
        }
        if (snapshot.status === "dead") {
          this.markDead(player);
        }
      }
    });

    net.on(GAME_EVENTS.USER.JOINED, ({ userId, name, position }) => {
      const player = this.ensurePlayer(userId);
      player.mesh.position.set(position.x, position.y, position.z);

      this.hud.showNotification(
        "user joined",
        "User connected",
        `${name} joined`,
        "👋"
      );
    });

    net.on(GAME_EVENTS.USER.DISCONNECTED, ({ message, userId }) => {
      this.removePlayer(userId);

      this.hud.showNotification(
        "user disconnected",
        "User disconnected",
        message,
        "👋"
      );
    });

    // Server-resolved outcomes. The local player's own hits/respawns are
    // handled by PlayerController; we only mirror other players here.
    net.on(GAME_EVENTS.COMBAT.HIT, ({ targetId, hp }) => {
      if (targetId === net.selfId) return;
      const player = this.players.get(targetId);
      if (!player) return;
      player.currentHealth = hp;
      if (hp <= 0) this.handleRemoteDeath(targetId);
    });

    net.on(GAME_EVENTS.PLAYER.RESPAWN, ({ playerId, position, hp }) => {
      if (playerId === net.selfId) return;
      this.handleRemoteRespawn(playerId, position, hp);
    });

    net.on(GAME_EVENTS.WEAPON.SWITCH, ({ userId, weaponType }) => {
      const player = this.players.get(userId);
      player?.weaponSystem.switchToWeapon(this.getWeaponIndex(weaponType));
    });

    net.on(GAME_EVENTS.WEAPON.SHOOT, ({ userId, data }) => {
      const player = this.players.get(userId);
      if (!player || !data?.position || !data?.direction) {
        console.warn("Invalid remote shoot data:", { player, data });
        return;
      }

      const position = new THREE.Vector3(
        data.position.x,
        data.position.y,
        data.position.z
      );
      const direction = new THREE.Vector3(
        data.direction.x,
        data.direction.y,
        data.direction.z
      );
      // Cosmetic bullet at the remote player's barrel
      player.weaponSystem.shootRemote(this.scene, position, direction);
    });
  }

  /** Get the remote player, creating its mesh if this is the first we hear of it. */
  private ensurePlayer(userId: string): RemotePlayer {
    const existing = this.players.get(userId);
    if (existing) return existing;

    const playerGeometry = new THREE.BoxGeometry(
      PLAYER_DIMENSIONS.width,
      PLAYER_DIMENSIONS.height,
      PLAYER_DIMENSIONS.depth
    );
    // Generate a unique but consistent color based on userId
    const hue = this.getHueFromString(userId);
    const playerMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.8, 0.5),
    });

    const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
    playerMesh.userData.height = 1;
    playerMesh.position.set(0, 1, 0);
    playerMesh.castShadow = true;
    playerMesh.receiveShadow = true;
    this.scene.add(playerMesh);

    // Remote weapon systems have no network client: they mirror server events
    // and never echo them back.
    const weaponSystem = new WeaponSystem(this.scene, playerMesh, null);
    weaponSystem.switchToWeapon(0);
    weaponSystem.updateWeaponPosition(false);

    const player: RemotePlayer = {
      id: userId,
      mesh: playerMesh,
      currentHealth: 100,
      isDead: false,
      weaponSystem,
    };
    this.players.set(userId, player);
    return player;
  }

  private removePlayer(userId: string): void {
    const player = this.players.get(userId);
    if (!player) return;

    this.scene.remove(player.mesh);
    this.players.delete(userId);
  }

  private markDead(player: RemotePlayer): void {
    PlayerUtils.handlePlayerDeath(player.mesh);
    player.isDead = true;
  }

  private handleRemoteDeath(userId: string): void {
    const player = this.players.get(userId);
    if (!player || player.isDead) return;

    this.markDead(player);
    this.hud.showNotification(
      `status-${userId}`,
      "Player Died",
      "Player has died",
      "💀"
    );
  }

  private handleRemoteRespawn(userId: string, position: Vec3, hp: number): void {
    const player = this.ensurePlayer(userId);
    const wasDead = player.isDead;
    player.isDead = false;
    player.currentHealth = hp;

    // Stand back up
    player.mesh.quaternion.identity();
    player.mesh.rotation.set(0, 0, 0);
    player.mesh.position.set(position.x, position.y, position.z);
    player.mesh.updateMatrix();

    if (wasDead) {
      this.hud.showNotification(
        `status-${userId}`,
        "Player Respawned",
        "Player has respawned",
        "🔄"
      );
    }
  }

  /**
   * Per-frame: place every remote player where the replicated world says it
   * is, then advance cosmetic bullets.
   */
  public update(delta: number): void {
    const states = this.replication.sample(performance.now());
    const selfId = this.net.selfId;

    for (const state of states.values()) {
      if (state.id === selfId) continue; // we own our own movement
      this.applyState(state);
    }

    for (const player of this.players.values()) {
      player.weaponSystem.updateWeaponPosition(false);
      player.weaponSystem.updateBullets(delta, this.collisionDetector);
    }
  }

  private applyState(state: ReplicatedPlayer): void {
    const player = this.ensurePlayer(state.id);
    if (player.isDead) return; // death pose is owned by the status event

    player.mesh.position.set(
      state.position.x,
      state.position.y,
      state.position.z
    );
    player.mesh.rotation.y = state.rotation;
  }

  /**
   * Generate a hue value (0-1) from a string consistently
   */
  private getHueFromString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return (Math.abs(hash) % 360) / 360;
  }

  /**
   * Convert weapon type to index
   */
  private getWeaponIndex(weaponType: WeaponId): number {
    switch (weaponType) {
      case "pistol":
        return 0;
      case "rifle":
        return 1;
      case "shotgun":
        return 2;
      default: {
        const unhandled: never = weaponType;
        throw new Error(`Unhandled weapon id: ${String(unhandled)}`);
      }
    }
  }

  public getPlayers(): Map<string, RemotePlayer> {
    return this.players;
  }

  public clear(): void {
    for (const playerId of [...this.players.keys()]) {
      this.removePlayer(playerId);
    }
  }

  public setCollisionDetector(detector: CollisionDetector): void {
    this.collisionDetector = detector;
  }

  /**
   * Whether a point is inside any living remote player. Used to stop cosmetic
   * bullets; damage is the server's call.
   */
  public containsPoint(point: THREE.Vector3): boolean {
    for (const player of this.players.values()) {
      if (player.isDead) continue;
      if (PlayerCollider.containsPoint(player.mesh, point)) return true;
    }
    return false;
  }
}
