import {
  GAME_EVENTS,
  type ClientEventName,
  type ClientPayload,
  type Leaderboard,
  type PlayerPositionEvent,
  type PlayerSnapshot,
  type PlayerStatusEvent,
  type UserJoinedEvent,
  type WeaponEvent,
} from "@threejs-shooter/shared";
import type { RoomTransport } from "./transport";

/**
 * The single source of truth for one game session.
 *
 * Pure TypeScript: no sockets, no timers. Inbound messages arrive through
 * `connect` / `applyIntent` / `leave`; outbound messages go through the
 * injected `RoomTransport`. `tick` advances the simulation by a fixed step.
 */
export class GameRoom {
  /** Last known state of every player who has joined, keyed by player id. */
  readonly players = new Map<string, PlayerSnapshot>();
  readonly leaderBoard: Leaderboard = {};

  constructor(private readonly transport: RoomTransport) {}

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
      case GAME_EVENTS.PLAYER.STATUS:
        this.handleStatus(playerId, payload as PlayerStatusEvent);
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

  /** Advance the simulation by `dt` seconds. Nothing to simulate yet. */
  tick(_dt: number): void {}

  private handleJoin(playerId: string, payload: UserJoinedEvent): void {
    const name = payload.name || `Player-${playerId.substring(0, 5)}`;

    // Sync the joiner with everyone already in the game, before registering them
    this.transport.send(playerId, GAME_EVENTS.GAME.STATE, {
      players: [...this.players.values()],
    });

    this.players.set(playerId, {
      id: playerId,
      userId: playerId,
      name,
      status: "alive",
      position: payload.position,
      rotation: 0,
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
    if (!player) return;

    player.position = payload.position;
    player.rotation = payload.rotation;

    this.transport.broadcast(
      GAME_EVENTS.PLAYER.POSITION,
      { id: playerId, userId: playerId, ...payload },
      playerId
    );
  }

  private handleStatus(playerId: string, payload: PlayerStatusEvent): void {
    const player = this.players.get(playerId);
    if (!player) return;

    player.status = payload.status;
    if (payload.position) {
      player.position = payload.position;
    }

    this.transport.broadcast(
      GAME_EVENTS.PLAYER.STATUS,
      { id: playerId, userId: playerId, ...payload },
      playerId
    );
  }

  private handleShoot(playerId: string, payload: WeaponEvent): void {
    if (!this.players.has(playerId)) return;

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
}
