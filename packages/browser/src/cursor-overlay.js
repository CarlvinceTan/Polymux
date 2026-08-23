// The agent's cursor, as the user sees it.
//
// A classic script (not a module): the browser extension loads it as a content
// script, and the in-app Browser injects the same source into every document.
// It defines `globalThis.PolymuxCursorOverlay` on top of PolymuxCursorMotion,
// which must be loaded first.
//
// The contract is one call — `moveTo(point)` resolves when the cursor has
// actually arrived — because the point of the cursor is that the user sees the
// pointer reach a control *before* that control is used. An action that fires
// while the cursor is still travelling reads as two unrelated events.
(() => {
  "use strict";

  const rand = (min, max) => min + Math.random() * (max - min);
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const paced = (min, max) => rand(min, max) * 1.65;

  let overlayHost = null;
  let renderer = null;
  let arrivals = new Map();
  let sequence = 0;
  let superseded = null;
  let lastPoint = null;
  let hidden = false;

  function viewportSize() {
    return {
      height: window.visualViewport?.height ?? window.innerHeight,
      width: window.visualViewport?.width ?? window.innerWidth,
    };
  }

  function ensure() {
    if (renderer) return renderer;
    overlayHost = document.createElement("div");
    overlayHost.id = "polymux-agent-overlay-root";
    overlayHost.dataset.polymuxOverlayRoot = "";
    // A closed shadow root with `all: initial` so no page stylesheet can
    // restyle the cursor, and nothing the page queries can find it.
    const shadow = overlayHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent =
      ".polymux-overlay{all:initial;z-index:2147483646;pointer-events:none;position:fixed;inset:0}@media print{.polymux-overlay{display:none}}";
    const root = document.createElement("div");
    root.className = "polymux-overlay";
    root.setAttribute("aria-hidden", "true");
    shadow.append(style, root);
    (document.documentElement ?? document).appendChild(overlayHost);

    renderer = globalThis.PolymuxCursorMotion.createRenderer(root, {
      glowColor: "#339cff",
      onArrived(moveSequence) {
        const settle = arrivals.get(moveSequence);
        if (!settle) return;
        arrivals.delete(moveSequence);
        settle();
      },
    });
    return renderer;
  }

  /** Put the cursor somewhere and resolve once it has landed there. */
  function step(point) {
    return new Promise((resolve) => {
      ensure();
      sequence += 1;
      const moveSequence = sequence;
      arrivals.set(moveSequence, resolve);
      renderer.setState({
        cursor: {
          x: point.x,
          y: point.y,
          visible: true,
          animateMovement: true,
          moveSequence,
        },
        isVisible: true,
        turnKey: "polymux",
        viewportSize: viewportSize(),
      });
    });
  }

  /**
   * Travel to a point the way a hand does.
   *
   * A long move lands slightly short, settles, then makes the small corrective
   * hop (Fitts' law). Going straight to the target every time is the clearest
   * tell that nothing is really holding the mouse.
   */
  async function moveTo(point) {
    if (hidden) return;
    // A newer destination makes the one in flight irrelevant: settle its
    // waiter and retarget. Queueing them instead is what makes the pointer
    // trail an agent that has long since moved on.
    superseded?.();
    let live = true;
    const cancel = () => {
      live = false;
      for (const [, settle] of arrivals) settle();
      arrivals.clear();
    };
    superseded = cancel;
    const from = lastPoint ?? {
      x: Math.round(window.innerWidth * 0.58),
      y: Math.round(window.innerHeight * 0.55),
    };
    const distance = Math.hypot(point.x - from.x, point.y - from.y);
    if (distance > 260) {
      const shortfall = rand(24, 64);
      const angle = Math.atan2(point.y - from.y, point.x - from.x);
      const side = angle + Math.PI / 2;
      const miss = rand(-14, 14);
      await step({
        x: Math.round(point.x - Math.cos(angle) * shortfall + Math.cos(side) * miss),
        y: Math.round(point.y - Math.sin(angle) * shortfall + Math.sin(side) * miss),
      });
      if (!live) return;
      await sleep(paced(50, 110));
    }
    if (!live) return;
    await step(point);
    if (superseded === cancel) superseded = null;
    lastPoint = point;
  }

  function show() {
    hidden = false;
    ensure();
  }

  function hide() {
    hidden = true;
    for (const [, settle] of arrivals) settle();
    arrivals.clear();
    renderer?.destroy();
    renderer = null;
    overlayHost?.remove();
    overlayHost = null;
    lastPoint = null;
  }

  function rerender() {
    if (!renderer || !lastPoint) return;
    renderer.setState({
      cursor: { ...lastPoint, visible: true, animateMovement: false, moveSequence: sequence },
      isVisible: true,
      turnKey: "polymux",
      viewportSize: viewportSize(),
    });
  }

  window.addEventListener("resize", rerender);
  window.visualViewport?.addEventListener("resize", rerender);

  globalThis.PolymuxCursorOverlay = { ensure, moveTo, show, hide, rerender };
})();
