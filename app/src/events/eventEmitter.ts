import socket from "../api/socket";
import type {
  ClientEventName,
  ClientPayload,
  ClientToServerEvents,
  OutgoingPayload,
} from "@threejs-shooter/shared";

/** A buffered, already-typed emit waiting for the next flush. */
type BufferedEmit = () => void;

export class EventEmitter {
  private static instance: EventEmitter;
  private eventBuffer: BufferedEmit[] = [];
  private readonly bufferInterval = 100; // 100ms buffer interval

  private constructor() {
    this.startBuffering();
  }

  public static getInstance(): EventEmitter {
    if (!EventEmitter.instance) {
      EventEmitter.instance = new EventEmitter();
    }
    return EventEmitter.instance;
  }

  private startBuffering(): void {
    setInterval(() => this.flushBuffer(), this.bufferInterval);
  }

  private flushBuffer(): void {
    if (this.eventBuffer.length === 0) return;

    // Emit each buffered event individually, in order. Receivers expect one
    // payload object per message; batching same-named events into an array
    // silently dropped them.
    const pending = this.eventBuffer;
    this.eventBuffer = [];
    for (const send of pending) {
      send();
    }
  }

  public emit<E extends ClientEventName>(
    event: E,
    data: OutgoingPayload<E>
  ): void {
    const stamped = { ...data, timestamp: Date.now() } as ClientPayload<E>;
    // socket.io types emit args as the listener's parameter tuple; every
    // event in the contract takes exactly one payload argument.
    const args = [stamped] as Parameters<ClientToServerEvents[E]>;
    this.eventBuffer.push(() => socket.emit(event, ...args));
  }
}
