import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, describe, test } from "node:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, handlers, startSession, stopSession } from "../src/index.js";
import { chromeBinary, startLiveBrowser, type LiveBrowser } from "./live-browser.js";

/**
 * The command set against a real Chromium, over real CDP.
 *
 * The unit suites cover the pure parts; this covers the part that only fails in
 * a browser — that the CDP calls are well-formed, that input actually lands on
 * the element it was aimed at, and that the observers see what the page does.
 * It is what caught a rewrite that had been passing `send` as the CDP method
 * name, which typechecking and parsing both waved through.
 *
 * Skipped unless Chrome is installed, because it drives the real thing.
 */

const FIXTURE = new URL("./fixtures/page.html", import.meta.url).pathname;
// Opt-in: this launches a real browser and takes about a minute, so it is not
// part of `npm test`. Run it with `npm run test:browser-live`.
const requested = process.env.FLAREAI_LIVE_BROWSER === "1";
const available = requested && chromeBinary() !== null;

describe("browser-use against a real browser", { skip: !available && (requested ? "no Chrome installed" : "set FLAREAI_LIVE_BROWSER=1 to run") }, () => {
  let browser: LiveBrowser;
  let session: ReturnType<typeof createSession>;

  before(async () => {
    browser = await startLiveBrowser(FIXTURE);
    session = createSession(browser.transport);
    await startSession(session);
    await handlers.wait(session, { selector: "#buy", timeoutMs: 10_000 });
  });

  after(() => {
    if (session) stopSession(session);
    if (browser) browser.stop();
  });

  const status = async (): Promise<string> =>
    (await handlers.get(session, { selector: "#status", property: "text" })).content;
  const reset = async (): Promise<void> => {
    await handlers.eval(session, {
      expression: "document.getElementById('status').textContent='idle'",
    });
  };

  test("snapshot returns an accessibility tree with actionable refs", async () => {
    const out = await handlers.snapshot(session, {});
    assert.match(out.content, /- button "Buy now" \[ref=e\d+\]/);
    assert.match(out.content, /- heading "Checkout"/);
    assert.ok(session.refs.size > 0, "no refs were recorded");
  });

  test("interactive keeps only what can be acted on", async () => {
    const out = await handlers.snapshot(session, { interactive: true });
    assert.equal(out.content.includes("heading"), false);
    assert.match(out.content, /button/);
  });

  test("a ref from the current snapshot clicks the right element", async () => {
    await reset();
    const snapshot = await handlers.snapshot(session, {});
    const ref = /- button "Buy now" \[ref=(e\d+)\]/.exec(snapshot.content)?.[1];
    assert.ok(ref, "no ref for the button");
    await handlers.click(session, { ref });
    assert.equal(await status(), "bought");
  });

  test("a stale ref is refused rather than resolved to something else", async () => {
    await assert.rejects(
      () => handlers.click(session, { ref: "e9999" }),
      /Unknown ref/,
    );
  });

  test("role and text locators find the button without a selector", async () => {
    await reset();
    await handlers.click(session, { role: "button", name: "Buy now" });
    assert.equal(await status(), "bought");

    await reset();
    await handlers.click(session, { locatorText: "Buy now" });
    assert.equal(await status(), "bought");
  });

  test("a locator that matches nothing says so, and names what it looked for", async () => {
    await assert.rejects(
      () => handlers.click(session, { role: "button", name: "Nonexistent" }),
      /No element matches role="button" name="Nonexistent"/,
    );
  });

  test("fill clears the old value and fires change", async () => {
    await handlers.fill(session, { selector: "#promo", text: "SUMMER" });
    const value = (await handlers.get(session, { selector: "#promo", property: "value" }))
      .content;
    // The field starts with "prefilled"; a fill that appends is the bug here.
    assert.equal(value, "SUMMER");
    assert.equal(await status(), "promo:SUMMER");
  });

  test("type enters text key by key", async () => {
    await handlers.type(session, { selector: "#notes", text: "leave at door" });
    const value = (await handlers.get(session, { selector: "#notes", property: "value" }))
      .content;
    assert.equal(value, "leave at door");
  });

  test("a placeholder locator reaches the field it labels", async () => {
    await handlers.fill(session, { placeholder: "SAVE10", text: "VIAPLACEHOLDER" });
    const value = (await handlers.get(session, { selector: "#promo", property: "value" }))
      .content;
    assert.equal(value, "VIAPLACEHOLDER");
  });

  test("select picks an option by its label", async () => {
    await handlers.select(session, { selector: "#size", value: "Large" });
    assert.equal(await status(), "size:l");
  });

  test("check toggles once and then reports it is already checked", async () => {
    await handlers.check(session, { selector: "#gift" });
    assert.equal(await status(), "gift:true");
    const again = await handlers.check(session, { selector: "#gift" });
    assert.match(again.content, /already/);
  });

  test("upload attaches a real file to a file input", async () => {
    const file = join(tmpdir(), `flareai-upload-${process.pid}.txt`);
    writeFileSync(file, "hello");
    await handlers.upload(session, { selector: "#upload", files: [file] });
    assert.match(await status(), /^file:flareai-upload-/);
  });

  test("a click under an overlay is refused, naming the overlay", async () => {
    await assert.rejects(
      () => handlers.click(session, { selector: "#under" }),
      /covered by div#overlay\.cookie-banner/,
    );
  });

  test("console buffers page logs and uncaught errors from attach onward", async () => {
    await handlers.eval(session, {
      expression:
        "console.log('after attach'); setTimeout(() => { throw new Error('boom'); }, 0)",
    });
    await delay(300);
    const out = await handlers.console(session, {});
    assert.match(out.content, /after attach/);
    assert.match(out.content, /boom/);
  });

  test("network records the requests the page made", async () => {
    await handlers.eval(session, { expression: "fetch('/probe').catch(() => {})" });
    await delay(400);
    const out = await handlers.network(session, {});
    assert.match(out.content, /probe/);
  });

  test("read returns the visible text", async () => {
    const out = await handlers.read(session, { maxChars: 500 });
    assert.match(out.content, /Checkout/);
  });

  test("screenshot returns real PNG bytes", async () => {
    const out = await handlers.screenshot(session, {});
    assert.ok(out.image);
    const header = Buffer.from(out.image.data, "base64").subarray(0, 8);
    assert.deepEqual([...header], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test("wait blocks until the content is really there", async () => {
    await handlers.navigate(session, { url: browser.pageUrl });
    const started = Date.now();
    await handlers.wait(session, { text: "arrived late", timeoutMs: 5_000 });
    // The fixture adds that text after 700ms; returning instantly would mean
    // wait is not actually waiting for anything.
    assert.ok(Date.now() - started > 200, "wait returned before the text existed");
  });

  test("wait times out instead of hanging", async () => {
    await assert.rejects(
      () => handlers.wait(session, { text: "never appears", timeoutMs: 600 }),
      /Timed out/,
    );
  });

  test("a blocking dialog is observed and can be answered", async () => {
    await handlers.snapshot(session, {});
    // confirm() blocks the renderer, so this click cannot be awaited — that is
    // exactly why the dialog is reported through the observer instead.
    void handlers.click(session, { selector: "#confirm" }).catch(() => {});
    for (let attempt = 0; attempt < 50 && !session.observers.dialog; attempt += 1)
      await delay(100);
    assert.ok(session.observers.dialog, "the dialog was never observed");
    assert.match(session.observers.dialog.message, /Place the order/);
    const out = await handlers.dialog(session, { accept: true });
    assert.match(out.content, /accepted/);
  });

  test("scroll moves the page", async () => {
    await handlers.eval(session, { expression: "document.body.style.height='3000px'" });
    await handlers.scroll(session, { deltaY: 500 });
    const after = Number(
      (await handlers.eval(session, { expression: "window.scrollY" })).content,
    );
    assert.ok(after > 0, `scrollY stayed at ${after}`);
  });

  test("the cursor overlay lands on the control before it is used", async () => {
    // Load the shared overlay the way the in-app Browser injects it, then wire
    // it up the way a session does, and watch where it ends up.
    const { readFileSync } = await import("node:fs");
    const source = [
      readFileSync(new URL("../src/cursor-motion.js", import.meta.url).pathname, "utf8"),
      readFileSync(new URL("../src/cursor-overlay.js", import.meta.url).pathname, "utf8"),
    ].join("\n");
    await handlers.eval(session, { expression: source });
    await handlers.eval(session, { expression: "FlareAICursorOverlay.show()" });

    const cursorSession = createSession({
      ...browser.transport,
      async moveCursor(point) {
        await handlers.eval(cursorSession, {
          expression: `FlareAICursorOverlay.moveTo({x:${point.x},y:${point.y}})`,
        });
      },
    });
    cursorSession.refs = session.refs;
    await handlers.snapshot(cursorSession, {});

    // The overlay lives in a closed shadow root, so ask it where it put the
    // cursor rather than trying to query the element.
    const box = JSON.parse(
      (await handlers.get(cursorSession, { selector: "#buy", property: "box" })).content,
    );
    await handlers.click(cursorSession, { selector: "#buy" });

    const host = (
      await handlers.eval(cursorSession, {
        expression: "!!document.getElementById('flareai-agent-overlay-root')",
      })
    ).content;
    assert.equal(host, "true", "the overlay was never attached to the page");

    // The click point is chosen inside the button's box, and the cursor is
    // moved there before the press — so the pointer is on the control the user
    // sees being used, not merely somewhere on the page.
    assert.ok(cursorSession.cursor, "no cursor position was recorded");
    const { x, y } = cursorSession.cursor;
    assert.ok(
      x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height,
      `cursor ${x},${y} landed outside the button ${JSON.stringify(box)}`,
    );
  });

  test("while typing, the cursor waits at the field's corner", async () => {
    const seen: Array<{ x: number; y: number }> = [];
    const watched = createSession({
      ...browser.transport,
      async moveCursor(point) {
        seen.push({ ...point });
      },
    });
    await handlers.snapshot(watched, {});
    const box = JSON.parse(
      (await handlers.get(watched, { selector: "#promo", property: "box" })).content,
    );
    await handlers.fill(watched, { selector: "#promo", text: "CORNER" });

    assert.ok(seen.length >= 2, `expected a move then a retire, got ${seen.length}`);
    const [aimed, rest] = [seen[0], seen[seen.length - 1]];

    // It goes to the text first, because that is what focuses the field and
    // puts the caret in the right place.
    assert.ok(
      aimed.x < box.x + box.width * 0.5,
      `the click aimed at ${aimed.x}, not in the text`,
    );

    // Then it retires to the bottom-right corner, off the text it is entering.
    assert.ok(
      rest.x > box.x + box.width - 8 && rest.x <= box.x + box.width,
      `resting x ${rest.x} is not at the right edge of ${box.x}..${box.x + box.width}`,
    );
    assert.ok(
      rest.y > box.y + box.height - 8 && rest.y <= box.y + box.height,
      `resting y ${rest.y} is not at the bottom edge`,
    );
    // And it is genuinely a different place, reached as its own move — so the
    // user sees it glide clear rather than blink away.
    assert.notDeepEqual(rest, aimed);
  });

  test("every cursor move is a move, not a jump", async () => {
    // The overlay animates whatever it is given; what matters here is that the
    // handlers hand it each destination separately and wait for each arrival,
    // so the path is a sequence of travelled moves.
    const arrivals: number[] = [];
    const watched = createSession({
      ...browser.transport,
      async moveCursor() {
        arrivals.push(Date.now());
        // Stand in for the animation the overlay runs.
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    });
    await handlers.snapshot(watched, {});
    await handlers.click(watched, { selector: "#buy" });
    await handlers.fill(watched, { selector: "#promo", text: "X" });
    assert.ok(arrivals.length >= 3, `expected several separate moves, got ${arrivals.length}`);
  });

  test("a surface with no cursor still acts", async () => {
    // A surface that supplies no cursor at all — the command must still run.
    let moves = 0;
    const fast = createSession({
      ...browser.transport,
      async moveCursor() {
        moves += 1;
      },
    });
    await handlers.snapshot(fast, {});
    await handlers.eval(fast, {
      expression: "document.getElementById('status').textContent='idle'",
    });
    await handlers.click(fast, { selector: "#buy" });
    assert.equal(
      (await handlers.get(fast, { selector: "#status", property: "text" })).content,
      "bought",
    );
    assert.ok(moves > 0, "the pointer action skipped the cursor hook entirely");
  });

  test("snapshot reaches inside an iframe, and its refs work", async () => {
    await handlers.navigate(session, { url: browser.pageUrl });
    await handlers.wait(session, { selector: "#pay", timeoutMs: 5_000 });
    const snapshot = await handlers.snapshot(session, {});

    // The card field lives in the iframe. Without frame splicing the snapshot
    // stops at the Iframe node and this is simply absent.
    assert.match(snapshot.content, /Card number/, "iframe content is missing");
    const ref = /- button "Pay now" \[ref=(e\d+)\]/.exec(snapshot.content)?.[1];
    assert.ok(ref, `no ref for the button inside the iframe:\n${snapshot.content}`);

    await handlers.click(session, { ref });
    // eval returns its value as JSON, so parse rather than compare raw.
    const paid = JSON.parse(
      (
        await handlers.eval(session, {
          expression:
            "document.getElementById('pay').contentDocument.getElementById('paid').textContent",
        })
      ).content,
    );
    assert.equal(paid, "paid", "the click did not land on the button in the frame");
  });

  test("a click inside an iframe uses main-frame coordinates", async () => {
    await handlers.navigate(session, { url: browser.pageUrl });
    await handlers.wait(session, { selector: "#pay", timeoutMs: 5_000 });
    const snapshot = await handlers.snapshot(session, {});
    const ref = /- textbox "Card number" \[ref=(e\d+)\]/.exec(snapshot.content)?.[1];
    assert.ok(ref, `no ref for the field inside the iframe:\n${snapshot.content}`);

    await handlers.fill(session, { ref, text: "4111111111111111" });
    const value = JSON.parse(
      (
        await handlers.eval(session, {
          expression:
            "document.getElementById('pay').contentDocument.getElementById('card').value",
        })
      ).content,
    );
    // A frame-relative rect would put the pointer roughly 300px too high, in
    // the main document, and this value would still be empty.
    assert.equal(value, "4111111111111111");
  });

  test("the travel pace knob actually changes how long a glide takes", async () => {
    // This exists because the knob was once a no-op and looked fine: the
    // measurement was taking the first-move path, which teleports, so nothing
    // it tuned ever ran. Warm the renderer with a move before timing the next
    // one, or this measures a teleport again.
    const { readFileSync } = await import("node:fs");
    const motion = readFileSync(
      new URL("../src/cursor-motion.js", import.meta.url).pathname,
      "utf8",
    );

    const timeGlide = async (scale: number): Promise<number> => {
      await browser.transport.send("Runtime.evaluate", { expression: motion });
      const outcome = (await browser.transport.send("Runtime.evaluate", {
        expression: `new Promise((resolve) => {
          document.getElementById('pace-probe')?.remove();
          const root = document.createElement('div');
          root.id = 'pace-probe';
          root.style.cssText = 'position:fixed;inset:0;pointer-events:none';
          document.body.appendChild(root);
          const renderer = FlareAICursorMotion.createRenderer(root, {
            travelScale: ${scale},
            onArrived() { done(); },
          });
          const view = { width: innerWidth, height: innerHeight };
          const move = (x, y, seq, animate) => renderer.setState({
            cursor: { x, y, visible: true, animateMovement: animate, moveSequence: seq },
            isVisible: true, turnKey: 'pace', viewportSize: view,
          });
          let warmed = false;
          let started = 0;
          function done() {
            if (!warmed) {
              warmed = true;
              setTimeout(() => { started = performance.now(); move(900, 620, 3, true); }, 60);
            } else {
              resolve(Math.round(performance.now() - started));
            }
          }
          move(60, 80, 1, false);
          setTimeout(() => move(120, 140, 2, true), 120);
        })`,
        awaitPromise: true,
        returnByValue: true,
      })) as { result: { value: number } };
      return outcome.result.value;
    };

    const brisk = await timeGlide(1);
    const calm = await timeGlide(2.5);
    assert.ok(brisk > 40, `a glide at pace 1 took ${brisk}ms — that is a teleport, not a move`);
    assert.ok(
      calm > brisk * 1.4,
      `pace 2.5 took ${calm}ms against ${brisk}ms at pace 1 — the knob is not reaching the springs`,
    );
  });

  test("an unwatched surface is not slowed by the cursor", async () => {
    // The point of the whole arrangement: the cursor must never be the reason
    // a run is slow. Same work, same animation, only the watching differs.
    const run = async (observed: boolean): Promise<number> => {
      let moves = 0;
      const session = createSession({
        ...browser.transport,
        observed: () => observed,
        async moveCursor() {
          moves += 1;
          // Stand in for a real glide.
          await new Promise((resolve) => setTimeout(resolve, 300));
        },
      });
      await handlers.snapshot(session, {});
      const started = Date.now();
      for (let n = 0; n < 4; n += 1) await handlers.click(session, { selector: "#buy" });
      const elapsed = Date.now() - started;
      assert.ok(moves >= 4, `the cursor was not driven at all (${moves} moves)`);
      return elapsed;
    };

    const watched = await run(true);
    const unwatched = await run(false);
    assert.ok(
      unwatched < watched - 300,
      `unwatched ${unwatched}ms vs watched ${watched}ms — the cursor is still gating execution`,
    );
  });

  test("a slow cursor cannot stall an action indefinitely", async () => {
    // Even watched, the wait is capped: a cursor that never arrives must not
    // wedge the run.
    const session = createSession({
      ...browser.transport,
      observed: () => true,
      moveCursor: () => new Promise(() => {}),
    });
    await handlers.snapshot(session, {});
    const started = Date.now();
    await handlers.click(session, { selector: "#buy" });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 3_000, `a never-arriving cursor held the click for ${elapsed}ms`);
  });

  test("back and forward walk the history", async () => {
    await handlers.navigate(session, { url: `${browser.pageUrl}?second` });
    await handlers.back(session);
    const back = (await handlers.eval(session, { expression: "location.href" })).content;
    assert.equal(back.includes("second"), false);
    await handlers.forward(session);
    const forward = (await handlers.eval(session, { expression: "location.href" }))
      .content;
    assert.ok(forward.includes("second"));
  });
});
