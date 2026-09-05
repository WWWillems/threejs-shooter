import {
  GAME_EVENTS,
  PLAYER_MAX_HP,
  PLAYER_SIZE,
  WEAPONS,
  aabbFromCenterSize,
  aabbIntersects,
  carBox,
  crateBox,
  generateMap,
  integrateProjectile,
  isWeaponId,
  pickSpawnPoint,
  shopBox,
  spawnPellets,
  streetLightBox,
  type ClientEventName,
  type ClientPayload,
  type Collider,
  type DamageSource,
  type Leaderboard,
  type MapLayout,
  type PlayerPositionEvent,
  type PlayerSnapshot,
  type Projectile,
  type RespawnRequestEvent,
  type UserJoinedEvent,
  type Vec3,
  type WeaponEvent,
} from "@threejs-shooter/shared";
import type { RoomTransport } from "./transport";

/** What a server bullet can hit. */
export type WorldTag =
  | { kind: "static"; id: string }
  | { kind: "crate"; id: string }
  | { kind: "player"; id: string };

interface ServerPlayer extends PlayerSnapshot {
  /** Server clock (ms) of the last accepted shot. */
  lastShotAt: number;
  /** Fractional hazard damage not yet applied (see stepCarContact). */
  pendingHazardDamage: number;
}

/** Points awarded to the killer per kill. */
const KILL_SCORE = 100;
/** Damage per second while overlapping a car. */
const CAR_CONTACT_DPS = 20;
/** Accept shots slightly faster than the nominal fire rate to absorb network jitter. */
const FIRE_RATE_TOLERANCE = 0.85;

export interface GameRoomOptions {
  /** Server clock in ms. Injected for tests. */
  clock?: () => number;
  map?: MapLayout;
}

/**
 * The single source of truth for one game session.
 *
 * Pure TypeScript: no sockets, no timers. Inbound messages arrive through
 * `connect` / `applyIntent` / `leave`; outbound messages go through the
 * injected `RoomTransport`. `tick` advances the simulation by a fixed step.
 *
 * Authority: clients own their own movement (reported via `player:position`);
 * the server owns everything that affects others: bullets, HP, deaths,
 * respawns, the leaderboard.
 */
export class GameRoom {
  /** Last known state of every player who has joined, keyed by player id. */
  readonly players = new Map<string, ServerPlayer>();
  readonly leaderBoard: Leaderboard = {};
  readonly map: MapLayout;
  /** Bullets in flight. */
  readonly projectiles: Projectile[] = [];

  private readonly clock: () => number;
  private readonly staticColliders: Collider<WorldTag>[];
  private tickCount = 0;
  private nextProjectileId = 1;

  constructor(
    private readonly transport: RoomTransport,
    options: GameRoomOptions = {}
  ) {
    this.clock = options.clock ?? Date.now;
    this.map = options.map ?? generateMap();
    this.staticColliders = buildStaticColliders(this.map);
  }

  /** A transport-level connection was established; the player has not joined yet. */
  connect(playerId: string): void {
    this.transport.broadcast(
      GAME_EVENTS.USER.CONNECTED,
      { id: playerId, userId: playerId, message: "Welcome to the server" },
      playerId
    );
  }

  /** The connection dropped; remove the player if they had joined. */
  leave(playerId: string): void {
    const wasPlaying = this.players.delete(playerId);
    delete this.leaderBoard[playerId];

    if (!wasPlaying) return;

    this.transport.broadcast(
      GAME_EVENTS.USER.DISCONNECTED,
      { id: playerId, userId: playerId, message: "A player left" },
      playerId
    );
  }

  /** Route a client -> server event to its handler. */
  applyIntent<E extends ClientEventName>(
    playerId: string,
    event: E,
    payload: ClientPayload<E>
  ): void {
    switch (event) {
      case GAME_EVENTS.USER.JOINED:
        this.handleJoin(playerId, payload as UserJoinedEvent);
        break;
      case GAME_EVENTS.PLAYER.POSITION:
        this.handlePosition(playerId, payload as PlayerPositionEvent);
        break;
      case GAME_EVENTS.PLAYER.RESPAWN:
        this.handleRespawn(playerId, payload as RespawnRequestEvent);
        break;
      case GAME_EVENTS.WEAPON.SHOOT:
        this.handleShoot(playerId, payload as WeaponEvent);
        break;
      case GAME_EVENTS.WEAPON.SWITCH:
        this.handleWeaponSwitch(playerId, payload as WeaponEvent);
        break;
      default: {
        const unhandled: never = event;
        throw new Error(`Unhandled intent: ${String(unhandled)}`);
      }
    }
  }

  /**
   * Advance the simulation by `dt` seconds and broadcast the resulting
   * world snapshot. `now` is the server clock in ms.
   */
  tick(dt: number, now: number = this.clock()): void {
    this.tickCount += 1;
    this.stepProjectiles(dt);
    this.stepCarContact(dt);
    this.transport.broadcast(GAME_EVENTS.WORLD.SNAPSHOT, {
      tick: this.tickCount,
      serverTime: now,
      players: this.snapshotPlayers(),
    });
  }

  // ---- intents -----------------------------------------------------------

  private handleJoin(playerId: string, payload: UserJoinedEvent): void {
    const name = payload.name || `Player-${playerId.substring(0, 5)}`;

    // Sync the joiner with everyone already in the game, before registering them
    this.transport.send(playerId, GAME_EVENTS.GAME.STATE, {
      selfId: playerId,
      players: this.snapshotPlayers(),
    });

    this.players.set(playerId, {
      id: playerId,
      userId: playerId,
      name,
      status: "alive",
      hp: PLAYER_MAX_HP,
      position: payload.position,
      rotation: 0,
      lastShotAt: -Infinity,
      pendingHazardDamage: 0,
    });

    this.leaderBoard[playerId] = {
      id: playerId,
      userId: playerId,
      name,
      kills: 0,
      deaths: 0,
      score: 0,
    };

    this.transport.broadcast(
      GAME_EVENTS.USER.JOINED,
      { id: playerId, userId: playerId, ...payload, name },
      playerId
    );
  }

  private handlePosition(playerId: string, payload: PlayerPositionEvent): void {
    const player = this.players.get(playerId);
    if (!player || player.status === "dead") return;

    // Ingest only; positions reach other clients through the snapshot stream.
    player.position = payload.position;
    player.rotation = payload.rotation;
  }

  private handleRespawn(playerId: string, _payload: RespawnRequestEvent): void {
    const player = this.players.get(playerId);
    if (!player || player.status !== "dead") return;

    const others: Vec3[] = [];
    for (const other of this.players.values()) {
      if (other.id !== playerId && other.position) others.push(other.position);
    }
    const position = pickSpawnPoint(others);

    player.status = "alive";
    player.hp = PLAYER_MAX_HP;
    player.position = { ...position };
    player.rotation = 0;

    this.transport.broadcast(GAME_EVENTS.PLAYER.RESPAWN, {
      playerId,
      position,
      hp: player.hp,
    });
  }

  private handleShoot(playerId: string, payload: WeaponEvent): void {
    const player = this.players.get(playerId);
    if (!player || player.status !== "alive") return;
    if (!isWeaponId(payload.weaponType)) return;

    const origin = payload.data?.position;
    const direction = payload.data?.direction;
    if (!origin || !direction) return;

    const weapon = WEAPONS[payload.weaponType];
    const now = this.clock();
    const minInterval = weapon.fireRate * 1000 * FIRE_RATE_TOLERANCE;
    if (now - player.lastShotAt < minInterval) return; // firing too fast: drop
    player.lastShotAt = now;

    this.projectiles.push(
      ...spawnPellets(
        () => this.nextProjectileId++,
        playerId,
        weapon,
        origin,
        direction
      )
    );

    // Others draw a cosmetic bullet; the real one lives here.
    this.transport.broadcast(
      GAME_EVENTS.WEAPON.SHOOT,
      { id: playerId, userId: playerId, ...payload },
      playerId
    );
  }

  private handleWeaponSwitch(playerId: string, payload: WeaponEvent): void {
    if (!this.players.has(playerId)) return;

    this.transport.broadcast(
      GAME_EVENTS.WEAPON.SWITCH,
      { id: playerId, userId: playerId, ...payload },
      playerId
    );
  }

  // ---- simulation --------------------------------------------------------

  private stepProjectiles(dt: number): void {
    if (this.projectiles.length === 0) return;

    const colliders = [
      ...this.staticColliders,
      ...this.crateColliders(),
      ...this.playerColliders(),
    ];

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      const { hit, expired } = integrateProjectile(
        projectile,
        dt,
        colliders,
        (c) => c.tag.kind === "player" && c.tag.id === projectile.ownerId
      );

      if (hit && hit.collider.tag.kind === "player") {
        this.applyDamage(
          projectile.ownerId,
          hit.collider.tag.id,
          projectile.damage,
          projectile.weaponId,
          hit.point
        );
      }

      if (expired) this.projectiles.splice(i, 1);
    }
  }

  /**
   * Players standing inside a car take continuous contact damage. Damage is
   * accumulated per player and applied in whole points so the event stream
   * stays sparse.
   */
  private stepCarContact(dt: number): void {
    for (const player of this.players.values()) {
      if (player.status !== "alive" || !player.position) continue;
      const box = aabbFromCenterSize(player.position, PLAYER_SIZE);

      const car = this.map.cars.find((c) => aabbIntersects(box, carBox(c)));
      if (!car) {
        player.pendingHazardDamage = 0;
        continue;
      }

      player.pendingHazardDamage += CAR_CONTACT_DPS * dt;
      const whole = Math.floor(player.pendingHazardDamage);
      if (whole <= 0) continue;
      player.pendingHazardDamage -= whole;
      this.applyDamage(car.id, player.id, whole, "car", player.position);
    }
  }

  private applyDamage(
    shooterId: string,
    targetId: string,
    damage: number,
    source: DamageSource,
    position: Vec3
  ): void {
    const target = this.players.get(targetId);
    if (!target || target.status !== "alive") return;

    target.hp = Math.max(0, target.hp - damage);

    this.transport.broadcast(GAME_EVENTS.COMBAT.HIT, {
      shooterId,
      targetId,
      damage,
      hp: target.hp,
      source,
      position,
    });

    if (target.hp > 0) return;

    target.status = "dead";

    const killer = this.leaderBoard[shooterId];
    if (killer && shooterId !== targetId) {
      killer.kills += 1;
      killer.score += KILL_SCORE;
    }
    const victim = this.leaderBoard[targetId];
    if (victim) victim.deaths += 1;

    this.transport.broadcast(GAME_EVENTS.COMBAT.KILL, {
      killerId: shooterId,
      victimId: targetId,
      source,
    });
  }

  private crateColliders(): Collider<WorldTag>[] {
    return this.map.crates.map((crate) => ({
      box: crateBox(crate),
      tag: { kind: "crate", id: crate.id },
    }));
  }

  private playerColliders(): Collider<WorldTag>[] {
    const colliders: Collider<WorldTag>[] = [];
    for (const player of this.players.values()) {
      if (player.status !== "alive" || !player.position) continue;
      colliders.push({
        box: aabbFromCenterSize(player.position, PLAYER_SIZE),
        tag: { kind: "player", id: player.id },
      });
    }
    return colliders;
  }

  private snapshotPlayers(): PlayerSnapshot[] {
    return [...this.players.values()].map(
      ({ id, userId, name, status, hp, position, rotation }) => ({
        id,
        userId,
        name,
        status,
        hp,
        position,
        rotation,
      })
    );
  }
}

function buildStaticColliders(map: MapLayout): Collider<WorldTag>[] {
  const colliders: Collider<WorldTag>[] = [];
  map.walls.forEach((box, i) =>
    colliders.push({ box, tag: { kind: "static", id: `wall-${i}` } })
  );
  colliders.push({ box: shopBox(map), tag: { kind: "static", id: "shop" } });
  for (const car of map.cars) {
    colliders.push({ box: carBox(car), tag: { kind: "static", id: car.id } });
  }
  map.streetLights.forEach((base, i) =>
    colliders.push({
      box: streetLightBox(base),
      tag: { kind: "static", id: `light-${i}` },
    })
  );
  return colliders;
}
