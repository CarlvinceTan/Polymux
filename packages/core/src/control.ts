import type { InferenceMessage } from "@midas/inference";

export class AgentRunControl {
  readonly #controller = new AbortController();
  readonly #steering: InferenceMessage[] = [];

  get signal(): AbortSignal {
    return this.#controller.signal;
  }
  get aborted(): boolean {
    return this.signal.aborted;
  }

  cancel(reason: unknown = new Error("Run cancelled")): void {
    if (!this.signal.aborted) this.#controller.abort(reason);
  }

  steer(message: InferenceMessage): void {
    if (this.signal.aborted) throw new Error("Cannot steer a cancelled run");
    this.#steering.push(message);
  }

  drainSteering(): InferenceMessage[] {
    return this.#steering.splice(0, this.#steering.length);
  }
}
