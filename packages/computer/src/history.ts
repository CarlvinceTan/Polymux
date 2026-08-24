export interface ComputerHistoryQuery {
  query: string;
  app?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}

export interface ComputerHistorySource {
  search(query: ComputerHistoryQuery): unknown;
}

/** Optional longer-term context. Live safety never depends on this source. */
export class ComputerHistory {
  readonly #source?: ComputerHistorySource;

  constructor(source?: ComputerHistorySource) {
    this.#source = source;
  }

  get available(): boolean {
    return Boolean(this.#source);
  }

  search(query: ComputerHistoryQuery): unknown {
    if (!this.#source) throw new Error("Computer.History is unavailable");
    return this.#source.search(query);
  }
}
