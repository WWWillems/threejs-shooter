import {
  CRATE_DROP_CHANCE,
  CRATE_MAX_HP,
  DEFAULT_MATCH_RULES,
  GAME_EVENTS,
  CLOUD_EFFECTS,
  GRENADE,
  PICKUP_LIFETIME,
  PICKUP_MAX_COUNT,
  PICKUP_SPAWN_INTERVAL,
  PLAYER_MAX_HP,
  PLAYER_SIZE,
  Rng,
  WEAPONS,
  aabbFromCenterSize,
  aabbIntersects,
  carBox,
  cloudContains,
  combatAllowed,
  crateBox,
  emptyTeamScores,
  findPickupSpawnPosition,
  facingCenterYaw,
  generateMap,
  initialMatchState,
  integrateGrenade,
  integrateProjectile,
  isGrenadeKind,
  isWeaponId,
  isWithinPickupReach,
  movementAllowed,
  pickSpawnPoint,
  pickTeam,
  playerCollider,
  rollCrateDrop,
  rollPickupContents,
  sanitizeNickname,
  shattersOnImpact,
  solidColliders,
  spawnCloud,
  spawnGrenade,
  spawnPellets,
  spawnPointsFor,
  stepMatch,
  type ClientEventName,
  type ClientPayload,
  type ChatMessageIntent,
  type Cloud,
  type CloudSnapshot,
  type Collider,
  type CrateSpec,
  type CrateState,
  type DamageSource,
  type GameStateEvent,
  type Grenade,
  type GrenadeSnapshot,
  type GrenadeThrowEvent,
  type Leaderboard,
  type LeaderboardResponse,
  type MapLayout,
  type MatchPhaseEvent,
  type MatchRules,
  type MatchSnapshot,
  type MatchState,
  type MatchTransition,
  type PickupClaimEvent,
  type PickupSpec,
  type PlayerPositionEvent,
  type PlayerSnapshot,
  type Projectile,
  type RespawnRequestEvent,
  type Team,
  type TeamCounts,
  type TeamScores,
  type UserJoinedEvent,
  type Vec3,
  type WeaponEvent,
} from "@threejs-shooter/shared";
import type { RoomTransport } from "./transport";
import { InteractiveWorld, interactionBoxes } from "@threejs-shooter/shared";
import {
  planChangesGeometry,
  resolveArcHit,
  resolveGrenadeExplosion,
  resolveProjectileHit,
  resolveRocketBlast,
  type CombatColliderTag,
  type CombatResolutionPlan,
  type CombatWorldView,
} from "./outcomeResolution";

interface ServerPlayer extends PlayerSnapshot {
  /** Server clock (ms) of the last accepted shot. */
  lastShotAt: number;
  /** Server clock (ms) of the last accepted grenade throw. */
  lastThrowAt: number;
  /** Server clock (ms) of the last accepted chat message. */
  lastChatAt: number;
  /** Fractional hazard damage not yet applied (see stepCarContact). */
  pendingHazardDamage: number;
  /** Fractional gas or fire damage not yet applied (see stepClouds). */
  pendingCloudDamage: number;
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
const CHAT_MESSAGE_MAX_LENGTH = 128;
const CHAT_RATE_LIMIT_MS = 500;

export interface GameRoomOptions {
  /** Server clock in ms. Injected for tests. */
  clock?: () => number;
  map?: MapLayout;
  /** Seed for the room's own randomness (pickup rolls). Injected for tests. */
  seed?: number;
  /** Round length, kill limit and phase durations. Overridden in tests. */
  matchRules?: MatchRules;
}

/**
 * The single source of truth for one game session.
 *
 * Pure TypeScript: no sockets, no timers. Inbound messages arrive through
 * `connect` / `applyIntent` / `leave`; outbound messages go through the
 * injected `RoomTransport`. `tick` advances the simulation by a fixed step.
 *
 * Authority: clients own their own movement (reported via `player:position`);
 * the server owns everything that affects others: team assignment, spawns,
 * bullets, HP, deaths, respawns, the leaderboard, crate HP, pickups and the
 * match phase (see `shared/sim/match.ts`).
 */
export class GameRoom {
  /** Last known state of every player who has joined, keyed by player id. */
  readonly players = new Map<string, ServerPlayer>();
  /** This round's per-player rows; zeroed on every round reset. */
  readonly leaderBoard: Leaderboard = {};
  /**
   * Kills per team this round. Kept apart from the per-player rows so a
   * leaver's kills stay on the board until the reset.
   */
  readonly teamScores: TeamScores = emptyTeamScores();
  /** Where the round loop stands. Advanced once per tick by `stepMatch`. */
  match: MatchState = initialMatchState();
  readonly map: MapLayout;
  readonly interactions: InteractiveWorld;
  /** Bullets in flight. */
  readonly projectiles: Projectile[] = [];
  /** Grenades in flight or resting, keyed by grenade id. */
  readonly grenades = new Map<string, Grenade>();
  /** Smoke and gas clouds left by grenades, keyed by cloud id. */
  readonly clouds = new Map<string, Cloud>();
  /** Surviving crates keyed by crate id. */
  readonly crates = new Map<string, ServerCrate>();
  /** Pickups lying in the world keyed by pickup id. */
  readonly pickups = new Map<string, ServerPickup>();

  private readonly clock: () => number;
  private readonly rng: Rng;
  private readonly matchRules: MatchRules;
  /** Shared solid geometry; crates and players are added per query. */
  private readonly staticColliders: Collider<CombatColliderTag>[];
  private tickCount = 0;
  private nextProjectileId = 1;
  private nextPickupId = 1;
  private nextGrenadeId = 1;
  private nextChatMessageId = 1;
  /** Seconds until the next random pickup spawn. */
  private pickupSpawnIn: number;

  constructor(
    private readonly transport: RoomTransport,
    options: GameRoomOptions = {}
  ) {
    this.clock = options.clock ?? Date.now;
    this.rng = new Rng(options.seed ?? (Date.now() & 0xffffffff));
    this.map = options.map ?? generateMap();
    this.matchRules = options.matchRules ?? DEFAULT_MATCH_RULES;
    this.staticColliders = solidColliders(this.map);
    this.interactions = new InteractiveWorld(this.map.props);
    this.resetCrates();
    this.pickupSpawnIn = this.rollPickupSpawnDelay();
  }

  /** What `GET /leaderboard` serves. */
  leaderboardResponse(): LeaderboardResponse {
    return {
      players: this.leaderBoard,
      teams: { ...this.teamScores },
      match: this.snapshotMatch(),
    };
  }

  /** How many joined players each team has right now. */
  teamCounts(): TeamCounts {
    const counts: TeamCounts = { blue: 0, red: 0 };
    for (const player of this.players.values()) counts[player.team] += 1;
    return counts;
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
      case GAME_EVENTS.WORLD.INTERACT: {
        const player = this.players.get(playerId);
        const id = (payload as {id?:unknown})?.id;
        if (player && typeof id === "string" && combatAllowed(this.match.phase)) this.interactions.interact(id, player, [...this.players.values()]);
        break;
      }
      case GAME_EVENTS.USER.JOINED:
        this.handleJoin(playerId, payload as UserJoinedEvent);
        break;
      case GAME_EVENTS.CHAT.MESSAGE:
        this.handleChatMessage(playerId, payload as ChatMessageIntent);
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
    this.interactions.tick(dt, [...this.players.values()], combatAllowed(this.match.phase));
    this.stepProjectiles(dt);
    this.stepGrenades(dt);
    this.stepClouds(dt);
    this.stepCarContact(dt);
    this.stepPickups(dt, now);
    this.stepMatch(now);
    this.transport.broadcast(GAME_EVENTS.WORLD.SNAPSHOT, {
      tick: this.tickCount,
      serverTime: now,
      players: this.snapshotPlayers(),
      grenades: this.snapshotGrenades(),
      clouds: this.snapshotClouds(),
      interactions: this.interactions.snapshot(),
      match: this.snapshotMatch(),
    });
  }

  // ---- match pacing ------------------------------------------------------

  /** Advance the round loop and carry out whatever transition it reports. */
  private stepMatch(now: number): void {
    const { state, transition } = stepMatch(
      this.match,
      { now, teamCounts: this.teamCounts(), teamScores: this.teamScores },
      this.matchRules
    );
    this.match = state;
    if (!transition) return;
    if (transition.reset) this.resetWorld();
    this.transport.broadcast(GAME_EVENTS.MATCH.PHASE, this.matchPhaseEvent(transition));
  }

  private matchPhaseEvent(transition: MatchTransition): MatchPhaseEvent {
    const base = this.snapshotMatch();
    const result = this.match.result;
    if (transition.to !== "round-end" || !result) return base;
    return {
      ...base,
      result: { ...result, leaderboard: Object.values(this.leaderBoard) },
    };
  }

  /**
   * A new round starts: scores, players, crates, pickups, grenades and
   * bullets all go back to their initial state, then every player gets an
   * authoritative full sync to rebuild their world from.
   */
  private resetWorld(): void {
    this.interactions.reset();
    this.teamScores.blue = 0;
    this.teamScores.red = 0;
    for (const row of Object.values(this.leaderBoard)) {
      row.kills = 0;
      row.deaths = 0;
      row.score = 0;
    }

    this.projectiles.length = 0;
    this.grenades.clear();
    this.clouds.clear();
    this.pickups.clear();
    this.pickupSpawnIn = this.rollPickupSpawnDelay();
    this.resetCrates();

    for (const player of this.players.values()) {
      this.placeAtSpawn(player);
      player.lastShotAt = -Infinity;
      player.lastThrowAt = -Infinity;
      player.pendingHazardDamage = 0;
      player.pendingCloudDamage = 0;
    }

    for (const playerId of this.players.keys()) {
      this.transport.send(playerId, GAME_EVENTS.GAME.STATE, this.gameStateFor(playerId));
    }
  }

  private resetCrates(): void {
    this.crates.clear();
    for (const spec of this.map.crates) {
      this.crates.set(spec.id, { spec, hp: CRATE_MAX_HP });
    }
  }

  /** Stand `player` up, alive with full HP, on their team's spawn street. */
  private placeAtSpawn(player: ServerPlayer): Vec3 {
    const position = this.pickSpawnFor(player.team, player.id);
    player.status = "alive";
    player.pose = undefined;
    player.hp = PLAYER_MAX_HP;
    player.armor = 0;
    player.position = { ...position };
    player.rotation = facingCenterYaw(position);
    player.positionAt = this.clock();
    return position;
  }

  private gameStateFor(playerId: string): GameStateEvent {
    return {
      selfId: playerId,
      interactions: this.interactions.snapshot(),
      players: this.snapshotPlayers(),
      crates: this.snapshotCrates(),
      pickups: [...this.pickups.values()].map((p) => p.spec),
      match: { ...this.snapshotMatch(), result: this.match.result },
    };
  }

  private snapshotMatch(): MatchSnapshot {
    return {
      phase: this.match.phase,
      phaseEndsAt: this.match.phaseEndsAt,
      teamScores: { ...this.teamScores },
    };
  }

  // ---- intents -----------------------------------------------------------

  private handleJoin(playerId: string, payload: UserJoinedEvent): void {
    // A repeated join from the same connection starts over: fresh row, fresh team.
    this.players.delete(playerId);
    delete this.leaderBoard[playerId];

    const team = pickTeam(this.teamCounts());
    if (team === null) {
      this.transport.send(playerId, GAME_EVENTS.USER.JOIN_REJECTED, {
        reason: "room-full",
      });
      return;
    }

    const name = sanitizeNickname(payload.name);
    const position = this.pickSpawnFor(team, playerId);
    const rotation = facingCenterYaw(position);

    this.players.set(playerId, {
      id: playerId,
      userId: playerId,
      name,
      team,
      status: "alive",
      hp: PLAYER_MAX_HP,
      armor: 0,
      position,
      rotation,
      positionAt: this.clock(),
      lastShotAt: -Infinity,
      lastThrowAt: -Infinity,
      lastChatAt: -Infinity,
      pendingHazardDamage: 0,
      pendingCloudDamage: 0,
    });

    this.leaderBoard[playerId] = {
      id: playerId,
      userId: playerId,
      name,
      team,
      kills: 0,
      deaths: 0,
      score: 0,
    };

    // Sync the joiner with everyone in the game, themselves included: their
    // own entry tells them which team and spawn the server gave them.
    this.transport.send(playerId, GAME_EVENTS.GAME.STATE, this.gameStateFor(playerId));

    this.transport.broadcast(
      GAME_EVENTS.USER.JOINED,
      {
        id: playerId,
        userId: playerId,
        timestamp: payload.timestamp,
        name,
        team,
        position: { ...position },
        rotation,
      },
      playerId
    );
  }

  /** A spawn in `team`'s zone, as far as possible from everyone else. */
  private pickSpawnFor(team: Team, playerId: string): Vec3 {
    const others: Vec3[] = [];
    for (const other of this.players.values()) {
      if (other.id !== playerId && other.position) others.push(other.position);
    }
    const points = spawnPointsFor(team, this.map.spawnPoints);
    return { ...pickSpawnPoint(others, points) };
  }

  private handleChatMessage(playerId: string, payload: ChatMessageIntent): void {
    const player = this.players.get(playerId);
    if (!player || player.status !== "alive") return;

    const text = payload.text.trim();
    if (!text || /[\u0000-\u001f\u007f]/u.test(text)) return;

    const now = this.clock();
    if (now - player.lastChatAt < CHAT_RATE_LIMIT_MS) return;

    player.lastChatAt = now;
    this.transport.broadcast(GAME_EVENTS.CHAT.MESSAGE, {
      messageId: `${playerId}-${this.nextChatMessageId++}`,
      senderId: playerId,
      senderName: player.name,
      text: Array.from(text).slice(0, CHAT_MESSAGE_MAX_LENGTH).join(""),
      serverTime: now,
    });
  }

  private handlePosition(playerId: string, payload: PlayerPositionEvent): void {
    const player = this.players.get(playerId);
    if (!player || player.status === "dead") return;
    // Everyone stands still at spawn during the countdown.
    if (!movementAllowed(this.match.phase)) return;

    // Ingest only; positions reach other clients through the snapshot stream.
    player.position = payload.position;
    player.rotation = payload.rotation;
    player.positionAt = this.clock();
    const pose = payload.pose;
    player.pose = pose ? {
      crouched: pose.crouched === true, grounded: pose.grounded === true,
      reload: Number.isFinite(pose.reload) ? Math.min(1, Math.max(0, pose.reload)) : 0,
    } : undefined;
  }

  private handleRespawn(playerId: string, _payload: RespawnRequestEvent): void {
    const player = this.players.get(playerId);
    if (!player || player.status !== "dead") return;

    const position = this.placeAtSpawn(player);

    this.transport.broadcast(GAME_EVENTS.PLAYER.RESPAWN, {
      playerId,
      position,
      hp: player.hp,
      armor: player.armor ?? 0,
      rotation: player.rotation,
    });
  }

  private handleShoot(playerId: string, payload: WeaponEvent): void {
    const player = this.players.get(playerId);
    if (!player || player.status !== "alive") return;
    if (!combatAllowed(this.match.phase)) return;
    if (!isWeaponId(payload.weaponType)) return;

    const origin = payload.data?.position;
    const direction = payload.data?.direction;
    if (!origin || !direction || ![origin.x,origin.y,origin.z,direction.x,direction.y,direction.z].every(Number.isFinite) || Math.hypot(direction.x,direction.y,direction.z)<1e-6) return;

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
    if (!this.players.has(playerId) || !isWeaponId(payload.weaponType)) return;

    this.transport.broadcast(
      GAME_EVENTS.WEAPON.SWITCH,
      { id: playerId, userId: playerId, ...payload },
      playerId
    );
  }

  private handlePickupClaim(playerId: string, payload: PickupClaimEvent): void {
    const player = this.players.get(playerId);
    if (!player || player.status !== "alive" || !player.position) return;
    if (!combatAllowed(this.match.phase)) return;

    const pickup = this.pickups.get(payload.pickupId);
    if (!pickup) return; // already taken or expired: first claim wins
    if (!isWithinPickupReach(player.position, pickup.spec.position)) return;

    this.pickups.delete(pickup.spec.id);

    switch (pickup.spec.kind) {
      case "armor":
        player.armor = Math.min(50, (player.armor ?? 0) + pickup.spec.amount);
        break;
      case "health":
        player.hp = Math.min(PLAYER_MAX_HP, player.hp + pickup.spec.amount);
        break;
      case "weapon":
      case "ammo":
      case "throwable":
        // Ammo and throwable counts are client-trusted for now; the claimant applies them locally.
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
      armor: player.armor ?? 0,
    });
  }

  private handleGrenadeThrow(playerId: string, payload: GrenadeThrowEvent): void {
    const player = this.players.get(playerId);
    if (!player || player.status !== "alive") return;
    if (!combatAllowed(this.match.phase)) return;
    if (!payload.position || !payload.direction || !isGrenadeKind(payload.kind)) return;

    const now = this.clock();
    if (now - player.lastThrowAt < GRENADE.throwCooldown * 1000) return;
    player.lastThrowAt = now;

    const id = `grenade-${this.nextGrenadeId++}`;
    this.grenades.set(
      id,
      spawnGrenade(id, playerId, payload.kind, payload.position, payload.direction)
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
    const colliders = [...this.staticColliders, ...this.crateColliders(), ...this.interactionColliders()];

    for (const grenade of this.grenades.values()) {
      const bounce = integrateGrenade(grenade, dt, colliders);
      const shattered = bounce !== null && shattersOnImpact(grenade.kind);
      if (grenade.fuse <= 0 || shattered) this.explodeGrenade(grenade);
    }
  }

  /**
   * The fuse ran out (or the bottle broke): resolve what this kind of grenade
   * does and tell everyone.
   */
  private explodeGrenade(grenade: Grenade): void {
    this.grenades.delete(grenade.id);
    this.applyCombatPlan(
      resolveGrenadeExplosion(this.combatWorldView(), {
        grenadeId: grenade.id,
        kind: grenade.kind,
        ownerId: grenade.ownerId,
        position: grenade.position,
      })
    );
  }

  /**
   * Clouds thin out and vanish; while a gas cloud or a fire lasts, anyone
   * standing in it takes its damage per second. Like car contact, damage
   * accumulates per player and lands in whole points so the event stream stays
   * sparse. Overlapping hazards do not stack: the worst one applies.
   */
  private stepClouds(dt: number): void {
    if (this.clouds.size === 0) return;

    for (const cloud of this.clouds.values()) {
      cloud.remaining -= dt;
      if (cloud.remaining <= 0) this.clouds.delete(cloud.id);
    }

    for (const player of this.players.values()) {
      if (player.status !== "alive" || !player.position) continue;
      const position = player.position;
      let hazard: Cloud | null = null;
      for (const cloud of this.clouds.values()) {
        if (CLOUD_EFFECTS[cloud.kind].dps <= 0 || !cloudContains(cloud, position)) continue;
        if (!hazard || CLOUD_EFFECTS[cloud.kind].dps > CLOUD_EFFECTS[hazard.kind].dps) hazard = cloud;
      }
      if (!hazard) {
        player.pendingCloudDamage = 0;
        continue;
      }

      player.pendingCloudDamage += CLOUD_EFFECTS[hazard.kind].dps * dt;
      const whole = Math.floor(player.pendingCloudDamage);
      if (whole <= 0) continue;
      player.pendingCloudDamage -= whole;
      this.applyDamage(hazard.ownerId, player.id, whole, cloudDamageSource(hazard.kind), position);
    }
  }

  private stepProjectiles(dt: number): void {
    if (this.projectiles.length === 0) return;

    let colliders: Collider<CombatColliderTag>[] | undefined;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      colliders ??= [
        ...this.staticColliders,
        ...this.crateColliders(),
        ...this.playerColliders(),
        ...this.interactionColliders(),
      ];
      const { hit, expired } = integrateProjectile(
        projectile,
        dt,
        colliders,
        (c) => c.tag.kind === "player" && c.tag.id === projectile.ownerId
      );

      let geometryChanged = false;
      if (projectile.weaponId === "rocket" && expired) {
        const center = {
          x: projectile.position.x - projectile.direction.x * 0.04,
          y: Math.max(0.04, projectile.position.y - projectile.direction.y * 0.04),
          z: projectile.position.z - projectile.direction.z * 0.04,
        };
        geometryChanged = this.applyCombatPlan(
          resolveRocketBlast(this.combatWorldView(), {
            projectileId: projectile.id,
            ownerId: projectile.ownerId,
            position: center,
          })
        );
      } else if (hit) {
        const target = hit.collider.tag;
        if (projectile.weaponId === "arc" && target.kind === "player") {
          geometryChanged = this.applyCombatPlan(
            resolveArcHit(this.combatWorldView(), {
              ownerId: projectile.ownerId,
              weaponId: projectile.weaponId,
              projectilePosition: projectile.position,
              firstTargetId: target.id,
              damage: projectile.damage,
            })
          );
        } else if (target.kind !== "static") {
          geometryChanged = this.applyCombatPlan(
            resolveProjectileHit(this.combatWorldView(), {
              ownerId: projectile.ownerId,
              weaponId: projectile.weaponId,
              position: hit.point,
              target,
              damage: projectile.damage,
            })
          );
        }
      }

      if (geometryChanged) colliders = undefined;
      if (expired) this.projectiles.splice(i, 1);
    }
  }

  /** Apply damage to a crate; destroy it and maybe drop a pickup at zero HP. */
  damageCrate(crateId: string, damage: number): boolean {
    if (!combatAllowed(this.match.phase)) return false;
    return this.applyCombatPlan(
      resolveProjectileHit(this.combatWorldView(), {
        ownerId: "",
        weaponId: "grenade",
        position: { x: 0, y: 0, z: 0 },
        target: { kind: "crate", id: crateId },
        damage,
      })
    );
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

    // Nothing new appears between rounds.
    if (!combatAllowed(this.match.phase)) return;

    this.pickupSpawnIn -= dt;
    if (this.pickupSpawnIn > 0) return;
    this.pickupSpawnIn = this.rollPickupSpawnDelay();
    if (this.pickups.size >= PICKUP_MAX_COUNT) return;

    const blockers = [
      ...this.staticColliders.map((c) => c.box),
      ...this.interactionColliders().map((c) => c.box),
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
  ): boolean {
    if (!combatAllowed(this.match.phase)) return false;
    return this.applyCombatPlan(
      resolveProjectileHit(this.combatWorldView(), {
        ownerId: shooterId,
        weaponId: source,
        position,
        target: { kind: "player", id: targetId },
        damage,
      })
    );
  }

  private combatWorldView(): CombatWorldView {
    return {
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        team: player.team,
        status: player.status,
        hp: player.hp,
      armor: player.armor ?? 0,
        position: player.position ? { ...player.position } : undefined,
      })),
      crates: [...this.crates.values()].map((crate) => ({
        id: crate.spec.id,
        spec: crate.spec,
        hp: crate.hp,
      })),
      interactions: this.interactions.snapshot().flatMap((state) => {
        const spec = this.interactions.specs.get(state.id);
        return spec ? [{ id: state.id, spec, state }] : [];
      }),
      blockers: [
        ...this.staticColliders,
        ...this.crateColliders(),
        ...this.interactionColliders(),
      ],
    };
  }

  private applyCombatPlan(plan: CombatResolutionPlan): boolean {
    let geometryChanged = false;
    for (const operation of plan.operations) {
      switch (operation.kind) {
        case "player-damaged": {
          const target = this.players.get(operation.targetId);
          if (!target || target.status !== "alive") break;
          target.hp = operation.hp;
          target.armor = operation.armor;
          this.transport.broadcast(GAME_EVENTS.COMBAT.HIT, {
            shooterId: operation.shooterId,
            targetId: operation.targetId,
            damage: operation.damage,
            hp: operation.hp,
            armor: operation.armor,
            source: operation.source,
            position: operation.position,
          });
          break;
        }
        case "player-killed": {
          const target = this.players.get(operation.victimId);
          if (!target) break;
          target.status = "dead";
          const killer = this.leaderBoard[operation.killerId];
          if (killer && operation.killerTeam) {
            const delta = operation.teamKill ? -1 : 1;
            killer.kills += delta;
            killer.score += delta * KILL_SCORE;
            this.teamScores[operation.killerTeam] += delta;
          }
          const victim = this.leaderBoard[operation.victimId];
          if (victim) victim.deaths += 1;
          this.transport.broadcast(GAME_EVENTS.COMBAT.KILL, {
            killerId: operation.killerId,
            victimId: operation.victimId,
            source: operation.source,
            teamKill: operation.teamKill,
            teamScores: { ...this.teamScores },
          });
          break;
        }
        case "crate-damaged": {
          const crate = this.crates.get(operation.crateId);
          if (!crate) break;
          crate.hp = operation.hp;
          this.transport.broadcast(GAME_EVENTS.CRATE.DAMAGED, {
            crateId: operation.crateId,
            damage: operation.damage,
            hp: operation.hp,
            maxHp: CRATE_MAX_HP,
          });
          break;
        }
        case "crate-destroyed": {
          const crate = this.crates.get(operation.crateId);
          if (!crate) break;
          this.crates.delete(operation.crateId);
          geometryChanged = true;
          this.transport.broadcast(GAME_EVENTS.CRATE.DESTROYED, {
            crateId: operation.crateId,
            position: operation.position,
          });
          break;
        }
        case "interactive-damaged": {
          const state = this.interactions.states.get(operation.interactionId);
          const wasSolid = state !== undefined && state.hp > 0;
          this.interactions.damage(operation.interactionId, operation.damage);
          geometryChanged =
            geometryChanged || (wasSolid && state !== undefined && state.hp <= 0);
          break;
        }
        case "world-blast":
          this.transport.broadcast(GAME_EVENTS.WORLD.BLAST, {
            id: operation.id,
            position: operation.position,
          });
          break;
        case "world-arc":
          this.transport.broadcast(GAME_EVENTS.WORLD.ARC, {
            points: operation.points,
          });
          break;
        case "grenade-exploded":
          this.transport.broadcast(GAME_EVENTS.GRENADE.EXPLODED, {
            grenadeId: operation.grenadeId,
            kind: operation.grenadeKind,
            ownerId: operation.ownerId,
            position: operation.position,
            hits: operation.hits,
            flashed: operation.flashed,
          });
          break;
        case "cloud-created":
          this.clouds.set(
            operation.cloudId,
            spawnCloud(
              operation.cloudId,
              { ownerId: operation.ownerId, position: operation.position },
              operation.cloudKind
            )
          );
          break;
        case "pickup-drop-request":
          if (this.rng.next() < CRATE_DROP_CHANCE) {
            this.spawnPickup(
              rollCrateDrop(
                this.rng,
                this.allocatePickupId(),
                operation.position
              )
            );
          }
          break;
        default: {
          const unhandled: never = operation;
          throw new Error(`Unhandled combat operation: ${String(unhandled)}`);
        }
      }
    }
    return geometryChanged || planChangesGeometry(plan);
  }

  private interactionColliders(): Collider<CombatColliderTag>[] {
    return this.interactions.snapshot().flatMap(s => {
      const p=this.interactions.specs.get(s.id)!;
      return p.type === "fence-gate" ? [] : interactionBoxes(p,s).map(box=>({box,tag:{kind:"interactive" as const,id:s.id}}));
    });
  }

  /** The barrel is marked destroyed before cascading, so a chain detonates each only once. */
  damageInteraction(id: string, damage: number, ownerId: string): boolean {
    if (!combatAllowed(this.match.phase)) return false;
    return this.applyCombatPlan(
      resolveProjectileHit(this.combatWorldView(), {
        ownerId,
        weaponId: "barrel",
        position: { x: 0, y: 0, z: 0 },
        target: { kind: "interactive", id },
        damage,
      })
    );
  }

  private crateColliders(): Collider<CombatColliderTag>[] {
    return [...this.crates.values()].map(({ spec }) => ({
      box: crateBox(spec),
      tag: { kind: "crate", id: spec.id },
    }));
  }

  private snapshotGrenades(): GrenadeSnapshot[] {
    return [...this.grenades.values()].map(({ id, kind, ownerId, position }) => ({
      id,
      kind,
      ownerId,
      position,
    }));
  }

  private snapshotClouds(): CloudSnapshot[] {
    return [...this.clouds.values()].map(({ id, kind, position, remaining }) => ({
      id,
      kind,
      position,
      remaining,
    }));
  }

  private snapshotCrates(): CrateState[] {
    return [...this.crates.values()].map(({ spec, hp }) => ({
      id: spec.id,
      hp,
    }));
  }

  private playerColliders(): Collider<CombatColliderTag>[] {
    const colliders: Collider<CombatColliderTag>[] = [];
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
      ({ id, userId, name, team, status, hp, armor, position, rotation, positionAt, pose }) => ({
        pose,
        id,
        userId,
        name,
        team,
        status,
        hp,
        armor: armor ?? 0,
        position,
        rotation,
        positionAt,
      })
    );
  }
}

/** What a kill inside a hazardous cloud is credited to. */
function cloudDamageSource(kind: Cloud["kind"]): DamageSource {
  switch (kind) {
    case "gas":
      return "gas";
    case "fire":
      return "fire";
    case "smoke":
      throw new Error("smoke does no damage");
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled cloud kind: ${String(unhandled)}`);
    }
  }
}
