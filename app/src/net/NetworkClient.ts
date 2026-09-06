import { io } from "socket.io-client";
import {
  GAME_EVENTS,
  emptyTeamScores,
  type ClientEventName,
  type ClientPayload,
  type LeaderboardResponse,
  type OutgoingPayload,
  type ServerEventName,
  type ServerPayload,
  type Team,
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

const normalizeServerUrl = (serverUrl: string): string =>
  serverUrl.replace(/\/+$/, "");

/**
 * The client's single door to the server: typed send/receive over the shared
 * event contract, join + automatic re-join after a reconnect, and the
 * leaderboard fetch.
 */
export class NetworkClient {
  private joined: { name: string } | null = null;
  private _selfId: string | null = null;
  private _selfTeam: Team | null = null;
  private readonly serverUrl: string;

  constructor(
    private readonly socket: RawSocket,
    serverUrl: string,
  ) {
    this.serverUrl = normalizeServerUrl(serverUrl);
    // socket.io assigns a new id after reconnecting; the server forgot us, so
    // re-register and let everyone rebuild our presence.
    this.socket.on("connect", () => {
      if (this.joined) {
        this.sendJoin();
      }
    });
    this.on(GAME_EVENTS.GAME.STATE, ({ selfId, players }) => {
      this._selfId = selfId;
      this._selfTeam = players.find((p) => p.id === selfId)?.team ?? null;
    });
    // A refused join is final for this attempt: don't re-send it on reconnect.
    this.on(GAME_EVENTS.USER.JOIN_REJECTED, () => {
      this.joined = null;
    });
  }

  /** Our player id as the server knows it. Null until the server has acknowledged our join. */
  get selfId(): string | null {
    return this._selfId;
  }

  /** The team the server put us on. Null until the server has acknowledged our join. */
  get selfTeam(): Team | null {
    return this._selfTeam;
  }

  /** Open a socket.io connection to the game server. */
  static connect(serverUrl: string): NetworkClient {
    const normalizedServerUrl = normalizeServerUrl(serverUrl);
    const socket = io(normalizedServerUrl) as unknown as RawSocket;
    return new NetworkClient(socket, normalizedServerUrl);
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
    handler: (payload: ServerPayload<E>) => void,
  ): Unsubscribe {
    const listener = (...args: unknown[]) =>
      handler(args[0] as ServerPayload<E>);
    this.socket.on(event, listener);
    return () => this.socket.off(event, listener);
  }

  /**
   * Join the game. The server answers with `game:state` (team and spawn in
   * our own entry) or `user:join-rejected`.
   */
  join(name: string): void {
    this.joined = { name };
    this.sendJoin();
  }

  async getLeaderboard(): Promise<LeaderboardResponse> {
    try {
      const response = await fetch(`${this.serverUrl}/leaderboard`);
      if (!response.ok) {
        throw new Error(`Failed to fetch leaderboard: ${response.status}`);
      }
      return (await response.json()) as LeaderboardResponse;
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      return {
        players: {},
        teams: emptyTeamScores(),
        match: { phase: "warmup", phaseEndsAt: null, teamScores: emptyTeamScores() },
      };
    }
  }

  private sendJoin(): void {
    if (!this.joined) return;
    this.send(GAME_EVENTS.USER.JOINED, { name: this.joined.name });
  }
}
