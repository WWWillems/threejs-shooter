import type { RawSocket } from "./NetworkClient";

type Listener = (...args: unknown[]) => void;

/** In-memory RawSocket for tests: records emits, lets tests push server events. */
export class FakeSocket implements RawSocket {
  connected = false;
  readonly emitted: { event: string; args: unknown[] }[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: unknown[]): void {
    this.emitted.push({ event, args });
  }

  /** Simulate a message (or lifecycle event) arriving from the server. */
  receive(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  /** Simulate the transport (re)connecting. */
  connect(): void {
    this.connected = true;
    this.receive("connect");
  }

  disconnect(): void {
    this.connected = false;
    this.receive("disconnect");
  }

  emittedOf(event: string): unknown[][] {
    return this.emitted.filter((e) => e.event === event).map((e) => e.args);
  }
}
