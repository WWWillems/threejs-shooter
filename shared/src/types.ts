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

export interface PlayerStatusEvent extends BaseEvent {
  status: PlayerStatus;
  position?: Vec3;
}

export type WeaponAction = "shoot" | "switch";

export interface WeaponEvent extends BaseEvent {
  weaponType: string;
  action: WeaponAction;
  data?: {
    ammo?: number;
    totalAmmo?: number;
    position?: Vec3;
    direction?: Vec3;
  };
}

/** Last known state of one player, as tracked by the server. */
export interface PlayerSnapshot {
  id: string;
  userId: string;
  name: string;
  status: PlayerStatus;
  position?: Vec3;
  rotation: number;
}

/** Sent to a client right after it joins so it can render players already in the game. */
export interface GameStateEvent {
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
