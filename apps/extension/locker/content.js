// Locker form detection and fill. Same heuristics as the in-app Browser view.
(() => {
  "use strict";

  const OTP_NAME = /otp|totp|2fa|two.?factor|one.?time|verification.?code|auth.?code|mfa|authenticator/i;

  function visible(element) {
    if (element.hasAttribute("hidden")) return false;
    const input = element;
    if (input.disabled || input.readOnly || input.type === "hidden") return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return element.getClientRects().length > 0;
  }

  function usernameFor(password, root) {
    const candidates = [...root.querySelectorAll("input")].filter(
      (input) =>
        ["text", "email", "tel", ""].includes(input.type) &&
        visible(input) &&
        password.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING,
    );
    return candidates.at(-1) ?? null;
  }

  function loginForms() {
    const found = [];
    for (const password of document.querySelectorAll("input[type=password]")) {
      if (!visible(password)) continue;
      const scope = password.form ?? document;
      const passwordCount = [...scope.querySelectorAll("input[type=password]")].filter(visible).length;
      if (passwordCount !== 1) continue;
      found.push({username: usernameFor(password, scope), password});
    }
    return found;
  }

  function otpFields() {
    return [...document.querySelectorAll("input")].filter((input) => {
      if (!visible(input) || input.type === "password") return false;
      if (input.autocomplete === "one-time-code") return true;
      const label = `${input.name} ${input.id} ${input.placeholder}`;
      if (!OTP_NAME.test(label)) return false;
      const max = Number(input.maxLength);
      return !Number.isFinite(max) || max <= 0 || (max >= 4 && max <= 10);
    });
  }

  function fieldFocus() {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement) || !visible(active)) return null;
    if (otpFields().includes(active)) return "otp";
    if (loginForms().some((form) => form.password === active || form.username === active))
      return "login";
    return null;
  }

  function fillField(field, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter ? setter.call(field, value) : (field.value = value);
    field.dispatchEvent(new Event("input", {bubbles: true}));
    field.dispatchEvent(new Event("change", {bubbles: true}));
  }

  function fill(values) {
    const form = loginForms()[0];
    if (form?.username && values.username) fillField(form.username, values.username);
    if (form && values.password) fillField(form.password, values.password);
    const otp = otpFields()[0];
    if (otp && values.totp) fillField(otp, values.totp);
    return Boolean(form || otp);
  }

  let reported = "";
  function report() {
    const forms = loginForms();
    const otp = otpFields().length;
    const focus = fieldFocus();
    const signature = `${forms.length}:${otp}:${focus ?? ""}`;
    if (signature === reported) return;
    reported = signature;
    chrome.runtime.sendMessage({
      type: "polymux:locker-page",
      origin: location.origin,
      url: location.href,
      forms: forms.length,
      otp,
      focus,
    });
  }

  function watchSubmissions() {
    const capture = () => {
      const form = loginForms()[0];
      if (!form?.password.value) return;
      chrome.runtime.sendMessage({
        type: "polymux:locker-submitted",
        origin: location.origin,
        url: location.href,
        title: document.title,
        username: form.username?.value ?? "",
        password: form.password.value,
      });
    };
    document.addEventListener("submit", capture, true);
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest("button, input[type=submit], [role=button]")) setTimeout(capture, 0);
      },
      true,
    );
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "polymux:locker-fill") {
      sendResponse({ok: fill(message)});
      return false;
    }
    if (message?.type === "polymux:locker-page-query") {
      const forms = loginForms();
      sendResponse({
        origin: location.origin,
        url: location.href,
        title: document.title,
        forms: forms.length,
        otp: otpFields().length,
        username: forms[0]?.username?.value ?? "",
      });
      return false;
    }
    return false;
  });

  watchSubmissions();
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", report, {once: true});
  else report();
  document.addEventListener("focusin", report, true);
  document.addEventListener("focusout", () => setTimeout(report, 0), true);
  new MutationObserver(report).observe(document.documentElement, {childList: true, subtree: true});
})();
