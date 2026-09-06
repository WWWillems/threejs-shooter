import type { WeaponId } from "./sim/weapons";
import type { CloudSnapshot, GrenadeKind, GrenadeSnapshot } from "./sim/grenade";
import type { InteractionState } from "./sim/interactions";
import type { Team, TeamScores } from "./sim/teams";
import type { MatchPhase, RoundResult } from "./sim/match";

/** Plain serializable 3D vector used by the socket protocol. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type PlayerStatus = "dead" | "alive";

/** Every client-originated event carries the client's send time (ms since epoch). */
export interface BaseEvent {
  timestamp: number;
}

/** Fields the server stamps onto every event it forwards on behalf of a client. */
export interface ServerStamped {
  /** Socket id of the originating player. */
  id: string;
  /** Alias of `id`, kept for compatibility. */
  userId: string;
}

export type Stamped<T> = T & ServerStamped;

/** Client -> server: join the game under `name`. The server picks team and spawn. */
export interface UserJoinedEvent extends BaseEvent {
  name: string;
}

/** Server -> others: a player joined; where the server put them. */
export interface UserJoinedBroadcast extends UserJoinedEvent {
  team: Team;
  position: Vec3;
  rotation: number;
}

export type JoinRejectedReason = "room-full";

/** Server -> joining client: the join intent was refused; the client is not in the game. */
export interface UserJoinRejectedEvent {
  reason: JoinRejectedReason;
}

export interface UserConnectionEvent {
  message: string;
}

/** Client -> server: send a text chat message. */
export interface ChatMessageIntent extends BaseEvent {
  text: string;
}

/** Server -> all: a validated, canonical chat message. */
export interface ChatMessageEvent {
  messageId: string;
  senderId: string;
  senderName: string;
  text: string;
  serverTime: number;
}

/** Cosmetic state only; never used to resolve damage or movement. */
export interface PlayerPose {
  crouched: boolean;
  grounded: boolean;
  reload: number;
}

export interface PlayerPositionEvent extends BaseEvent {
  pose?: PlayerPose;
  position: Vec3;
  rotation: number;
}

/** Client -> server: "I'm dead and want back in." No payload beyond the timestamp. */
export type RespawnRequestEvent = BaseEvent;

/** Server -> all: a player is alive again at `position` with full HP. */
export interface PlayerRespawnedEvent {
  armor?: number;
  playerId: string;
  position: Vec3;
  rotation: number;
  hp: number;
}

export type WeaponAction = "shoot" | "switch";

export interface WeaponEvent extends BaseEvent {
  weaponType: WeaponId;
  action: WeaponAction;
  data?: {
    ammo?: number;
    totalAmmo?: number;
    /** Barrel position the shot leaves from. */
    position?: Vec3;
    /** Unit aim direction. */
    direction?: Vec3;
  };
}

/**
 * What dealt the damage. Weapons, frag grenades (`grenade`) and gas clouds
 * (`gas`) credit the thrower; world hazards credit nobody.
 */
export type DamageSource = WeaponId | "grenade" | "gas" | "fire" | "car" | "barrel";

/** Client -> server: throw a `kind` grenade from `position` along `direction`. */
export interface GrenadeThrowEvent extends BaseEvent {
  kind: GrenadeKind;
  position: Vec3;
  /** Aim direction; the server adds the arc. */
  direction: Vec3;
}

/**
 * Server -> all: a grenade went off. Per-target damage arrives as COMBAT.HIT;
 * the clouds smoke and gas leave behind arrive in snapshots.
 */
export interface GrenadeExplodedEvent {
  grenadeId: string;
  kind: GrenadeKind;
  ownerId: string;
  position: Vec3;
  /** Frag only: players and crates caught in the blast, with the damage each took. */
  hits: { targetId: string; damage: number }[];
  /** Flash only: players who saw it, with how hard (0..1) they were blinded. */
  flashed: { targetId: string; intensity: number }[];
}

/** Client -> server: ask to use a nearby interactive world prop. */
export interface WorldInteractIntent extends BaseEvent {
  id: string;
}

/** Server -> all: an explosive interactive prop detonated. */
export interface WorldBlastEvent {
  id: string;
  position: Vec3;
}

/** Server -> all: a player took damage. */
export interface CombatHitEvent {
  /** Player id of the attacker, or the world object id for hazards. */
  shooterId: string;
  targetId: string;
  damage: number;
  /** Target HP after the hit. */
  hp: number;
  /** Remaining damage absorption; omitted by older clients. */
  armor?: number;
  source: DamageSource;
  position: Vec3;
}

/** Server -> all: `victimId` died to `killerId`. */
export interface CombatKillEvent {
  killerId: string;
  victimId: string;
  source: DamageSource;
  /** The killer shot a teammate: they and their team lose a kill instead of gaining one. */
  teamKill: boolean;
  /** Team kill totals after this kill was scored. */
  teamScores: TeamScores;
}

/** Server -> all: a crate lost HP (to a bullet or a blast). */
export interface CrateDamagedEvent {
  crateId: string;
  damage: number;
  /** Crate HP after the hit. */
  hp: number;
  maxHp: number;
}

/** Server -> all: a crate is gone. Clients remove the mesh and its collider. */
export interface CrateDestroyedEvent {
  crateId: string;
  position: Vec3;
}

/** Crate HP as the server tracks it; destroyed crates are omitted. */
export interface CrateState {
  id: string;
  hp: number;
}

/** A collectable lying in the world. Owned by the server. */
export type PickupSpec =
  | { id: string; kind: "health" | "armor"; position: Vec3; amount: number }
  | {
      id: string;
      kind: "ammo" | "weapon";
      position: Vec3;
      weaponId: WeaponId;
      amount: number;
    }
  | {
      id: string;
      kind: "throwable";
      position: Vec3;
      grenadeKind: GrenadeKind;
      /** How many the claimant gains. */
      amount: number;
    };

export type PickupKind = PickupSpec["kind"];

/** Client -> server: I'm within reach of this pickup and want it. */
export interface PickupClaimEvent extends BaseEvent {
  pickupId: string;
}

/** Server -> all: `playerId` collected `pickup`. `hp` is the player's HP afterwards. */
export interface PickupTakenEvent {
  pickup: PickupSpec;
  playerId: string;
  hp: number;
  /** Remaining damage absorption; omitted by older clients. */
  armor?: number;
}

/** Server -> all: the pickup timed out and is gone. */
export interface PickupExpiredEvent {
  pickupId: string;
}

/** Last known state of one player, as tracked by the server. */
export interface PlayerSnapshot {
  pose?: PlayerPose;
  id: string;
  userId: string;
  name: string;
  team: Team;
  status: PlayerStatus;
  hp: number;
  /** Remaining damage absorption; omitted by older clients. */
  armor?: number;
  position?: Vec3;
  rotation: number;
  /**
   * Server time (ms) at which `position`/`rotation` were last reported by the
   * owning client. Lets receivers interpolate between actual reports instead
   * of between snapshots that may repeat a stale position.
   */
  positionAt: number;
}

/** Where the match stands; rides along in every snapshot and full sync. */
export interface MatchSnapshot {
  phase: MatchPhase;
  /** Server clock at which the phase ends; `null` in warmup. */
  phaseEndsAt: number | null;
  /** Team kills this round. */
  teamScores: TeamScores;
}

/**
 * Server -> all: the match moved to a new phase. `result` is set only when
 * entering `round-end`; the world reset that goes with `countdown` arrives
 * as a fresh `game:state` per player.
 */
export interface MatchPhaseEvent extends MatchSnapshot {
  result?: RoundResult & { leaderboard: LeaderboardEntry[] };
}

/**
 * Authoritative full sync of the world. Sent to a client right after it joins
 * and to every player on each round reset. `players` includes the receiver's
 * own entry, which carries the team and spawn position the server assigned.
 */
export interface GameStateEvent {
  interactions?: InteractionState[];
  /** The receiving client's own player id, so it can find itself in `players`. */
  selfId: string;
  players: PlayerSnapshot[];
  /** Surviving crates and their HP; anything from the map layout not listed is destroyed. */
  crates: CrateState[];
  pickups: PickupSpec[];
  /** `result` is set while the match is in `round-end`, so a late joiner sees the board. */
  match: MatchSnapshot & { result: RoundResult | null };
}

/** Server tick rate in Hz; one WorldSnapshot is broadcast per tick. */
export const TICK_RATE = 20;

/** Continuous world state at one server tick. Discrete outcomes travel as events. */
export interface WorldSnapshot {
  interactions?: InteractionState[];
  /** Monotonic tick counter. */
  tick: number;
  /** Server clock at this tick, ms. Clients interpolate in this time base. */
  serverTime: number;
  players: PlayerSnapshot[];
  grenades: GrenadeSnapshot[];
  /** Smoke and gas clouds still lingering. */
  clouds: CloudSnapshot[];
  match: MatchSnapshot;
}

/** One row of the HTTP `/leaderboard` response. */
export interface LeaderboardEntry {
  id: string;
  userId: string;
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  score: number;
}

export type Leaderboard = Record<string, LeaderboardEntry>;

/** The HTTP `/leaderboard` response: this round's players, team totals and match phase. */
export interface LeaderboardResponse {
  players: Leaderboard;
  teams: TeamScores;
  match: MatchSnapshot;
}
