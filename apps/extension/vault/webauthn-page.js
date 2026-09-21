/**
 * Page-world WebAuthn hook. Runs in MAIN world (or as a web-accessible script)
 * so it can wrap navigator.credentials. Secrets never enter this file.
 */
(() => {
  "use strict";
  if (navigator.credentials?.__polymuxPasskeys) return;
  const original = navigator.credentials;
  if (!original?.get || !original?.create) return;

  const SOURCE = "polymux-webauthn";
  let nextId = 1;
  const pending = new Map();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.dir !== "reply") return;
    const wait = pending.get(data.id);
    if (!wait) return;
    pending.delete(data.id);
    wait(data);
  });

  function ask(action, options, signal) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const finish = (reply) => {
        signal?.removeEventListener?.("abort", onAbort);
        resolve(reply);
      };
      const onAbort = () => {
        pending.delete(id);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener?.("abort", onAbort, {once: true});
      pending.set(id, finish);
      window.postMessage(
        {source: SOURCE, dir: "request", id, action, origin: location.origin, options},
        "*",
      );
    });
  }

  function bufferToB64(value) {
    if (value == null) return "";
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function b64ToBuffer(value) {
    if (!value) return new ArrayBuffer(0);
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  function serializeGet(publicKey) {
    return {
      rpId: publicKey.rpId || location.hostname,
      challenge: bufferToB64(publicKey.challenge),
      allowCredentialIds: (publicKey.allowCredentials || []).map((item) => bufferToB64(item.id)),
      userVerification: publicKey.userVerification || "",
    };
  }

  function serializeCreate(publicKey) {
    const user = publicKey.user || {};
    const rp = publicKey.rp || {};
    return {
      rpId: rp.id || location.hostname,
      rpName: rp.name || "",
      challenge: bufferToB64(publicKey.challenge),
      userName: user.name || "",
      userDisplayName: user.displayName || "",
      userId: bufferToB64(user.id),
      excludeCredentialIds: (publicKey.excludeCredentials || []).map((item) => bufferToB64(item.id)),
    };
  }

  function attachGetClientExtensionResults(credential) {
    credential.getClientExtensionResults = () => ({});
    return credential;
  }

  function assertionFrom(payload) {
    const response = {
      clientDataJSON: b64ToBuffer(payload.clientDataJSON),
      authenticatorData: b64ToBuffer(payload.authenticatorData),
      signature: b64ToBuffer(payload.signature),
      userHandle: payload.userHandle ? b64ToBuffer(payload.userHandle) : null,
    };
    Object.setPrototypeOf(response, window.AuthenticatorAssertionResponse?.prototype ?? Object.prototype);
    const credential = {
      id: payload.id,
      rawId: b64ToBuffer(payload.rawId),
      type: "public-key",
      authenticatorAttachment: payload.authenticatorAttachment || "platform",
      response,
    };
    Object.setPrototypeOf(credential, window.PublicKeyCredential?.prototype ?? Object.prototype);
    return attachGetClientExtensionResults(credential);
  }

  function attestationFrom(payload) {
    const response = {
      clientDataJSON: b64ToBuffer(payload.clientDataJSON),
      attestationObject: b64ToBuffer(payload.attestationObject),
      getAuthenticatorData() {
        return this.authenticatorData;
      },
      getPublicKey() {
        return null;
      },
      getPublicKeyAlgorithm() {
        return -7;
      },
      getTransports() {
        return payload.transports || ["internal"];
      },
    };
    Object.setPrototypeOf(response, window.AuthenticatorAttestationResponse?.prototype ?? Object.prototype);
    const credential = {
      id: payload.id,
      rawId: b64ToBuffer(payload.rawId),
      type: "public-key",
      authenticatorAttachment: payload.authenticatorAttachment || "platform",
      response,
    };
    Object.setPrototypeOf(credential, window.PublicKeyCredential?.prototype ?? Object.prototype);
    return attachGetClientExtensionResults(credential);
  }

  const wrapped = {
    ...original,
    __polymuxPasskeys: true,
    async get(options = {}) {
      if (!options.publicKey) return original.get(options);
      try {
        const reply = await ask("get", serializeGet(options.publicKey), options.signal);
        if (reply?.result === "credential") return assertionFrom(reply.credential);
      } catch (error) {
        if (error?.name === "AbortError") throw error;
      }
      return original.get(options);
    },
    async create(options = {}) {
      if (!options.publicKey) return original.create(options);
      try {
        const reply = await ask("create", serializeCreate(options.publicKey), options.signal);
        if (reply?.result === "credential") return attestationFrom(reply.credential);
        if (reply?.result === "invalid-state")
          throw new DOMException("A passkey for this site is already saved.", "InvalidStateError");
      } catch (error) {
        if (error?.name === "AbortError" || error?.name === "InvalidStateError") throw error;
      }
      return original.create(options);
    },
  };
  Object.defineProperty(navigator, "credentials", {configurable: true, value: wrapped});
})();
