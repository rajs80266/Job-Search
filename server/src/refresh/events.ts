import { EventEmitter } from "node:events";
import type { RefreshEvent } from "../types";

export type RefreshListener = (event: RefreshEvent) => void;

/** In-process fan-out of live refresh events, one channel per run. */
export class RefreshEvents {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(runId: number, event: RefreshEvent): void {
    this.emitter.emit(this.channel(runId), event);
  }

  /** Returns the function that unsubscribes. */
  subscribe(runId: number, listener: RefreshListener): () => void {
    const channel = this.channel(runId);
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  private channel(runId: number): string {
    return `run:${runId}`;
  }
}
