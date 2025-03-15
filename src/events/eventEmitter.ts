import socket from "../api/socket";
import { GAME_EVENTS } from "./constants";
import type { BaseEvent } from "./types";

export class EventEmitter {
  private static instance: EventEmitter;
  private eventBuffer: { event: string; data: BaseEvent }[] = [];
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

    // Group similar events
    const groupedEvents = this.eventBuffer.reduce((acc, curr) => {
      if (!acc[curr.event]) {
        acc[curr.event] = [];
      }
      acc[curr.event].push(curr.data);
      return acc;
    }, {} as Record<string, BaseEvent[]>);

    // Emit grouped events
    for (const [eventName, events] of Object.entries(groupedEvents)) {
      if (eventName !== GAME_EVENTS.PLAYER.POSITION) {
        console.log(`> Emitting event: ${eventName}`, {
          eventData: events.length === 1 ? events[0] : events,
          socketConnected: socket.connected,
        });
      }

      socket.emit(eventName, events.length === 1 ? events[0] : events);
    }

    // Clear buffer
    this.eventBuffer = [];
  }

  public emit<T extends Omit<BaseEvent, "timestamp">>(
    eventName: string,
    data: T
  ): void {
    this.eventBuffer.push({
      event: eventName,
      data: {
        ...data,
        timestamp: Date.now(),
      },
    });
  }
}
