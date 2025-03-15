import { EventEmitter } from "./eventEmitter";
import type { BaseEvent } from "./types";

export abstract class NetworkedEntity {
  protected eventEmitter: EventEmitter;
  private isHandlingRemoteEvent: boolean = false;

  constructor() {
    this.eventEmitter = EventEmitter.getInstance();
  }

  /**
   * Emit an event only if we're not currently handling a remote event
   */
  protected emit<T extends BaseEvent>(
    eventName: string,
    data: Omit<T, "timestamp">
  ): void {
    if (!this.isHandlingRemoteEvent) {
      this.eventEmitter.emit(eventName, data);
    }
  }

  /**
   * Execute a function in a remote event context
   * Any events emitted during the execution of this function will be suppressed
   */
  public handleRemoteEvent(fn: () => void): void {
    // Set remote event handling flag
    const previousState = this.isHandlingRemoteEvent;
    this.isHandlingRemoteEvent = true;

    try {
      // Execute the function
      fn();
    } finally {
      // Reset the flag, even if an error occurs
      this.isHandlingRemoteEvent = previousState;
    }
  }
}
