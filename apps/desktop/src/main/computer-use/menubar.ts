import { Menu, Tray, nativeImage } from "electron";
import type { PillApp, PillIcon } from "./pill-icon.js";

/**
 * Polymux's Computer Use pill — the menu-bar presence of the agent driving a
 * native window.
 *
 * Built in, not delegated. `AgentSurfaceAdapter` publishes browser leases to a
 * separately installed app and is a no-op without it, which is fine for an
 * optional extra and wrong for the one signal that says the agent is moving
 * things on the user's screen. Everyone who installs Polymux gets this.
 *
 * It is a *separate* status item from the recording indicator on purpose: the
 * two say opposite things — here the agent drives and the user watches, there
 * the user drives and the agent watches — and a single icon that meant either
 * would be worse than two that each mean one thing.
 *
 * The picture is `pill-icon.ts`; this owns the item and its menu.
 */

export interface ComputerUseMenubarOptions {
  /** Asked to give up control of everything. */
  onStopAll: () => void;
  /** Draws the capsule. */
  icon: PillIcon;
}

export type DrivenApp = PillApp;

export class ComputerUseMenubar {
  readonly #options: ComputerUseMenubarOptions;
  #tray: Tray | null = null;
  #shown = "";
  /** Set by `hide()` so an in-flight redraw cannot resurrect the pill. */
  #released = false;

  constructor(options: ComputerUseMenubarOptions) {
    this.#options = options;
  }

  /** What the menu bar currently reads, or null when nothing is shown. */
  title(): string | null {
    return this.#tray ? this.#shown : null;
  }

  /**
   * The apps being driven right now. An empty list takes the pill away, so a
   * lease expiring is enough to end it — nothing has to remember to call hide.
   *
   * Async because the icons are the apps' own, read from disk. Callers fire
   * and forget: a redraw that loses a race with the next one is a stale
   * picture for a tick, never a wrong claim, because `#shown` is set from the
   * list that actually drew.
   */
  async update(apps: DrivenApp[]): Promise<void> {
    if (apps.length === 0) {
      this.hide();
      return;
    }
    this.#released = false;
    const image = await this.#options.icon.image(apps);
    // The lease may have lapsed while the icons were being read.
    if (this.#released) return;
    if (!this.#tray) {
      // A tray that cannot be created must never take the agent's work down
      // with it; the pill is an indicator, not a precondition.
      try {
        this.#tray = new Tray(image ?? nativeImage.createEmpty());
      } catch {
        return;
      }
    } else if (image) this.#tray.setImage(image);

    this.#shown = apps.map((app) => app.name).join(", ");
    try {
      this.#tray.setToolTip(`Polymux is using ${this.#shown}`);
      this.#tray.setContextMenu(
        Menu.buildFromTemplate([
          {label: apps.length === 1 ? "Window in use" : "Windows in use", enabled: false},
          ...apps.map((app) => ({label: `  ${app.name}`, enabled: false})),
          {type: "separator" as const},
          {
            // One item, whatever the count: stopping is about ending the run,
            // and a run does not hold one window at a time in a way the user
            // could meaningfully pick between here.
            label: apps.length === 1 ? `Stop Using ${apps[0]!.name}` : "Stop Using Apps",
            click: () => this.#options.onStopAll(),
          },
        ]),
      );
    } catch {
      // Destroyed between the check and here; nothing to report.
    }
  }

  hide(): void {
    this.#released = true;
    this.#shown = "";
    this.#tray?.destroy();
    this.#tray = null;
  }
}
