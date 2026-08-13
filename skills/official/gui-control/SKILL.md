---
name: gui-control
description: Protect the user's focus and bind automation to an exact local GUI window or browser tab. Use before any tool, MCP, script, or skill may launch, reveal, inspect, focus, or control a desktop application. It does not apply to local file inspection, headless rendering, or images produced without opening a GUI app.
allowed-tools: read bash
---

# GUI Control

Own the shared focus-safety, window-identity, and control-ownership rules for
local GUI applications. The app-specific skill still decides what workflow and
side effects are authorized.

## Route selection

1. Prefer a direct API, connector, CLI, or headless route that is documented
   not to launch a GUI.
2. Before using GUI control, inspect the configured MCP's capabilities without
   launching the target when possible. Do not claim a background-safe route
   unless the tool can identify and control an exact window or tab without
   activating it.
3. Keep targets hidden or non-frontmost unless the user explicitly asks to
   interact with the visible target.
4. Never let a controller's initialization be the first operation that
   cold-launches an app. If safe background launch and verification are not
   available, stop and prepare a user handoff.

## Exact identity and ownership

- An app name is not enough. Identify the exact process, window, document,
  profile, URL, or tab using stable identifiers and current evidence.
- Never infer the target from the frontmost window, list position, recency, or
  an old screenshot. Ask when multiple candidates remain.
- Acquire an exact-window or exact-tab lease when the controller supports it.
  Never let two controllers operate the same target concurrently.
- Re-identify after navigation, app restart, controller reconnect, unexpected
  focus change, user interaction, or stale evidence.
- A window lease authorizes control only. It does not authorize sending,
  submitting, paying, deleting, publishing, or changing an account.

## Background control

- Use exact-window capture paired with semantic, exact-window actions.
- Do not use coordinate clicks, pointer movement, global keyboard input,
  generic scrolling, Dock clicks, or app-wide selection against a background
  window.
- If an action requires activation, stop rather than activating and attempting
  to restore focus afterward.
- Never enter, leave, or restore full-screen state, or move, resize, hide,
  minimize, or close an unrelated window.
- If the user begins interacting with the exact target, pause its automation.
  Work in other independently leased browser tabs may continue only when the
  controller cannot spill into the user's tab.

## Launch and handoff boundary

A launch path may continue after taking focus only when containment was armed
before launch, the exact prior app was restored and verified, and the target
was verified non-frontmost. Failed recovery or any later controller takeover
ends that route. Do not apply this exception to an external browser.

For CAPTCHA, OTP, passkey, biometric, secret entry, payment confirmation,
ambiguous account choice, or new legal or privacy consent:

1. Prepare the exact window or tab without foregrounding it.
2. Tell the user where it is and the single action required.
3. Stop control while the user interacts.
4. Resume only after re-identifying the target and verifying the user is no
   longer operating it.

## Failure behavior

Fail closed when exact identity, non-activating control, lease ownership, or
focus preservation cannot be established. Use a non-GUI route or ask the user
to switch to the prepared target. Report the verified limitation without
claiming that a GUI action completed.

