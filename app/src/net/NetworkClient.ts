import { io } from "socket.io-client";
import {
  GAME_EVENTS,
  type ClientEventName,
  type ClientPayload,
  type Leaderboard,
  type OutgoingPayload,
  type ServerEventName,
  type ServerPayload,
  type Vec3,
} from "@threejs-shooter/shared";

/**
 * The untyped transport underneath NetworkClient. socket.io's Socket satisfies
 * it; tests provide a fake. Contract typing is enforced by NetworkClient's
 * public API, not by the transport.
 */
export interface RawSocket {
  connected: boolean;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
}

export type Unsubscribe = () => void;

/**
 * The client's single door to the server: typed send/receive over the shared
 * event contract, join + automatic re-join after a reconnect, and the
 * leaderboard fetch.
 */
export class NetworkClient {
  private joined: { name: string; position: () => Vec3 } | null = null;

  constructor(
    private readonly socket: RawSocket,
    private readonly serverUrl: string
  ) {
    // socket.io assigns a new id after reconnecting; the server forgot us, so
    // re-register and let everyone rebuild our presence.
    this.socket.on("connect", () => {
      if (this.joined) {
        this.sendJoin();
      }
    });
  }

  /** Open a socket.io connection to the game server. */
  static connect(serverUrl: string): NetworkClient {
    const socket = io(serverUrl) as unknown as RawSocket;
    return new NetworkClient(socket, serverUrl);
  }

  get isConnected(): boolean {
    return this.socket.connected;
  }

  /** Send a client -> server event. The timestamp is added here. */
  send<E extends ClientEventName>(event: E, payload: OutgoingPayload<E>): void {
    const stamped = { ...payload, timestamp: Date.now() } as ClientPayload<E>;
    this.socket.emit(event, stamped);
  }

  /** Subscribe to a server -> client event. Returns an unsubscribe function. */
  on<E extends ServerEventName>(
    event: E,
    handler: (payload: ServerPayload<E>) => void
  ): Unsubscribe {
    const listener = (...args: unknown[]) =>
      handler(args[0] as ServerPayload<E>);
    this.socket.on(event, listener);
    return () => this.socket.off(event, listener);
  }

  /**
   * Join the game. `position` is read lazily so a re-join after reconnect
   * reports where the player actually is.
   */
  join(name: string, position: () => Vec3): void {
    this.joined = { name, position };
    this.sendJoin();
  }

  async getLeaderboard(): Promise<Leaderboard> {
    try {
      const response = await fetch(`${this.serverUrl}/leaderboard`);
      if (!response.ok) {
        throw new Error(`Failed to fetch leaderboard: ${response.status}`);
      }
      return (await response.json()) as Leaderboard;
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      return {};
    }
  }

  private sendJoin(): void {
    if (!this.joined) return;
    this.send(GAME_EVENTS.USER.JOINED, {
      name: this.joined.name,
      position: this.joined.position(),
    });
  }
}
