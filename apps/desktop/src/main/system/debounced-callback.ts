export interface DebouncedCallbackOptions {
  delayMs: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Coalesces a burst into one callback and makes cancellation explicit. */
export class DebouncedCallback {
  readonly #callback: () => void;
  readonly #delayMs: number;
  readonly #schedule: NonNullable<DebouncedCallbackOptions["schedule"]>;
  readonly #cancelSchedule: NonNullable<DebouncedCallbackOptions["cancelSchedule"]>;
  #timer?: ReturnType<typeof setTimeout>;

  constructor(callback: () => void, options: DebouncedCallbackOptions) {
    this.#callback = callback;
    this.#delayMs = options.delayMs;
    this.#schedule = options.schedule ?? ((next, delay) => setTimeout(next, delay));
    this.#cancelSchedule = options.cancelSchedule ?? clearTimeout;
  }

  trigger(): void {
    this.cancel();
    this.#timer = this.#schedule(() => {
      this.#timer = undefined;
      this.#callback();
    }, this.#delayMs);
  }

  cancel(): void {
    if (this.#timer) this.#cancelSchedule(this.#timer);
    this.#timer = undefined;
  }
}
