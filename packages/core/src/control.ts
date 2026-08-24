import type { InferenceMessage } from "@polymux/inference";

export class AgentRunControl {
  readonly #controller = new AbortController();
  readonly #steering: InferenceMessage[] = [];
  readonly #steerListeners = new Set<(message: InferenceMessage) => void>();
  #acceptingSteering = true;

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
    if (!this.#acceptingSteering) throw new Error("Run no longer accepts steering");
    this.#steering.push(message);
    for (const listener of this.#steerListeners) listener(message);
  }

  /** Observe steering without consuming it. Tool waits use this to yield as
   * soon as the user speaks; the runner still drains the exact message. */
  onSteer(listener: (message: InferenceMessage) => void): () => void {
    this.#steerListeners.add(listener);
    return () => this.#steerListeners.delete(listener);
  }

  peekSteering(): readonly InferenceMessage[] {
    return this.#steering;
  }

  drainSteering(): InferenceMessage[] {
    return this.#steering.splice(0, this.#steering.length);
  }

  /** Atomically closes the final race between the runner's last drain and
   * completion. False means queued steering still needs another turn. */
  sealSteeringIfEmpty(): boolean {
    if (this.#steering.length) return false;
    this.#acceptingSteering = false;
    return true;
  }
}
