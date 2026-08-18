import cursorMotionSource from "@flareai/browser-use/src/cursor-motion.js?raw";
import cursorOverlaySource from "@flareai/browser-use/src/cursor-overlay.js?raw";
import { BrowserWindow } from "electron";

/**
 * The agent's cursor over a native window.
 *
 * The accessibility controller never moves the real pointer — it presses
 * controls directly, which is what keeps it out of the user's way. That leaves
 * nothing on screen to explain what just happened, so a window changed by
 * itself. This draws the same cursor the browsers use, travelling to the
 * control about to be acted on, in a transparent click-through window sitting
 * over the target.
 *
 * Shown for as long as the agent is working in that window, so the user sees
 * the pointer wherever the work is rather than only once they look over.
 *
 * It is presentation only: it never takes focus, never accepts a click, and
 * never blocks the action it illustrates. If it cannot be shown the action
 * still happens.
 */

export interface ScreenFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class NativeCursor {
  #window: BrowserWindow | null = null;
  #frame: ScreenFrame | null = null;

  /**
   * Put the overlay over a window's screen frame. Called with the target
   * window's bounds from the controller's `list`.
   */
  async cover(frame: ScreenFrame): Promise<void> {
    if (this.#window && !this.#window.isDestroyed()) {
      if (!sameFrame(this.#frame, frame)) {
        this.#window.setBounds(roundFrame(frame));
        this.#frame = frame;
      }
      return;
    }

    const window = new BrowserWindow({
      ...roundFrame(frame),
      transparent: true,
      frame: false,
      // Never steals what the user is doing: no focus, no activation, and
      // every click passes straight through to the app underneath.
      focusable: false,
      show: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      acceptFirstMouse: false,
      webPreferences: { offscreen: false, contextIsolation: true, sandbox: true },
    });
    window.setIgnoreMouseEvents(true, { forward: false });
    // Above ordinary windows but below system UI, and present on whichever
    // space the target is on rather than pulling the user to another one.
    window.setAlwaysOnTop(true, "floating");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(overlayDocument())}`,
    );
    window.showInactive();
    this.#window = window;
    this.#frame = frame;
  }

  /**
   * Move the cursor to a point given in **screen** coordinates, and resolve
   * once it has arrived — so the user watches the pointer reach the control
   * before the controller presses it.
   */
  async moveTo(point: { x: number; y: number }): Promise<void> {
    const window = this.#window;
    if (!window || window.isDestroyed() || !this.#frame) return;
    // The overlay draws in its own client coordinates.
    const local = {
      x: Math.round(point.x - this.#frame.x),
      y: Math.round(point.y - this.#frame.y),
    };
    try {
      await window.webContents.executeJavaScript(
        `FlareAICursorOverlay.moveTo({x: ${local.x}, y: ${local.y}})`,
        true,
      );
    } catch {
      // Presentation must never be the reason an action does not happen.
    }
  }

  /** Aim at the middle of a control's frame, which is where a hand would go. */
  async moveToControl(frame: ScreenFrame): Promise<void> {
    await this.moveTo({
      x: frame.x + frame.width / 2,
      y: frame.y + frame.height / 2,
    });
  }

  hide(): void {
    const window = this.#window;
    this.#window = null;
    this.#frame = null;
    if (window && !window.isDestroyed()) window.destroy();
  }
}

function overlayDocument(): string {
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}</style>
<script>${cursorMotionSource}</script>
<script>${cursorOverlaySource}</script>
<script>FlareAICursorOverlay.show()</script>`;
}

function roundFrame(frame: ScreenFrame): ScreenFrame {
  // Electron wants integer, DIP-space bounds; the controller reports the
  // window's frame in the same space macOS reports it.
  return {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.max(1, Math.round(frame.width)),
    height: Math.max(1, Math.round(frame.height)),
  };
}

function sameFrame(a: ScreenFrame | null, b: ScreenFrame): boolean {
  return (
    a !== null &&
    Math.round(a.x) === Math.round(b.x) &&
    Math.round(a.y) === Math.round(b.y) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height)
  );
}
