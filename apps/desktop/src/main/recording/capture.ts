import type { InteractionEvent, InteractionEventSource, RecordingWindow } from "@polymux/computer";
import { ComputerHistoryRecorder, type RecordingEndReason, type RecordingSession } from "@polymux/computer";

/**
 * How often the frontmost window is re-read while a recording runs. A click
 * per snapshot would put a Swift helper call in the path of every click; a
 * fixed poll would miss the window that only existed between two of them.
 * Sampling *on* an event, throttled, keeps the tree attributable to something
 * the user did without paying for it more than this often.
 */
const WINDOW_SAMPLE_MS = 1_200;

export interface RecordingCaptureOptions {
  directory: string;
  /**
   * A fresh event source per recording. ComputerHistory owns its own; a recording
   * must run whether or not the ambient history is switched on, so it never
   * borrows that one.
   */
  createEvents: () => InteractionEventSource;
  /** Reads the frontmost window, or null when there is nothing readable. */
  readWindow: () => Promise<RecordingWindow | null>;
  /**
   * Shown while a recording runs. Optional so the capture is testable and so a
   * failed indicator never stops a recording.
   */
  indicator?: { show(session: RecordingSession): void; hide(): void };
}

/**
 * The Electron-side seam for Record & Replay: it owns the event tap and the
 * accessibility reads for the life of one recording, and nothing else. What a
 * recording *means* is decided later, by the agent reading the file.
 */
export class RecordingCapture {
  readonly recorder: ComputerHistoryRecorder;
  readonly #createEvents: RecordingCaptureOptions["createEvents"];
  readonly #readWindow: RecordingCaptureOptions["readWindow"];
  readonly #indicator?: RecordingCaptureOptions["indicator"];
  #events?: InteractionEventSource;
  #lastSample = 0;
  #sampling = false;

  constructor(options: RecordingCaptureOptions) {
    this.recorder = new ComputerHistoryRecorder({
      directory: options.directory,
      // Every ending routes through here, including the 30-minute cap, which
      // fires inside the recorder and would otherwise leave the tap running.
      onEnded: () => this.#release(),
    });
    this.#createEvents = options.createEvents;
    this.#readWindow = options.readWindow;
    this.#indicator = options.indicator;
  }

  active(): RecordingSession | null {
    return this.recorder.active();
  }

  list(): RecordingSession[] {
    return this.recorder.list();
  }

  lastEnded(): RecordingSession | null {
    return this.recorder.lastEnded();
  }

  read(id: string): RecordingSession | null {
    return this.recorder.read(id);
  }

  async start(options: { label?: string | null; limitMs?: number } = {}): Promise<RecordingSession> {
    const session = this.recorder.start(options);
    try {
      const events = this.#createEvents();
      this.#events = events;
      await events.start((event) => this.#onEvent(event));
    } catch (error) {
      // A recording with no tap would look like it was running and capture
      // nothing, which is the one outcome worse than failing to start.
      this.recorder.stop("interrupted");
      this.#events = undefined;
      throw error;
    }
    this.#indicator?.show(session);
    // One window read up front, so the file opens with where the user was
    // rather than with wherever they first clicked.
    void this.#sample(true);
    return session;
  }

  stop(reason: RecordingEndReason = "stopped"): RecordingSession | null {
    return this.recorder.stop(reason);
  }

  /**
   * Everything held open for the duration of a recording, released together.
   * An indicator left behind would tell the user they are still being recorded
   * when they are not, so it goes even if the tap was already gone.
   */
  #release(): void {
    this.#events?.stop();
    this.#events = undefined;
    this.#indicator?.hide();
  }

  #onEvent(event: InteractionEvent): void {
    this.recorder.record(event);
    void this.#sample(false);
  }

  async #sample(force: boolean): Promise<void> {
    if (!this.recorder.active()) return;
    const now = Date.now();
    if (this.#sampling) return;
    if (!force && now - this.#lastSample < WINDOW_SAMPLE_MS) return;
    this.#sampling = true;
    this.#lastSample = now;
    try {
      const window = await this.#readWindow();
      // The recording may have ended while the helper was answering.
      if (window && this.recorder.active()) this.recorder.window(window);
    } catch {
      // A window that cannot be read is not a reason to lose the events.
    } finally {
      this.#sampling = false;
    }
  }
}
