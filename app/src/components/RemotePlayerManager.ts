import * as THREE from "three";
import { addCharacterVisual, updateCharacterVisual, removeCharacterVisual, setCharacterDead } from "./CharacterVisual";
import type { NetworkClient } from "../net/NetworkClient";
import type { Replication, ReplicatedPlayer } from "../net/Replication";
import type { HUD } from "./HUD";
import { WeaponSystem } from "./Weapon";
import {
  GAME_EVENTS,
  type Team,
  type Vec3,
  type PlayerPose,
  type WeaponId,
} from "@threejs-shooter/shared";
import type { CollisionDetector } from "./CollisionInterface";
import { PlayerCollider, PLAYER_DIMENSIONS } from "./PlayerCollider";
import { PlayerUtils } from "./PlayerController";
import { PlayerNameplates } from "./PlayerNameplates";
import { sfx } from "../audio/sfx";
import { PLAYER_MAX_HP } from "@threejs-shooter/shared";

interface RemotePlayer {
  id: string;
  mesh: THREE.Mesh;
  currentHealth: number;
  isDead: boolean;
  weaponSystem: WeaponSystem;
  pose?: PlayerPose;
  /** Null until the first snapshot or join event names it. */
  team: Team | null;
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
  /** What remote players' cosmetic bullets stop on. */
  private readonly bulletStops: CollisionDetector;
  /** Floating name + health bar above every other player. */
  private concealed: (position: THREE.Vector3) => boolean = () => false;
  public setConcealmentTest(test: (position: THREE.Vector3) => boolean): void { this.concealed = test; }
  private readonly nameplates: PlayerNameplates;

  constructor(
    scene: THREE.Scene,
    hud: HUD,
    net: NetworkClient,
    replication: Replication,
    bulletStops: CollisionDetector
  ) {
    this.scene = scene;
    this.hud = hud;
    this.net = net;
    this.replication = replication;
    this.bulletStops = bulletStops;
    this.nameplates = new PlayerNameplates(scene);
    this.setupNetworkListeners();
  }

  private setupNetworkListeners(): void {
    const { net } = this;

    // Players already in the game when we joined. Our own entry is in here
    // too; the local player is rendered by PlayerController, not by us.
    net.on(GAME_EVENTS.GAME.STATE, ({ selfId, players }) => {
      // A re-join after a reconnect may have moved us to the other team, so
      // every teammate tag is re-evaluated against the fresh selfTeam.
      for (const player of this.players.values()) {
        if (player.team) this.nameplates.setTeam(player.id, player.team, this.isTeammate(player.team));
      }
      for (const snapshot of players) {
        if (snapshot.id === selfId) continue;
        const player = this.ensurePlayer(snapshot.id);
        if (snapshot.position) {
          player.mesh.position.set(
            snapshot.position.x,
            snapshot.position.y,
            snapshot.position.z
          );
          player.mesh.rotation.y = snapshot.rotation;
        }
        this.nameplates.setName(snapshot.id, snapshot.name);
        this.nameplates.setHealth(snapshot.id, snapshot.hp, PLAYER_MAX_HP);
        this.setTeam(player, snapshot.team);
        if (snapshot.status === "dead") {
          this.markDead(player);
        }
      }
    });

    net.on(GAME_EVENTS.USER.JOINED, ({ userId, name, team, position, rotation }) => {
      const player = this.ensurePlayer(userId);
      player.mesh.position.set(position.x, position.y, position.z);
      player.mesh.rotation.y = rotation;
      this.nameplates.setName(userId, name);
      this.setTeam(player, team);

      this.hud.showNotification(
        "user joined",
        "User connected",
        `${name} joined ${team === this.net.selfTeam ? "your team" : team}`,
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
    net.on(GAME_EVENTS.COMBAT.HIT, (event) => {
      if (event.targetId === net.selfId) return;

      sfx.play(
        "hit:other",
        new THREE.Vector3(
          event.position.x,
          event.position.y,
          event.position.z
        )
      );

      const { targetId, hp } = event;
      const player = this.players.get(targetId);
      if (!player) return;
      player.currentHealth = hp;
      this.nameplates.setHealth(targetId, hp, PLAYER_MAX_HP);
      if (hp <= 0 && !player.isDead) {
        sfx.play("death:other", player.mesh.position);
        this.handleRemoteDeath(targetId);
      }
    });

    net.on(GAME_EVENTS.PLAYER.RESPAWN, ({ playerId, position, rotation, hp }) => {
      if (playerId === net.selfId) return;
      this.handleRemoteRespawn(playerId, position, rotation, hp);
    });

    net.on(GAME_EVENTS.WEAPON.SWITCH, ({ userId, weaponType }) => {
      const player = this.players.get(userId);
      player?.weaponSystem.equipById(weaponType);
    });

    net.on(GAME_EVENTS.WEAPON.SHOOT, ({ userId, weaponType, data }) => {
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
      player.weaponSystem.equipById(weaponType);
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
    // The box is a collision proxy hidden behind the character visual; the
    // nameplate carries the team colour.
    const playerMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });

    const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
    playerMesh.userData.height = 1;
    playerMesh.position.set(0, 1, 0);
    playerMesh.castShadow = true;
    playerMesh.receiveShadow = true;
    this.scene.add(playerMesh);
    addCharacterVisual(playerMesh);
    this.nameplates.add(userId, playerMesh, "");

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
      team: null,
    };
    this.players.set(userId, player);
    return player;
  }

  private isTeammate(team: Team): boolean {
    return this.net.selfTeam === team;
  }

  private setTeam(player: RemotePlayer, team: Team): void {
    player.team = team;
    this.nameplates.setTeam(player.id, team, this.isTeammate(team));
  }

  private removePlayer(userId: string): void {
    const player = this.players.get(userId);
    if (!player) return;

    this.scene.remove(player.mesh);
    removeCharacterVisual(player.mesh);
    player.weaponSystem.dispose();
    this.nameplates.remove(userId);
    this.players.delete(userId);
  }

  private markDead(player: RemotePlayer): void {
    PlayerUtils.handlePlayerDeath(player.mesh);
    player.isDead = true;
    player.weaponSystem.setDead(true);
    this.nameplates.setVisible(player.id, false);
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

  private handleRemoteRespawn(
    userId: string,
    position: Vec3,
    rotation: number,
    hp: number
  ): void {
    const player = this.ensurePlayer(userId);
    const wasDead = player.isDead;
    player.isDead = false;
    player.pose = undefined;
    setCharacterDead(player.mesh, false);
    player.weaponSystem.setDead(false);
    player.currentHealth = hp;
    this.nameplates.setVisible(userId, true);
    this.nameplates.setHealth(userId, hp, PLAYER_MAX_HP);

    // Stand back up
    player.mesh.quaternion.identity();
    player.mesh.rotation.set(0, rotation, 0);
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
   * is, then advance cosmetic bullets and render nameplates.
   */
  public update(delta: number, camera: THREE.Camera): void {
    const states = this.replication.sample(performance.now());
    const selfId = this.net.selfId;

    for (const state of states.values()) {
      if (state.id === selfId) continue; // we own our own movement
      this.applyState(state);
    }

    for (const player of this.players.values()) {
      const pose = player.pose ?? { crouched: player.mesh.position.y < .8,
        grounded: player.mesh.position.y <= 1.03, reload: 0 };
      updateCharacterVisual(player.mesh, delta, pose);
      player.weaponSystem.setRemoteReload(pose.reload);
      player.weaponSystem.updatePresentation(delta, pose.crouched);
      player.weaponSystem.updateBullets(delta, this.bulletStops);
    }

    for (const player of this.players.values()) {
      this.nameplates.setVisible(player.id, !player.isDead && !this.concealed(player.mesh.position));
    }
    this.nameplates.render(camera);
  }

  private applyState(state: ReplicatedPlayer): void {
    const player = this.ensurePlayer(state.id);
    if (state.status === 'dead' && !player.isDead) this.markDead(player);
    if (player.isDead) return; // death pose is owned by the status event
    player.pose = state.pose;

    player.mesh.position.set(
      state.position.x,
      state.position.y,
      state.position.z
    );
    player.mesh.rotation.y = state.rotation;

    this.nameplates.setName(state.id, state.name);
    this.nameplates.setHealth(state.id, state.hp, PLAYER_MAX_HP);
    if (player.team !== state.team) this.setTeam(player, state.team);
  }

  /**
   * Convert weapon type to index
   */
  public getPlayers(): Map<string, RemotePlayer> {
    return this.players;
  }

  public clear(): void {
    for (const playerId of [...this.players.keys()]) {
      this.removePlayer(playerId);
    }
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
