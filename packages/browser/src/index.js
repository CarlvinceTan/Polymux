// @flareai/browser — the agent's command set for a page, over CDP.
//
// Consumers supply a transport and drive `handlers`; see the README for the
// two that exist (the in-app Browser via Electron's webContents.debugger, and
// the user's own browser via the extension's chrome.debugger).

export { handlers, pageInfo } from "./handlers.js";
export { createSession, startSession, stopSession } from "./session.js";
export { renderAxTree } from "./snapshot.js";
export {
  humanPoint,
  humanClick,
  humanScroll,
  humanType,
  insertText,
  keyHalf,
  mouseButton,
  mouseMove,
  pacer,
  parseKey,
  pressKey,
  restingPoint,
  sleep,
} from "./input.js";
export { describeLocator, findByLocator, LOCATOR_KINDS, locatorOf } from "./locators.js";
export { PageObservers } from "./observers.js";
export {
  callOnElement,
  ControlError,
  coveringElement,
  resolveObject,
  resolveTarget,
  TargetError,
} from "./targets.js";
