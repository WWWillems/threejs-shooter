import type { WeaponId } from "./sim/weapons";

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

export interface UserJoinedEvent extends BaseEvent {
  name: string;
  position: Vec3;
}

export interface UserConnectionEvent {
  message: string;
}

export interface PlayerPositionEvent extends BaseEvent {
  position: Vec3;
  rotation: number;
}

/** Client -> server: "I'm dead and want back in." No payload beyond the timestamp. */
export type RespawnRequestEvent = BaseEvent;

/** Server -> all: a player is alive again at `position` with full HP. */
export interface PlayerRespawnedEvent {
  playerId: string;
  position: Vec3;
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

/** What dealt the damage. Weapons credit the shooter; world hazards credit nobody. */
export type DamageSource = WeaponId | "car";

/** Server -> all: a player took damage. */
export interface CombatHitEvent {
  /** Player id of the attacker, or the world object id for hazards. */
  shooterId: string;
  targetId: string;
  damage: number;
  /** Target HP after the hit. */
  hp: number;
  source: DamageSource;
  position: Vec3;
}

/** Server -> all: `victimId` died to `killerId`. */
export interface CombatKillEvent {
  killerId: string;
  victimId: string;
  source: DamageSource;
}

/** Last known state of one player, as tracked by the server. */
export interface PlayerSnapshot {
  id: string;
  userId: string;
  name: string;
  status: PlayerStatus;
  hp: number;
  position?: Vec3;
  rotation: number;
}

/** Sent to a client right after it joins so it can render players already in the game. */
export interface GameStateEvent {
  /** The receiving client's own player id, so it can ignore itself in snapshots. */
  selfId: string;
  players: PlayerSnapshot[];
}

/** Server tick rate in Hz; one WorldSnapshot is broadcast per tick. */
export const TICK_RATE = 20;

/** Continuous world state at one server tick. Discrete outcomes travel as events. */
export interface WorldSnapshot {
  /** Monotonic tick counter. */
  tick: number;
  /** Server clock at this tick, ms. Clients interpolate in this time base. */
  serverTime: number;
  players: PlayerSnapshot[];
}

/** One row of the HTTP `/leaderboard` response. */
export interface LeaderboardEntry {
  id: string;
  userId: string;
  name: string;
  kills: number;
  deaths: number;
  score: number;
}

export type Leaderboard = Record<string, LeaderboardEntry>;
