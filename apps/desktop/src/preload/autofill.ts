import { contextBridge, ipcRenderer } from "electron";

/**
 * Runs inside every embedded browser tab.
 *
 * Electron has no credential autofill of its own — no save-password bar, no
 * form filling — so the part of a browser the user expects to be there has to
 * be built. This is the page half: it finds login forms, offers what is saved
 * for the site, and reports a submitted one so the password can be saved.
 *
 * Two rules shape all of it:
 *
 * 1. Nothing is filled without the user asking. A page load reports what it
 *    found and stops. A hidden form on a page the user never interacted with
 *    must never be able to read a stored password out of the vault, because a
 *    filled field is readable by the page's own scripts.
 * 2. Nothing here holds a password longer than the fill itself. The main
 *    process sends one credential in answer to one request and the value is
 *    dropped as soon as it is written into the field.
 */

const CHANNEL = "flareai:autofill";

interface FormFields {
  username: HTMLInputElement | null;
  password: HTMLInputElement;
}

/** A password field the user could actually type into. Hidden and disabled
 * fields are skipped: they are usually a decoy, a leftover, or a second form
 * the page keeps off screen. */
function visible(element: HTMLElement): boolean {
  if (element.hasAttribute("hidden")) return false;
  const input = element as HTMLInputElement;
  if (input.disabled || input.readOnly || input.type === "hidden") return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return element.getClientRects().length > 0;
}

/**
 * The username field for a password field: the last text-like input before it
 * in document order. Sites label these a dozen ways — "email", "login",
 * "user", nothing at all — so position is more reliable than any name match.
 */
function usernameFor(password: HTMLInputElement, root: ParentNode): HTMLInputElement | null {
  const candidates = [...root.querySelectorAll("input")].filter(
    (input) =>
      ["text", "email", "tel", ""].includes(input.type) &&
      visible(input) &&
      password.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING,
  );
  return candidates.at(-1) ?? null;
}

function loginForms(): FormFields[] {
  const found: FormFields[] = [];
  for (const password of document.querySelectorAll<HTMLInputElement>("input[type=password]")) {
    if (!visible(password)) continue;
    // A change-password form has two or three password fields; filling a saved
    // password into one is wrong, so only single-password forms are offered.
    const scope: ParentNode = password.form ?? document;
    const passwordCount = [...scope.querySelectorAll<HTMLInputElement>("input[type=password]")]
      .filter(visible).length;
    if (passwordCount !== 1) continue;
    found.push({ username: usernameFor(password, scope), password });
  }
  return found;
}

/**
 * Writes a value the way a person would, so a framework notices.
 *
 * React and Vue track the input's value through their own setter and ignore a
 * plain assignment, leaving the field looking filled while the app's state
 * still holds an empty string — the form then submits nothing. Going through
 * the native setter and dispatching the events a keystroke produces is what
 * makes the page believe it.
 */
function fillField(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter ? setter.call(field, value) : (field.value = value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The last count reported, so an unchanged page stays quiet. */
let reportedForms = -1;

function report(): void {
  const forms = loginForms().length;
  if (forms === reportedForms) return;
  reportedForms = forms;
  ipcRenderer.send(CHANNEL, { kind: "page", origin: location.origin, forms });
}

/** Watches for a submitted login so it can be offered for saving. A single-page
 * app never fires a navigation, so the submit itself is the signal. */
function watchSubmissions(): void {
  const capture = (): void => {
    const form = loginForms()[0];
    if (!form?.password.value) return;
    ipcRenderer.send(CHANNEL, {
      kind: "submitted",
      origin: location.origin,
      username: form.username?.value ?? "",
      password: form.password.value,
    });
  };
  document.addEventListener("submit", capture, true);
  // Plenty of sign-in buttons are not submit buttons, so a click on one that
  // sits beside a filled password field counts too.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const button = target.closest("button, input[type=submit], [role=button]");
      if (button) setTimeout(capture, 0);
    },
    true,
  );
}

ipcRenderer.on(CHANNEL, (_event, message: { kind: string; username?: string; password?: string }) => {
  if (message.kind !== "fill" || !message.password) return;
  const form = loginForms()[0];
  if (!form) return;
  if (form.username && message.username) fillField(form.username, message.username);
  fillField(form.password, message.password);
});

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", () => {
    report();
    watchSubmissions();
  });
else {
  report();
  watchSubmissions();
}

// Sites that swap their sign-in form in after load — most single-page apps —
// would otherwise never be noticed, because the form did not exist when the
// document finished parsing. Coalesced to one check per frame: a busy page
// mutates constantly, and re-scanning on each one would cost more than the
// feature is worth.
let scanQueued = false;
const observer = new MutationObserver(() => {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    report();
  });
});
observer.observe(document.documentElement, { childList: true, subtree: true });

// Nothing is exposed to the page: this bridge exists so the module counts as a
// preload rather than being tree-shaken to nothing, and so page scripts cannot
// reach ipcRenderer.
contextBridge.exposeInMainWorld("__flareaiAutofill", { present: true });
