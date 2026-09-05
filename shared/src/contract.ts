import { GAME_EVENTS } from "./events";
import type {
  CombatHitEvent,
  CombatKillEvent,
  CrateDamagedEvent,
  CrateDestroyedEvent,
  GameStateEvent,
  GrenadeExplodedEvent,
  GrenadeThrowEvent,
  PickupClaimEvent,
  PickupExpiredEvent,
  PickupSpec,
  PickupTakenEvent,
  PlayerPositionEvent,
  PlayerRespawnedEvent,
  RespawnRequestEvent,
  Stamped,
  UserConnectionEvent,
  UserJoinedEvent,
  WeaponEvent,
  WorldSnapshot,
} from "./types";

/**
 * Events a client may send to the server, bound to their payload types.
 * Shape follows socket.io's typed-events convention (event name -> listener signature),
 * so it can be passed straight to `io<ClientToServerEvents, ServerToClientEvents>()`
 * and `new Server<ClientToServerEvents, ServerToClientEvents>()`.
 */
export interface ClientToServerEvents {
  [GAME_EVENTS.USER.JOINED]: (payload: UserJoinedEvent) => void;
  [GAME_EVENTS.PLAYER.POSITION]: (payload: PlayerPositionEvent) => void;
  [GAME_EVENTS.PLAYER.RESPAWN]: (payload: RespawnRequestEvent) => void;
  [GAME_EVENTS.WEAPON.SHOOT]: (payload: WeaponEvent) => void;
  [GAME_EVENTS.WEAPON.SWITCH]: (payload: WeaponEvent) => void;
  [GAME_EVENTS.PICKUP.CLAIM]: (payload: PickupClaimEvent) => void;
  [GAME_EVENTS.GRENADE.THROW]: (payload: GrenadeThrowEvent) => void;
}

/** Events the server may send to a client, bound to their payload types. */
export interface ServerToClientEvents {
  [GAME_EVENTS.GAME.STATE]: (payload: GameStateEvent) => void;
  [GAME_EVENTS.WORLD.SNAPSHOT]: (payload: WorldSnapshot) => void;
  [GAME_EVENTS.USER.CONNECTED]: (payload: Stamped<UserConnectionEvent>) => void;
  [GAME_EVENTS.USER.JOINED]: (payload: Stamped<UserJoinedEvent>) => void;
  [GAME_EVENTS.USER.DISCONNECTED]: (
    payload: Stamped<UserConnectionEvent>
  ) => void;
  [GAME_EVENTS.PLAYER.RESPAWN]: (payload: PlayerRespawnedEvent) => void;
  [GAME_EVENTS.WEAPON.SHOOT]: (payload: Stamped<WeaponEvent>) => void;
  [GAME_EVENTS.WEAPON.SWITCH]: (payload: Stamped<WeaponEvent>) => void;
  [GAME_EVENTS.COMBAT.HIT]: (payload: CombatHitEvent) => void;
  [GAME_EVENTS.COMBAT.KILL]: (payload: CombatKillEvent) => void;
  [GAME_EVENTS.CRATE.DAMAGED]: (payload: CrateDamagedEvent) => void;
  [GAME_EVENTS.CRATE.DESTROYED]: (payload: CrateDestroyedEvent) => void;
  [GAME_EVENTS.PICKUP.SPAWNED]: (payload: PickupSpec) => void;
  [GAME_EVENTS.PICKUP.TAKEN]: (payload: PickupTakenEvent) => void;
  [GAME_EVENTS.PICKUP.EXPIRED]: (payload: PickupExpiredEvent) => void;
  [GAME_EVENTS.GRENADE.THROW]: (payload: Stamped<GrenadeThrowEvent>) => void;
  [GAME_EVENTS.GRENADE.EXPLODED]: (payload: GrenadeExplodedEvent) => void;
}

export type ClientEventName = keyof ClientToServerEvents;
export type ServerEventName = keyof ServerToClientEvents;

/** Payload type of a client -> server event. */
export type ClientPayload<E extends ClientEventName> = Parameters<
  ClientToServerEvents[E]
>[0];

/** Payload type of a server -> client event. */
export type ServerPayload<E extends ServerEventName> = Parameters<
  ServerToClientEvents[E]
>[0];

/** What game code passes to `emit`: the payload without the timestamp the transport adds. */
export type OutgoingPayload<E extends ClientEventName> = Omit<
  ClientPayload<E>,
  "timestamp"
>;
