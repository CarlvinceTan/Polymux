// Humanized trusted input over CDP.
//
// Randomized in-box click targets, aim and hold delays, per-character cadence
// with occasional thinking pauses, accel/cruise/decel scrolling — but the
// events go through `Input.dispatchMouseEvent` / `dispatchKeyEvent` rather
// than synthetic DOM events. That matters twice over: CDP input is trusted,
// so sites that gate on `isTrusted` behave, and it reaches a tab that is not
// in front, so driving one never has to pull it over what the user is doing.
//
// Every function takes the caller's `send`, so this file knows nothing about
// which browser it is driving.

const rand = (min, max) => min + Math.random() * (max - min);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// calm is the default assistant temperament — unhurried, clearly human. fast
// is the quickest profile that still reads as a person rather than a script.
const PACE = { fast: 1, calm: 1.65 };

export function pacer(pace) {
  const factor = PACE[pace] ?? PACE.calm;
  return (min, max) => rand(min, max) * factor;
}

/**
 * Where inside an element a hand would actually land: inputs toward the left
 * of the box (in the text, not the trailing whitespace), buttons near the
 * middle. Never dead-centre twice.
 */
export function humanPoint(box, textual) {
  const xFraction = textual ? rand(0.15, 0.45) : rand(0.35, 0.65);
  const yFraction = textual ? rand(0.3, 0.7) : rand(0.35, 0.65);
  return {
    x: Math.round(box.x + box.width * xFraction),
    y: Math.round(box.y + box.height * yFraction),
  };
}

/**
 * Where the pointer waits while a field is being typed into.
 *
 * The click still lands in the text — that is what focuses the field and puts
 * the caret in the right place — but leaving the pointer there covers the very
 * text being entered. So once the field is focused the cursor retires to the
 * field's bottom-right corner: the glyph is drawn down and to the right of its
 * point, so its tip touches the field while its body falls outside, and the
 * text stays readable as it appears.
 *
 * Deliberately not a click target. Aiming a real click at the bottom-right of
 * an input is how you hit the clear button, the password reveal, or the search
 * submit that so many fields tuck in that corner.
 */
export function restingPoint(box) {
  return {
    x: Math.round(box.x + box.width - rand(1, 4)),
    y: Math.round(box.y + box.height - rand(1, 4)),
  };
}

const BUTTON_MASK = { left: 1, middle: 4, right: 2 };

export async function mouseMove(send, point, button = "none") {
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button,
    buttons: button === "none" ? 0 : (BUTTON_MASK[button] ?? 0),
  });
}

export async function mouseButton(send, point, type, button, clickCount) {
  await send("Input.dispatchMouseEvent", {
    type,
    x: point.x,
    y: point.y,
    button,
    buttons: type === "mousePressed" ? (BUTTON_MASK[button] ?? 1) : 0,
    clickCount,
  });
}

/**
 * A click with the beat before and the hold during. A zero-width press at an
 * exact box centre is the clearest tell that nobody is really there.
 */
export async function humanClick(
  send,
  point,
  { paced, button = "left", clickCount = 1, textual = false } = {},
) {
  await mouseMove(send, point);
  await sleep(textual ? paced(60, 130) : paced(80, 160));
  for (let n = 1; n <= clickCount; n += 1) {
    await mouseButton(send, point, "mousePressed", button, n);
    await sleep(textual ? paced(40, 80) : paced(50, 100));
    await mouseButton(send, point, "mouseReleased", button, n);
    if (n < clickCount) await sleep(paced(60, 110));
  }
}

// Keys that need an explicit virtual-key code; everything else is treated as
// a text character and carries its own code point.
const NAMED_KEYS = {
  Enter: { keyCode: 13, code: "Enter", text: "\r" },
  Tab: { keyCode: 9, code: "Tab", text: "\t" },
  Escape: { keyCode: 27, code: "Escape" },
  Backspace: { keyCode: 8, code: "Backspace" },
  Delete: { keyCode: 46, code: "Delete" },
  ArrowUp: { keyCode: 38, code: "ArrowUp" },
  ArrowDown: { keyCode: 40, code: "ArrowDown" },
  ArrowLeft: { keyCode: 37, code: "ArrowLeft" },
  ArrowRight: { keyCode: 39, code: "ArrowRight" },
  Home: { keyCode: 36, code: "Home" },
  End: { keyCode: 35, code: "End" },
  PageUp: { keyCode: 33, code: "PageUp" },
  PageDown: { keyCode: 34, code: "PageDown" },
  Space: { keyCode: 32, code: "Space", text: " " },
};

const MODIFIER_BITS = { Alt: 1, Control: 2, Ctrl: 2, Meta: 8, Command: 8, Shift: 4 };

/** Parse "Control+Shift+a" into a dispatchKeyEvent descriptor. */
export function parseKey(spec) {
  const parts = String(spec).split("+").filter(Boolean);
  const name = parts.pop() ?? "";
  let modifiers = 0;
  for (const part of parts) modifiers |= MODIFIER_BITS[part] ?? 0;

  const named = NAMED_KEYS[name] ?? NAMED_KEYS[name?.[0]?.toUpperCase() + name?.slice(1)];
  if (named)
    return {
      key: name,
      code: named.code,
      windowsVirtualKeyCode: named.keyCode,
      nativeVirtualKeyCode: named.keyCode,
      // A modified key press is a shortcut, not text entry: sending text with
      // Control held would insert the character as well as fire the shortcut.
      text: modifiers === 0 ? named.text : undefined,
      modifiers,
    };

  const character = name.length === 1 ? name : name.slice(0, 1);
  const upper = character.toUpperCase();
  const keyCode = upper.charCodeAt(0);
  return {
    key: character,
    code: /[a-zA-Z]/.test(character) ? `Key${upper}` : undefined,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    text: modifiers === 0 || modifiers === 4 ? character : undefined,
    modifiers: modifiers || (/[A-Z]/.test(character) ? 4 : 0),
  };
}

export async function pressKey(send, spec) {
  const key = parseKey(spec);
  await send("Input.dispatchKeyEvent", {
    type: key.text ? "keyDown" : "rawKeyDown",
    ...key,
  });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
}

export async function keyHalf(send, spec, type) {
  await send("Input.dispatchKeyEvent", { type, ...parseKey(spec) });
}

/** Type text one key at a time, at a human cadence. */
export async function humanType(send, text, { paced }) {
  for (const character of text) {
    if (character === "\n") {
      await pressKey(send, "Enter");
    } else {
      const key = parseKey(character);
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
    }
    await sleep(Math.random() < 0.03 ? paced(220, 480) : paced(35, 110));
  }
}

/** Insert text in one shot — no per-key events. Fast, and right for pasting. */
export async function insertText(send, text) {
  await send("Input.insertText", { text });
}

/** A wheel spin rather than a teleport: accelerate, cruise, decelerate. */
export async function humanScroll(send, point, deltaY, deltaX, { paced }) {
  const total = Math.abs(deltaY) + Math.abs(deltaX);
  if (total === 0) return;
  const steps = [];
  const accel = Math.round(rand(2, 3));
  const decel = Math.round(rand(2, 3));
  let remaining = total;
  while (remaining > 0) {
    const cruise = steps.length >= accel && remaining > 220;
    const step = Math.min(remaining, cruise ? rand(100, 150) : rand(60, 95));
    steps.push(step);
    remaining -= step;
  }
  const yShare = deltaY / total;
  const xShare = deltaX / total;
  for (let index = 0; index < steps.length; index += 1) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: point.x,
      y: point.y,
      deltaX: Math.round(steps[index] * xShare),
      deltaY: Math.round(steps[index] * yShare),
    });
    const slow = index < accel || index >= steps.length - decel;
    await sleep(slow ? paced(60, 110) : paced(25, 50));
  }
}
