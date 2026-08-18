import type {
  ChronicleEntry,
  ChronicleSearchHit,
  InteractionEvent,
} from "@flareai/chronicle";

/**
 * What the agent is allowed to know about Chronicle. The recorder itself is
 * the app's — it needs Electron and a native helper — so the runtime is handed
 * this narrow reading surface instead: the prompt context it already had, plus
 * the two queries the retrieval tools and the distiller run. Everything about
 * capture, policy and pruning stays on the other side of it.
 *
 * The reading members are optional so a host that only wants the prompt line —
 * or a test — can still supply a chronicle.
 */
export interface ChronicleAccess {
  promptContext(): {
    directory: string;
    instructionsPath: string;
    enabled: boolean;
  };
  settings?(): { enabled: boolean; distillAfterHours: number };
  store?: ChronicleReader;
}

export interface ChronicleReader {
  search(
    query: string,
    options?: { since?: Date; until?: Date; limit?: number; app?: string },
  ): ChronicleSearchHit[];
  entries(options?: { since?: Date; until?: Date; limit?: number }): ChronicleEntry[];
  events(options?: { since?: Date; until?: Date; limit?: number }): InteractionEvent[];
  state(): { distilledThrough: string | null };
  writeState(state: { distilledThrough: string | null }): void;
}
