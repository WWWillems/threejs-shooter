import type {
  ClientEventName,
  ClientPayload,
  OutgoingPayload,
  ServerEventName,
  ServerPayload,
} from "@threejs-shooter/shared";
import type { GameRoom } from "../room/GameRoom";
import type { RoomTransport } from "../room/transport";

export interface OutboundMessage<E extends ServerEventName = ServerEventName> {
  /** Recipient player id. */
  to: string;
  event: E;
  payload: ServerPayload<E>;
}

/**
 * In-memory RoomTransport for tests. Records every outbound message with its
 * resolved recipient, so assertions can ask "what did player B receive?".
 */
export class MemoryTransport implements RoomTransport {
  readonly connected = new Set<string>();
  readonly outbox: OutboundMessage[] = [];

  send<E extends ServerEventName>(
    playerId: string,
    event: E,
    payload: ServerPayload<E>
  ): void {
    this.outbox.push({ to: playerId, event, payload });
  }

  broadcast<E extends ServerEventName>(
    event: E,
    payload: ServerPayload<E>,
    exceptPlayerId?: string
  ): void {
    for (const id of this.connected) {
      if (id === exceptPlayerId) continue;
      this.outbox.push({ to: id, event, payload });
    }
  }

  /** Messages delivered to one player, optionally filtered by event. */
  received<E extends ServerEventName>(
    playerId: string,
    event?: E
  ): OutboundMessage<E>[] {
    return this.outbox.filter(
      (m): m is OutboundMessage<E> =>
        m.to === playerId && (event === undefined || m.event === event)
    );
  }

  clear(): void {
    this.outbox.length = 0;
  }
}

/** A fake client driving a GameRoom through the same calls the socket.io adapter makes. */
export class MemoryClient {
  constructor(
    readonly id: string,
    private readonly room: GameRoom,
    private readonly transport: MemoryTransport
  ) {}

  connect(): this {
    this.transport.connected.add(this.id);
    this.room.connect(this.id);
    return this;
  }

  send<E extends ClientEventName>(event: E, payload: OutgoingPayload<E>): this {
    const stamped = { ...payload, timestamp: Date.now() } as ClientPayload<E>;
    this.room.applyIntent(this.id, event, stamped);
    return this;
  }

  disconnect(): this {
    this.transport.connected.delete(this.id);
    this.room.leave(this.id);
    return this;
  }

  received<E extends ServerEventName>(event?: E): OutboundMessage<E>[] {
    return this.transport.received(this.id, event);
  }
}
