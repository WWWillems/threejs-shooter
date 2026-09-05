import type { ServerEventName, ServerPayload } from "@threejs-shooter/shared";

/**
 * Outbound port of the GameRoom. The room never touches sockets; an adapter
 * implements this against socket.io (production) or an in-memory log (tests).
 */
export interface RoomTransport {
  /** Send to a single player. */
  send<E extends ServerEventName>(
    playerId: string,
    event: E,
    payload: ServerPayload<E>
  ): void;
  /** Send to every connected player, optionally skipping one (usually the originator). */
  broadcast<E extends ServerEventName>(
    event: E,
    payload: ServerPayload<E>,
    exceptPlayerId?: string
  ): void;
}
