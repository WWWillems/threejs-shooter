import { EventEmitter } from "./eventEmitter";
import type { BaseEvent } from "./types";

export abstract class NetworkedEntity {
  protected eventEmitter: EventEmitter;

  constructor() {
    this.eventEmitter = EventEmitter.getInstance();
  }

  protected emit<T extends BaseEvent>(
    eventName: string,
    data: Omit<T, "timestamp">
  ): void {
    this.eventEmitter.emit(eventName, data);
  }
}
