/**
 * Isolated-world bridge for vault passkeys. Owns the confirm overlay so page
 * scripts never see locker titles until the user picks one.
 */
(() => {
  "use strict";

  const SOURCE = "polymux-webauthn";
  const HOST_ID = "polymux-passkey-host";
  const UNLOCK_HINT = chrome.runtime.getURL("").startsWith("safari-web-extension:")
    ? "Unlock Locker in the extension popup, then retry."
    : "Unlock Locker in Polymux or the extension popup, then retry.";
  let current = null;

  function injectPageScript() {
    if (document.documentElement?.querySelector("script[data-polymux-webauthn]")) return;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("locker/webauthn-page.js");
    script.async = false;
    script.dataset.polymuxWebauthn = "1";
    script.onload = () => script.remove();
    (document.documentElement || document.head || document.documentElement).prepend(script);
  }

  try {
    injectPageScript();
  } catch {
    // MAIN-world content script already installed the hook.
  }

  function css() {
    return `
      :host { all: initial; }
      .panel {
        position: fixed; z-index: 2147483646; right: 16px; bottom: 16px;
        width: min(280px, calc(100vw - 32px));
        font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #171717; background: #fff;
        border-radius: 12px; padding: 16px 14px 14px;
        box-shadow: 0 12px 40px color-mix(in srgb, #171717 28%, transparent);
      }
      @media (prefers-color-scheme: dark) {
        .panel { color: #f1f0ed; background: #171717; }
      }
      h1 { margin: 0 0 8px; font-size: 14px; font-weight: 650; letter-spacing: -0.02em; }
      p { margin: 0 0 10px; color: color-mix(in srgb, currentColor 55%, transparent); }
      label { display: flex; flex-direction: column; gap: 4px; margin: 0 0 8px;
        color: color-mix(in srgb, currentColor 60%, transparent); font-size: 11px; font-weight: 550; }
      input {
        border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
        border-radius: 8px; padding: 7px 9px; background: transparent; color: inherit; font: inherit;
      }
      input:focus { outline: 0; border-color: color-mix(in srgb, currentColor 40%, transparent); }
      button {
        border: 0; border-radius: 8px; padding: 8px 10px; background: #171717; color: #fff;
        cursor: pointer; font: inherit; font-weight: 600; width: 100%; margin: 0 0 6px;
      }
      @media (prefers-color-scheme: dark) {
        button { background: #f1f0ed; color: #171717; }
      }
      button.quiet { background: transparent; color: inherit; font-weight: 500; }
      button.row {
        display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
        background: color-mix(in srgb, currentColor 6%, transparent); color: inherit; text-align: start;
      }
      button.row span { color: color-mix(in srgb, currentColor 55%, transparent); font-size: 12px; }
      .error { margin: 0 0 8px; font-size: 12px; }
    `;
  }

  function closeOverlay() {
    document.getElementById(HOST_ID)?.remove();
  }

  function overlay(html) {
    closeOverlay();
    const host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({mode: "closed"});
    shadow.innerHTML = `<style>${css()}</style><div class="panel" role="dialog" aria-modal="true">${html}</div>`;
    document.documentElement.appendChild(host);
    return shadow;
  }

  function escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function reply(id, payload) {
    window.postMessage({source: SOURCE, dir: "reply", id, ...payload}, "*");
  }

  function webAuthnOptions(value) {
    const input = value && typeof value === "object" ? value : {};
    const options = {};
    for (const key of ["rpId", "rpName", "challenge", "userName", "userDisplayName", "userId"])
      if (typeof input[key] === "string") options[key] = input[key];
    for (const key of ["allowCredentialIds", "excludeCredentialIds"])
      if (Array.isArray(input[key])) options[key] = input[key].filter((item) => typeof item === "string");
    return options;
  }

  function send(message) {
    return chrome.runtime.sendMessage({...message, type: "polymux:webauthn", origin: location.origin});
  }

  async function unlockIfNeeded(shadow, status) {
    if (status?.unlocked) return true;
    return new Promise((resolve) => {
      const retry = shadow.querySelector("#retry");
      shadow.querySelector("#cancel")?.addEventListener("click", () => {
        closeOverlay();
        resolve(false);
      });
      retry?.addEventListener("click", async () => {
        const error = shadow.querySelector(".error");
        try {
          const next = await send({action: "status"});
          if (!next?.unlocked) throw new Error(`Locker is still locked. ${UNLOCK_HINT}`);
          closeOverlay();
          resolve(true);
        } catch (cause) {
          if (error) {
            error.hidden = false;
            error.textContent = cause instanceof Error ? cause.message : String(cause);
          }
        }
      });
    });
  }

  async function pick(offers, title, confirmLabel) {
    if (!offers.length) return {result: "skip"};
    return new Promise((resolve) => {
      const rows = offers
        .map(
          (item) => `
            <button type="button" class="row" data-id="${escape(item.id)}">
              <strong>${escape(item.title || item.relyingParty)}</strong>
              <span>${escape(item.username)}</span>
            </button>`,
        )
        .join("");
      const shadow = overlay(`
        <h1>${escape(title)}</h1>
        ${rows}
        <button type="button" class="quiet" id="skip">${escape(confirmLabel)}</button>
      `);
      shadow.querySelector("#skip")?.addEventListener("click", () => {
        closeOverlay();
        resolve({result: "skip"});
      });
      for (const button of shadow.querySelectorAll("[data-id]")) {
        button.addEventListener("click", () => {
          closeOverlay();
          resolve({result: "item", itemId: button.dataset.id});
        });
      }
    });
  }

  async function confirmCreate(options) {
    return new Promise((resolve) => {
      const shadow = overlay(`
        <h1>Save passkey</h1>
        <p>${escape(options.userName || "This account")} · ${escape(options.rpId)}</p>
        <button type="button" id="save">Save to Locker</button>
        <button type="button" class="quiet" id="skip">Not now</button>
      `);
      shadow.querySelector("#save")?.addEventListener("click", () => {
        closeOverlay();
        resolve(true);
      });
      shadow.querySelector("#skip")?.addEventListener("click", () => {
        closeOverlay();
        resolve(false);
      });
    });
  }

  async function handleGet(id, options) {
    let probe = await send({...options, action: "offers"});
    if (probe?.error === "locked" || probe?.locked) {
      const shadow = overlay(`
        <h1>Locker is locked</h1>
        <p>${UNLOCK_HINT}</p>
        <div>
          <p class="error" hidden></p>
          <button type="button" id="retry">Retry</button>
          <button type="button" class="quiet" id="cancel">Use another passkey</button>
        </div>
      `);
      const unlocked = await unlockIfNeeded(shadow, {unlocked: false});
      if (!unlocked) {
        reply(id, {result: "skip"});
        return;
      }
      probe = await send({...options, action: "offers"});
    }
    const offers = probe?.offers ?? [];
    if (!offers.length) {
      reply(id, {result: "skip"});
      return;
    }
    const picked = await pick(offers, "Use passkey", "Use another passkey");
    if (picked.result !== "item") {
      reply(id, {result: "skip"});
      return;
    }
    const done = await send({...options, action: "get", itemId: picked.itemId});
    if (done?.credential) reply(id, {result: "credential", credential: done.credential});
    else reply(id, {result: "skip"});
  }

  async function handleCreate(id, options) {
    let status = await send({action: "status"});
    if (status?.error === "locked" || status?.locked || status?.unlocked === false) {
      const shadow = overlay(`
        <h1>Locker is locked</h1>
        <p>${UNLOCK_HINT}</p>
        <div>
          <p class="error" hidden></p>
          <button type="button" id="retry">Retry</button>
          <button type="button" class="quiet" id="cancel">Not now</button>
        </div>
      `);
      const unlocked = await unlockIfNeeded(shadow, {unlocked: false});
      if (!unlocked) {
        reply(id, {result: "skip"});
        return;
      }
    }
    const offered = await send({...options, action: "offers", allowCredentialIds: options.excludeCredentialIds});
    if (offered?.offers?.length) {
      reply(id, {result: "invalid-state"});
      return;
    }
    if (!(await confirmCreate(options))) {
      reply(id, {result: "skip"});
      return;
    }
    const done = await send({...options, action: "create"});
    if (done?.invalidState) reply(id, {result: "invalid-state"});
    else if (done?.credential) reply(id, {result: "credential", credential: done.credential});
    else reply(id, {result: "skip"});
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.dir !== "request") return;
    if (data.origin && data.origin !== location.origin) return;
    if (current) return;
    current = (async () => {
      try {
        if (data.action === "get") await handleGet(data.id, webAuthnOptions(data.options));
        else if (data.action === "create") await handleCreate(data.id, webAuthnOptions(data.options));
        else reply(data.id, {result: "skip"});
      } catch {
        reply(data.id, {result: "skip"});
      } finally {
        current = null;
      }
    })();
  });
})();
