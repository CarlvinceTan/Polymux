import cursorMotionSource from "@flareai/browser/src/cursor-motion.js?raw";
import cursorOverlaySource from "@flareai/browser/src/cursor-overlay.js?raw";
import type { CdpTransport } from "./cdp.js";

/**
 * The agent's cursor in the in-app Browser.
 *
 * The same overlay the extension shows in the user's own browser, injected
 * into every document of a tab the agent drives. Two reasons it is injected
 * rather than drawn over the view from the main process: it has to sit in the
 * page's own coordinate space so it lands exactly on the control being used,
 * and it has to survive navigation without a round trip.
 *
 * It is shown for as long as the agent holds the tab, not only while that tab
 * happens to be on screen: the user can look over at any moment, and a cursor
 * that only appears once they are already watching is a cursor that is never
 * there when they first glance. The overlay lives in the page, so an off-screen
 * tab renders nothing and costs nothing to keep armed.
 */
export class PageCursor {
  #transport: CdpTransport;
  #installed = false;
  #active = false;

  constructor(transport: CdpTransport) {
    this.#transport = transport;
  }

  /** Inject the overlay into this document and every later one. */
  async install(): Promise<void> {
    if (this.#installed) return;
    const source = `${cursorMotionSource}\n${cursorOverlaySource}`;
    // For documents that come later…
    await this.#transport.send("Page.addScriptToEvaluateOnNewDocument", { source });
    // …and for the one already loaded.
    await this.#transport.send("Runtime.evaluate", { expression: source });
    this.#installed = true;
    if (this.#active) await this.#evaluate("FlareAICursorOverlay.show()").catch(() => {});
  }

  /**
   * Arm the cursor for as long as the agent is working in this tab. Called when
   * the session opens and cleared when it is released, so the pointer is on the
   * page whenever there is something to see, whichever tab the user is looking
   * at.
   */
  async setActive(active: boolean): Promise<void> {
    if (active === this.#active) return;
    this.#active = active;
    if (!this.#installed) return;
    await this.#evaluate(
      active ? "FlareAICursorOverlay.show()" : "FlareAICursorOverlay.hide()",
    ).catch(() => {
      // A navigating or closing page is not worth failing a command over.
    });
  }

  /**
   * Move the cursor to a point and resolve once it has arrived — so the click
   * that follows is something the user watched happen, rather than a result
   * that appeared while the pointer was still in flight.
   */
  async moveTo(point: { x: number; y: number }): Promise<void> {
    if (!this.#active) return;
    try {
      await this.install();
      await this.#evaluate(
        `FlareAICursorOverlay.moveTo({x: ${Math.round(point.x)}, y: ${Math.round(point.y)}})`,
        true,
      );
    } catch {
      // Presentation must never be the reason an action does not happen.
    }
  }

  async #evaluate(expression: string, awaitPromise = false): Promise<void> {
    await this.#transport.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
  }
}
