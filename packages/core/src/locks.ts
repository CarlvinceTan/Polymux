/**
 * Serialises work that shares something the process cannot hold two copies of.
 *
 * Nothing here is about memory safety — the main process is single-threaded, so
 * plain state is never torn. What it protects is the span *across* an `await`:
 * a run reads a file, waits on a model call, then writes back what it read
 * while another run's write has landed in between. Parallel chats make that
 * interleaving ordinary rather than exotic, so the read-modify-write spans that
 * touch one file, one drive path or one account are named and taken in turn.
 *
 * Keys are the caller's to choose; the convention is `<domain>:<what>` —
 * `memory:registry`, `drive:<sourceId>:<path>`. A key nothing is waiting on is
 * dropped, so the table stays the size of the work in flight rather than
 * growing with every path ever written.
 */
export class KeyedMutex {
  /** Each key's queue tail: awaiting it means every earlier holder has finished. */
  readonly #tails = new Map<string, Promise<void>>();

  /**
   * Runs `work` once every earlier caller for `key` has finished, and returns
   * whatever it returns. A rejection reaches that caller only — a failed write
   * must never wedge the key for everyone behind it.
   */
  async run<T>(key: string, work: () => Promise<T> | T): Promise<T> {
    const earlier = this.#tails.get(key);
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = earlier ? earlier.then(() => mine) : mine;
    this.#tails.set(key, tail);
    if (earlier) await earlier;
    try {
      return await work();
    } finally {
      release();
      // The key is only forgotten by the last holder out. Comparing identity is
      // what makes that safe: anyone who queued up in the meantime has already
      // replaced the tail, and deleting it would let the next caller start
      // beside the one still running rather than after it.
      void tail.then(() => {
        if (this.#tails.get(key) === tail) this.#tails.delete(key);
      });
    }
  }

  /** Whether anything currently holds or is queued on `key`. */
  held(key: string): boolean {
    return this.#tails.has(key);
  }
}

/** The process-wide table, so two domains cannot pick colliding keys. */
export const locks = new KeyedMutex();
