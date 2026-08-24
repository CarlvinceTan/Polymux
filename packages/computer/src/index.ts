export * from "./types.js";
export * from "./state.js";
export * from "./arbiter.js";
export * from "./history.js";
export * from "./history/types.js";
export * from "./history/store.js";
export * from "./history/manager.js";
export * from "./history/recording.js";

import type {ComputerStateInput} from "./types.js";
import {ComputerState} from "./state.js";
import {ComputerArbiter} from "./arbiter.js";
import {ComputerHistory, type ComputerHistorySource} from "./history.js";

export class Computer {
  readonly State: ComputerState;
  readonly Arbiter: ComputerArbiter;
  readonly History: ComputerHistory;

  constructor(source: () => ComputerStateInput, history?: ComputerHistorySource) {
    this.State = new ComputerState(source);
    this.Arbiter = new ComputerArbiter(this.State);
    this.History = new ComputerHistory(history);
  }

  observe(event: import("./types.js").ComputerActivityEvent): void {
    this.State.recordActivity(event);
    for (const surface of this.State.matchingActivitySurfaces(event))
      this.Arbiter.userActivity(surface.id);
  }
}
