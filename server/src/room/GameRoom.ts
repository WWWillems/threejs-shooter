import {
  CRATE_DROP_CHANCE,
  CRATE_MAX_HP,
  GAME_EVENTS,
  GRENADE,
  PICKUP_LIFETIME,
  PICKUP_MAX_COUNT,
  PICKUP_SPAWN_INTERVAL,
  PLAYER_MAX_HP,
  PLAYER_SIZE,
  Rng,
  WEAPONS,
  aabbCenter,
  aabbFromCenterSize,
  aabbIntersects,
  blastDamage,
  carBox,
  crateBox,
  findPickupSpawnPosition,
  facingCenterYaw,
  generateMap,
  integrateGrenade,
  integrateProjectile,
  isWeaponId,
  isWithinPickupReach,
  pickSpawnPoint,
  playerCollider,
  rollCrateDrop,
  rollPickupContents,
  sanitizeNickname,
  solidColliders,
  spawnGrenade,
  spawnPellets,
  type ClientEventName,
  type ClientPayload,
  type Collider,
  type CrateSpec,
  type CrateState,
  type DamageSource,
  type Grenade,
  type GrenadeSnapshot,
  type GrenadeThrowEvent,
  type Leaderboard,
  type MapLayout,
  type PickupClaimEvent,
  type PickupSpec,
  type StaticTag,
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
  | StaticTag
  | { kind: "crate"; id: string }
  | { kind: "player"; id: string };

interface ServerPlayer extends PlayerSnapshot {
  /** Server clock (ms) of the last accepted shot. */
  lastShotAt: number;
  /** Server clock (ms) of the last accepted grenade throw. */
  lastThrowAt: number;
  /** Fractional hazard damage not yet applied (see stepCarContact). */
  pendingHazardDamage: number;
}

interface ServerCrate {
  spec: CrateSpec;
  hp: number;
}

interface ServerPickup {
  spec: PickupSpec;
  /** Server clock (ms) at which the pickup disappears. */
  expiresAt: number;
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
  /** Seed for the room's own randomness (pickup rolls). Injected for tests. */
  seed?: number;
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
 * respawns, the leaderboard, crate HP and pickups.
 */
export class GameRoom {
  /** Last known state of every player who has joined, keyed by player id. */
  readonly players = new Map<string, ServerPlayer>();
  readonly leaderBoard: Leaderboard = {};
  readonly map: MapLayout;
  /** Bullets in flight. */
  readonly projectiles: Projectile[] = [];
  /** Grenades in flight or resting, keyed by grenade id. */
  readonly grenades = new Map<string, Grenade>();
  /** Surviving crates keyed by crate id. */
  readonly crates = new Map<string, ServerCrate>();
  /** Pickups lying in the world keyed by pickup id. */
  readonly pickups = new Map<string, ServerPickup>();

  private readonly clock: () => number;
  private readonly rng: Rng;
  /** Shared solid geometry; crates and players are added per query. */
  private readonly staticColliders: Collider<WorldTag>[];
  private tickCount = 0;
  private nextProjectileId = 1;
  private nextPickupId = 1;
  private nextGrenadeId = 1;
  /** Seconds until the next random pickup spawn. */
  private pickupSpawnIn: number;

  constructor(
    private readonly transport: RoomTransport,
    options: GameRoomOptions = {}
  ) {
    this.clock = options.clock ?? Date.now;
    this.rng = new Rng(options.seed ?? (Date.now() & 0xffffffff));
    this.map = options.map ?? generateMap();
    this.staticColliders = solidColliders(this.map);
    for (const spec of this.map.crates) {
      this.crates.set(spec.id, { spec, hp: CRATE_MAX_HP });
    }
    this.pickupSpawnIn = this.rollPickupSpawnDelay();
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
      case GAME_EVENTS.PICKUP.CLAIM:
        this.handlePickupClaim(playerId, payload as PickupClaimEvent);
        break;
      case GAME_EVENTS.GRENADE.THROW:
        this.handleGrenadeThrow(playerId, payload as GrenadeThrowEvent);
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
    this.stepGrenades(dt);
    this.stepCarContact(dt);
    this.stepPickups(dt, now);
    this.transport.broadcast(GAME_EVENTS.WORLD.SNAPSHOT, {
      tick: this.tickCount,
      serverTime: now,
      players: this.snapshotPlayers(),
      grenades: this.snapshotGrenades(),
    });
  }

  // ---- intents -----------------------------------------------------------

  private handleJoin(playerId: string, payload: UserJoinedEvent): void {
    const name = sanitizeNickname(payload.name);

    // Sync the joiner with everyone already in the game, before registering them
    this.transport.send(playerId, GAME_EVENTS.GAME.STATE, {
      selfId: playerId,
      players: this.snapshotPlayers(),
      crates: this.snapshotCrates(),
      pickups: [...this.pickups.values()].map((p) => p.spec),
    });

    this.players.set(playerId, {
      id: playerId,
      userId: playerId,
      name,
      status: "alive",
      hp: PLAYER_MAX_HP,
      position: payload.position,
      rotation: facingCenterYaw(payload.position),
      positionAt: this.clock(),
      lastShotAt: -Infinity,
      lastThrowAt: -Infinity,
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
    player.positionAt = this.clock();
  }

  private handleRespawn(playerId: string, _payload: RespawnRequestEvent): void {
    const player = this.players.get(playerId);
    if (!player || player.status !== "dead") return;

    const others: Vec3[] = [];
    for (const other of this.players.values()) {
      if (other.id !== playerId && other.position) others.push(other.position);
    }
    const position = pickSpawnPoint(others, this.map.spawnPoints);

    player.status = "alive";
    player.hp = PLAYER_MAX_HP;
    player.position = { ...position };
    player.rotation = facingCenterYaw(position);
    player.positionAt = this.clock();

    this.transport.broadcast(GAME_EVENTS.PLAYER.RESPAWN, {
      playerId,
      position,
      hp: player.hp,
      rotation: player.rotation,
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

  private handlePickupClaim(playerId: string, payload: PickupClaimEvent): void {
    const player = this.players.get(playerId);
    if (!player || player.status !== "alive" || !player.position) return;

    const pickup = this.pickups.get(payload.pickupId);
    if (!pickup) return; // already taken or expired: first claim wins
    if (!isWithinPickupReach(player.position, pickup.spec.position)) return;

    this.pickups.delete(pickup.spec.id);

    switch (pickup.spec.kind) {
      case "health":
        player.hp = Math.min(PLAYER_MAX_HP, player.hp + pickup.spec.amount);
        break;
      case "ammo":
        // Ammo is client-trusted for now; the claimant applies it locally.
        break;
      default: {
        const unhandled: never = pickup.spec;
        throw new Error(`Unhandled pickup kind: ${String(unhandled)}`);
      }
    }

    this.transport.broadcast(GAME_EVENTS.PICKUP.TAKEN, {
      pickup: pickup.spec,
      playerId,
      hp: player.hp,
    });
  }

  private handleGrenadeThrow(playerId: string, payload: GrenadeThrowEvent): void {
    const player = this.players.get(playerId);
    if (!player || player.status !== "alive") return;
    if (!payload.position || !payload.direction) return;

    const now = this.clock();
    if (now - player.lastThrowAt < GRENADE.throwCooldown * 1000) return;
    player.lastThrowAt = now;

    const id = `grenade-${this.nextGrenadeId++}`;
    this.grenades.set(
      id,
      spawnGrenade(id, playerId, payload.position, payload.direction)
    );

    // Others play the throw animation; the grenade itself arrives via snapshots.
    this.transport.broadcast(
      GAME_EVENTS.GRENADE.THROW,
      { id: playerId, userId: playerId, ...payload },
      playerId
    );
  }

  // ---- simulation --------------------------------------------------------

  private stepGrenades(dt: number): void {
    if (this.grenades.size === 0) return;

    // Grenades bounce off the world and crates, not off players.
    const colliders = [...this.staticColliders, ...this.crateColliders()];

    for (const grenade of this.grenades.values()) {
      integrateGrenade(grenade, dt, colliders);
      if (grenade.fuse <= 0) this.explodeGrenade(grenade);
    }
  }

  private explodeGrenade(grenade: Grenade): void {
    this.grenades.delete(grenade.id);
    const center = grenade.position;
    const hits: { targetId: string; damage: number }[] = [];

    // Players: `position` is the body centre, same as the player collider
    for (const player of this.players.values()) {
      if (player.status !== "alive" || !player.position) continue;
      const damage = blastDamage(center, player.position);
      if (damage <= 0) continue;
      hits.push({ targetId: player.id, damage });
    }

    // Crates
    for (const crate of this.crates.values()) {
      const damage = blastDamage(center, aabbCenter(crateBox(crate.spec)));
      if (damage <= 0) continue;
      hits.push({ targetId: crate.spec.id, damage });
    }

    this.transport.broadcast(GAME_EVENTS.GRENADE.EXPLODED, {
      grenadeId: grenade.id,
      ownerId: grenade.ownerId,
      position: center,
      hits,
    });

    // Apply through the same paths bullets use so HP, kills and drops stay consistent.
    for (const { targetId, damage } of hits) {
      if (this.players.has(targetId)) {
        this.applyDamage(grenade.ownerId, targetId, damage, "grenade", center);
      } else {
        this.damageCrate(targetId, damage);
      }
    }
  }

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

      if (hit) {
        switch (hit.collider.tag.kind) {
          case "player":
            this.applyDamage(
              projectile.ownerId,
              hit.collider.tag.id,
              projectile.damage,
              projectile.weaponId,
              hit.point
            );
            break;
          case "crate":
            this.damageCrate(hit.collider.tag.id, projectile.damage);
            break;
          case "static":
            break;
          default: {
            const unhandled: never = hit.collider.tag;
            throw new Error(`Unhandled collider tag: ${String(unhandled)}`);
          }
        }
      }

      if (expired) this.projectiles.splice(i, 1);
    }
  }

  /** Apply damage to a crate; destroy it and maybe drop a pickup at zero HP. */
  damageCrate(crateId: string, damage: number): void {
    const crate = this.crates.get(crateId);
    if (!crate) return;

    crate.hp = Math.max(0, crate.hp - damage);
    this.transport.broadcast(GAME_EVENTS.CRATE.DAMAGED, {
      crateId,
      damage,
      hp: crate.hp,
      maxHp: CRATE_MAX_HP,
    });

    if (crate.hp > 0) return;

    this.crates.delete(crateId);
    const position = crate.spec.position;
    this.transport.broadcast(GAME_EVENTS.CRATE.DESTROYED, { crateId, position });

    if (this.rng.next() < CRATE_DROP_CHANCE) {
      this.spawnPickup(
        rollCrateDrop(this.rng, this.allocatePickupId(), {
          x: position.x,
          y: 0.5,
          z: position.z,
        })
      );
    }
  }

  /** Expire old pickups and spawn new ones on the random cadence. */
  private stepPickups(dt: number, now: number): void {
    for (const pickup of this.pickups.values()) {
      if (now < pickup.expiresAt) continue;
      this.pickups.delete(pickup.spec.id);
      this.transport.broadcast(GAME_EVENTS.PICKUP.EXPIRED, {
        pickupId: pickup.spec.id,
      });
    }

    this.pickupSpawnIn -= dt;
    if (this.pickupSpawnIn > 0) return;
    this.pickupSpawnIn = this.rollPickupSpawnDelay();
    if (this.pickups.size >= PICKUP_MAX_COUNT) return;

    const blockers = [
      ...this.staticColliders.map((c) => c.box),
      ...this.crateColliders().map((c) => c.box),
    ];
    const playerPositions: Vec3[] = [];
    for (const player of this.players.values()) {
      if (player.position) playerPositions.push(player.position);
    }
    const position = findPickupSpawnPosition(this.rng, blockers, playerPositions);
    if (!position) return;

    this.spawnPickup(rollPickupContents(this.rng, this.allocatePickupId(), position));
  }

  private spawnPickup(spec: PickupSpec): void {
    this.pickups.set(spec.id, {
      spec,
      expiresAt: this.clock() + PICKUP_LIFETIME * 1000,
    });
    this.transport.broadcast(GAME_EVENTS.PICKUP.SPAWNED, spec);
  }

  private allocatePickupId(): string {
    return `pickup-${this.nextPickupId++}`;
  }

  private rollPickupSpawnDelay(): number {
    const [min, max] = PICKUP_SPAWN_INTERVAL;
    return this.rng.range(min, max);
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
    return [...this.crates.values()].map(({ spec }) => ({
      box: crateBox(spec),
      tag: { kind: "crate", id: spec.id },
    }));
  }

  private snapshotGrenades(): GrenadeSnapshot[] {
    return [...this.grenades.values()].map(({ id, ownerId, position }) => ({
      id,
      ownerId,
      position,
    }));
  }

  private snapshotCrates(): CrateState[] {
    return [...this.crates.values()].map(({ spec, hp }) => ({
      id: spec.id,
      hp,
    }));
  }

  private playerColliders(): Collider<WorldTag>[] {
    const colliders: Collider<WorldTag>[] = [];
    for (const player of this.players.values()) {
      if (player.status !== "alive" || !player.position) continue;
      colliders.push(
        playerCollider(player.position, player.rotation, {
          kind: "player",
          id: player.id,
        })
      );
    }
    return colliders;
  }

  private snapshotPlayers(): PlayerSnapshot[] {
    return [...this.players.values()].map(
      ({ id, userId, name, status, hp, position, rotation, positionAt }) => ({
        id,
        userId,
        name,
        status,
        hp,
        position,
        rotation,
        positionAt,
      })
    );
  }
}
