import { Menu, Tray, nativeImage } from "electron";
import { elapsedLabel, type RecordingSession } from "@flareai/computer-history";

/**
 * The menu-bar presence of a running recording.
 *
 * It exists because of where the user is: recording is the one thing FlareAI
 * does while they are deliberately somewhere else. An in-app indicator would
 * be behind the window they just left, and going back to it to say "done" is
 * the very interruption the feature is trying to avoid. So the state and both
 * of its controls live in the one place visible from every app.
 *
 * It appears only while recording. Nothing is left in the menu bar afterwards.
 */

/** 32×32 red dot, embedded rather than shipped: at this size a file would be
 * one more `extraResource` path to resolve differently in dev and in a package,
 * for fewer bytes than the code that would find it. */
const DOT_PNG =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAApklEQVR42u2Xuw3AIAwF6VkmfZZg" +
  "CzZiC8bwGJ6FUDhSlIbYYNmRKK5BoHfia0I7j2BJ2AJbQDAodUoHOkgAtSVNgUxhbQBS32UCsVM/" +
  "BL+pNHZKINL0NiEwkhgJ1Inw50yIBPKC8JssEcCFAsgVSAvDbxJHoCgIFI4AKAgARwAVBPBXAuZL" +
  "YL4JzY+h+UXk4io2f4xcPMfmBYmLksxNUbr/BVtAhQsu/BpSfhMKbgAAAABJRU5ErkJggg==";

export interface RecordingMenubarOptions {
  onStop: () => void;
  onCancel: () => void;
  /** Injected so the tick is testable and so tests need no real timer. */
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  cancelSchedule?: (timer: ReturnType<typeof setInterval>) => void;
  clock?: () => number;
}

export class RecordingMenubar {
  readonly #options: RecordingMenubarOptions;
  readonly #clock: () => number;
  #tray: Tray | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #session: RecordingSession | null = null;

  constructor(options: RecordingMenubarOptions) {
    this.#options = options;
    this.#clock = options.clock ?? Date.now;
  }

  /** What the menu bar currently reads, or null when nothing is shown. */
  title(): string | null {
    return this.#tray ? this.#label() : null;
  }

  show(session: RecordingSession): void {
    this.#session = session;
    if (!this.#tray) {
      // A tray that cannot be created (no display server, a test process) must
      // not take the recording down with it — the capture is the feature, the
      // indicator is not.
      try {
        const icon = nativeImage.createFromDataURL(DOT_PNG).resize({width: 16, height: 16});
        this.#tray = new Tray(icon);
      } catch {
        return;
      }
    }
    this.#render();
    const schedule =
      this.#options.schedule ??
      ((callback: () => void, ms: number) => setInterval(callback, ms));
    this.#timer = schedule(() => this.#render(), 1_000);
  }

  hide(): void {
    if (this.#timer) (this.#options.cancelSchedule ?? clearInterval)(this.#timer);
    this.#timer = null;
    this.#session = null;
    this.#tray?.destroy();
    this.#tray = null;
  }

  #render(): void {
    const tray = this.#tray;
    if (!tray || !this.#session) return;
    try {
      tray.setTitle(this.#label());
      tray.setToolTip(
        this.#session.label
          ? `FlareAI is recording "${this.#session.label}"`
          : "FlareAI is recording your workflow",
      );
      // Rebuilt each tick so the elapsed time in the header stays honest; the
      // menu is only ever built, never held open across a rebuild.
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {label: this.#session.label ?? "Recording workflow", enabled: false},
          {type: "separator"},
          {label: "Stop Recording", click: () => this.#options.onStop()},
          {label: "Cancel Recording", click: () => this.#options.onCancel()},
        ]),
      );
    } catch {
      // A tray destroyed between the tick and here is not an error.
    }
  }

  #label(): string {
    return this.#session ? elapsedLabel(this.#session.startedAt, this.#clock()) : "";
  }
}
