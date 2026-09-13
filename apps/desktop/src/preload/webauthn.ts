import { ipcRenderer, webFrame } from "electron";

const CHANNEL = "polymux:webauthn";
const SOURCE = "polymux-webauthn";
const HOST_ID = "polymux-passkey-host";
let pendingRequest = false;

/**
 * Vault passkeys in the in-app Browser view. The page half is injected into
 * the guest world so it can wrap navigator.credentials; the overlay and IPC
 * stay in this isolated preload.
 */
export function installLockerWebAuthn(): void {
  void webFrame.executeJavaScript(`(${pageHook.toString()})()`);
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data as {source?: string; dir?: string; id?: number; action?: string; options?: Record<string, string>} | null;
    if (!data || data.source !== SOURCE || data.dir !== "request" || data.id == null) return;
    if (pendingRequest) { reply(data.id, {result: "skip"}); return; }
    pendingRequest = true;
    void handle(data.id, data.action ?? "", webAuthnOptions(data.options)).finally(() => { pendingRequest = false; });
  });
}

// The page can post arbitrary objects, bypassing the injected wrapper entirely.
function webAuthnOptions(value: unknown): Record<string, unknown> {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const options: Record<string, unknown> = {};
  for (const key of ["rpId", "rpName", "challenge", "userName", "userDisplayName", "userId"])
    if (typeof input[key] === "string") options[key] = input[key];
  for (const key of ["allowCredentialIds", "excludeCredentialIds"])
    if (Array.isArray(input[key])) options[key] = input[key].filter((item) => typeof item === "string");
  return options;
}

async function handle(id: number, action: string, options: Record<string, unknown>): Promise<void> {
  try {
    if (action === "get") await handleGet(id, options);
    else if (action === "create") await handleCreate(id, options);
    else reply(id, {result: "skip"});
  } catch {
    reply(id, {result: "skip"});
  }
}

async function invoke(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (await ipcRenderer.invoke(CHANNEL, payload)) as Record<string, unknown>;
}

async function handleGet(id: number, options: Record<string, unknown>): Promise<void> {
  let probe = await invoke({...options, action: "offers"});
  if (probe.locked) {
    if (!(await unlockOverlay())) {
      reply(id, {result: "skip"});
      return;
    }
    probe = await invoke({...options, action: "offers"});
  }
  const offers = Array.isArray(probe.offers) ? probe.offers : [];
  if (!offers.length) {
    reply(id, {result: "skip"});
    return;
  }
  const picked = await pick(offers as Offer[], "Use passkey", "Use another passkey");
  if (!picked) {
    reply(id, {result: "skip"});
    return;
  }
  const done = await invoke({...options, action: "get", itemId: picked});
  if (done.credential) reply(id, {result: "credential", credential: done.credential});
  else reply(id, {result: "skip"});
}

async function handleCreate(id: number, options: Record<string, unknown>): Promise<void> {
  const status = await invoke({action: "status"});
  if (status.locked || status.unlocked === false) {
    if (!(await unlockOverlay())) {
      reply(id, {result: "skip"});
      return;
    }
  }
  if (!(await confirm(`Save passkey`, `${String(options.userName || "This account")} · ${String(options.rpId || "")}`))) {
    reply(id, {result: "skip"});
    return;
  }
  const done = await invoke({...options, action: "create"});
  if (done.invalidState) reply(id, {result: "invalid-state"});
  else if (done.credential) reply(id, {result: "credential", credential: done.credential});
  else reply(id, {result: "skip"});
}

function reply(id: number, payload: Record<string, unknown>): void {
  window.postMessage({source: SOURCE, dir: "reply", id, ...payload}, "*");
}

interface Offer {
  id: string;
  title?: string;
  username?: string;
  relyingParty?: string;
}

function unlockOverlay(): Promise<boolean> {
  return new Promise((resolve) => {
    const shadow = overlay(`
      <h1>Locker is locked</h1>
      <p>Unlock Locker in Polymux, then retry.</p>
      <p class="error" hidden></p>
      <button type="button" id="retry">Retry</button>
      <button type="button" class="quiet" id="cancel">Not now</button>
    `);
    shadow.getElementById("cancel")?.addEventListener("click", () => {
      closeOverlay();
      resolve(false);
    });
    shadow.getElementById("retry")?.addEventListener("click", () => {
      void invoke({action: "status"}).then((next) => {
        if (next.unlocked) { closeOverlay(); resolve(true); return; }
        const error = shadow.querySelector(".error") as HTMLElement | null;
        if (error) { error.hidden = false; error.textContent = "Locker is still locked. Unlock it in Polymux."; }
      }).catch(() => {
        const error = shadow.querySelector(".error") as HTMLElement | null;
        if (error) { error.hidden = false; error.textContent = "Could not connect to Locker. Try again."; }
      });
    });
  });
}

function pick(offers: Offer[], title: string, skip: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rows = offers
      .map(
        (item) => `
          <button type="button" class="row" data-id="${escapeHtml(item.id)}">
            <strong>${escapeHtml(item.title || item.relyingParty || "")}</strong>
            <span>${escapeHtml(item.username || "")}</span>
          </button>`,
      )
      .join("");
    const shadow = overlay(`<h1>${escapeHtml(title)}</h1>${rows}<button type="button" class="quiet" id="skip">${escapeHtml(skip)}</button>`);
    shadow.getElementById("skip")?.addEventListener("click", () => {
      closeOverlay();
      resolve(null);
    });
    for (const button of shadow.querySelectorAll("[data-id]")) {
      button.addEventListener("click", () => {
        closeOverlay();
        resolve((button as HTMLElement).dataset.id ?? null);
      });
    }
  });
}

function confirm(title: string, detail: string): Promise<boolean> {
  return new Promise((resolve) => {
    const shadow = overlay(`
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(detail)}</p>
      <button type="button" id="save">Save to Locker</button>
      <button type="button" class="quiet" id="skip">Not now</button>
    `);
    shadow.getElementById("save")?.addEventListener("click", () => {
      closeOverlay();
      resolve(true);
    });
    shadow.getElementById("skip")?.addEventListener("click", () => {
      closeOverlay();
      resolve(false);
    });
  });
}

function overlay(html: string): ShadowRoot {
  closeOverlay();
  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({mode: "closed"});
  shadow.innerHTML = `<style>${overlayCss()}</style><div class="panel" role="dialog" aria-modal="true">${html}</div>`;
  document.documentElement.appendChild(host);
  return shadow;
}

function closeOverlay(): void {
  document.getElementById(HOST_ID)?.remove();
}

function overlayCss(): string {
  return `
    :host { all: initial; }
    .panel {
      position: fixed; z-index: 2147483646; right: 16px; bottom: 16px;
      width: min(280px, calc(100vw - 32px));
      font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #171717; background: #fff; border-radius: 12px; padding: 16px 14px 14px;
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
    button {
      border: 0; border-radius: 8px; padding: 8px 10px; background: #171717; color: #fff;
      cursor: pointer; font: inherit; font-weight: 600; width: 100%; margin: 0 0 6px;
    }
    @media (prefers-color-scheme: dark) { button { background: #f1f0ed; color: #171717; } }
    button.quiet { background: transparent; color: inherit; font-weight: 500; }
    button.row {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
      background: color-mix(in srgb, currentColor 6%, transparent); color: inherit; text-align: start;
    }
    button.row span { color: color-mix(in srgb, currentColor 55%, transparent); font-size: 12px; }
    .error { margin: 0 0 8px; font-size: 12px; }
  `;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function pageHook(): void {
  const credentials = navigator.credentials as CredentialsContainer & {__polymuxPasskeys?: boolean};
  if (credentials?.__polymuxPasskeys) return;
  if (!credentials?.get || !credentials?.create) return;
  const original = credentials;
  const source = "polymux-webauthn";
  let nextId = 1;
  const pending = new Map<number, (reply: Record<string, unknown>) => void>();
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data as {source?: string; dir?: string; id?: number} | null;
    if (!data || data.source !== source || data.dir !== "reply" || data.id == null) return;
    const wait = pending.get(data.id);
    if (!wait) return;
    pending.delete(data.id);
    wait(data as Record<string, unknown>);
  });
  function bufferToB64(value: BufferSource | undefined): string {
    if (value == null) return "";
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function b64ToBuffer(value: string): ArrayBuffer {
    if (!value) return new ArrayBuffer(0);
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }
  function ask(action: string, options: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        pending.delete(id);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, {once: true});
      pending.set(id, (reply) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(reply);
      });
      window.postMessage({source, dir: "request", id, action, origin: location.origin, options}, "*");
    });
  }
  function proto(object: object, type: {prototype?: object} | undefined): object {
    if (type?.prototype) Object.setPrototypeOf(object, type.prototype);
    return object;
  }
  const wrapped = {
    ...original,
    __polymuxPasskeys: true,
    async get(options: CredentialRequestOptions = {}) {
      if (!options.publicKey) return original.get(options);
      try {
        const publicKey = options.publicKey;
        const reply = await ask(
          "get",
          {
            rpId: publicKey.rpId || location.hostname,
            challenge: bufferToB64(publicKey.challenge),
            allowCredentialIds: (publicKey.allowCredentials || []).map((item) => bufferToB64(item.id)),
          },
          options.signal ?? undefined,
        );
        if (reply.result === "credential") {
          const payload = reply.credential as Record<string, string>;
          const response = proto(
            {
              clientDataJSON: b64ToBuffer(payload.clientDataJSON),
              authenticatorData: b64ToBuffer(payload.authenticatorData),
              signature: b64ToBuffer(payload.signature),
              userHandle: payload.userHandle ? b64ToBuffer(payload.userHandle) : null,
            },
            window.AuthenticatorAssertionResponse,
          );
          const credential = proto(
            {
              id: payload.id,
              rawId: b64ToBuffer(payload.rawId),
              type: "public-key",
              authenticatorAttachment: "platform",
              response,
              getClientExtensionResults: () => ({}),
            },
            window.PublicKeyCredential,
          );
          return credential as PublicKeyCredential;
        }
      } catch (error) {
        if ((error as DOMException).name === "AbortError") throw error;
      }
      return original.get(options);
    },
    async create(options: CredentialCreationOptions = {}) {
      if (!options.publicKey) return original.create(options);
      try {
        const publicKey = options.publicKey;
        const user = publicKey.user;
        const rp = publicKey.rp;
        const reply = await ask(
          "create",
          {
            rpId: rp.id || location.hostname,
            rpName: rp.name || "",
            challenge: bufferToB64(publicKey.challenge),
            userName: user.name || "",
            userDisplayName: user.displayName || "",
            userId: bufferToB64(user.id),
            excludeCredentialIds: (publicKey.excludeCredentials || []).map((item) => bufferToB64(item.id)),
          },
          options.signal ?? undefined,
        );
        if (reply.result === "invalid-state")
          throw new DOMException("A passkey for this site is already saved.", "InvalidStateError");
        if (reply.result === "credential") {
          const payload = reply.credential as Record<string, string> & {transports?: string[]};
          const response = proto(
            {
              clientDataJSON: b64ToBuffer(payload.clientDataJSON),
              attestationObject: b64ToBuffer(payload.attestationObject),
              getTransports: () => payload.transports || ["internal"],
            },
            window.AuthenticatorAttestationResponse,
          );
          const credential = proto(
            {
              id: payload.id,
              rawId: b64ToBuffer(payload.rawId),
              type: "public-key",
              authenticatorAttachment: "platform",
              response,
              getClientExtensionResults: () => ({}),
            },
            window.PublicKeyCredential,
          );
          return credential as PublicKeyCredential;
        }
      } catch (error) {
        if ((error as DOMException).name === "AbortError" || (error as DOMException).name === "InvalidStateError")
          throw error;
      }
      return original.create(options);
    },
  };
  Object.defineProperty(navigator, "credentials", {configurable: true, value: wrapped});
}
