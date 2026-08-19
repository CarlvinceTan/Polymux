# Dialogs, unregistered apps, and temporary builds

Read this reference when an app presents a sheet or panel, or when the exact
app tuple is missing or stale in the compiled registry.

## Dialog handling

Before operating a panel, read [dialog-bypass-routes.md](dialog-bypass-routes.md)
and query the exact capability observation. A verified route bypasses the
separate panel service; use it directly rather than trying several methods. For
a missing route, read its bundled `.sdef`, `.scriptSuite`,
`.scriptTerminology`, and `Info.plist` resources directly, followed by documented
CLI and owning-skill APIs. Choose one narrow candidate in that order, test only
it, and record the result. Never call the `sdef` command during this static
phase because it may initialize the target; if it is the sole remaining likely
probe, run it only under the normal launch-risk session gate and pre-armed
containment. When the app is under the user's control, integrate its own
`NSOpenPanel` or `NSSavePanel` completion result. Verify that the owning workflow
advanced and leave no stale panel.

1. Rerun the session gate. Identify the dialog's exact native window, owning
   process, host app relationship, current title and bounds without activating
   it. macOS may host a panel in a separate XPC service; an app name alone is
   not ownership evidence.
2. Acquire a separate exact-window lease. Inspect controls through an exact
   accessibility mapping and require one unique semantic match. Never press a
   default button, Return, Escape, or a coordinate.
3. Automatically choose only an unambiguous preservation-first or harmless
   deferral action such as `Cancel`, `Not Now`, `Later`, `Skip`, or `Close`, and
   verify the dialog disappeared or advanced as intended. Do not interpret a
   generic `Continue` as harmless when it may accept terms, enable telemetry,
   grant access, install an update, create an account, or change configuration.
4. For a save/discard prompt, choose `Cancel` when the state may belong to the
   user. `Don't Save` or `Discard` is allowed only when the changed state was
   created solely by the agent in the current task and cleanup of that state is
   within the user's request. Saving to a new path still requires exact payload
   and destination authority from the owning workflow.
5. Decide intervention from authority, exactness, and consequence rather than
   the dialog category. Automatically select an exact semantic choice when the
   current request already settles the account, scope, destination, and effect,
   and the choice introduces no new secret, biometric, legal/privacy consent,
   destructive scope, or ambiguity. For example, select a named or uniquely
   matching already-signed-in Google account and continue; do not stop merely
   because the page says sign in. Likewise, confirm an exact permission or
   installation already necessary and authorized by the request, but never
   broaden its scope. This decides only whether the user must perform the GUI
   step; it does not replace any owning workflow's approval requirement.
6. Prepare a user-attention handoff for a password or other secret that cannot
   be supplied by an already-authorized system mechanism, a biometric/passkey,
   CAPTCHA, OTP, unmatched or ambiguous account, new terms/privacy/telemetry
   choice, payment, destructive user-data choice, or permission/installation
   not already authorized with exact scope. A stored session or an exact
   one-click system autofill does not itself require a handoff; never inspect,
   copy, reveal, or retain the secret behind it. Keep the task active only when
   a proven non-invasive completion signal exists.
7. If the panel has no exact background accessibility surface, say so plainly
   and use the handoff. Do not expose it merely to make accessibility work and
   do not substitute synthesized or global input. Exact captured pixels without
   an exact semantic action route remain visual-read-only.

### Observed Chess limitation

Chess `3.18` can present a native `Save` panel after a quit request during an
unfinished game. On macOS build `25F84`, the hidden panel was hosted through
`com.apple.appkit.xpc.openAndSavePanelService`; exact native windows were
visible to Core Graphics, but neither Chess nor the service exposed a mappable
background accessibility surface. The safe route is therefore a prepared user
handoff. This does not reduce Chess's separately verified board-action
coverage.

## Missing or stale app tuple

- A user's explicit request to use the exact app authorizes a just-in-time check
  of the capability needed by that task; it does not approve the app category
  or an untested capability.
- Verify the bundle path, identifier, executable, version, build, and process
  state. Use only the compatibility-audit launch and exact-window modes from
  [compatibility-audits.md](compatibility-audits.md).
- Pre-arm containment before launch. Continue only after the exact prior app is
  restored and verified, the target is nonfrontmost, and every later action is
  exact-window scoped and non-activating. A later takeover still stops.
- Record the exact attempted capability with
  `scripts/runtime-route-observations.mjs`. A later exact match may reuse the
  successful route after current checks; it never becomes broader compiled
  coverage by itself.
- Record fullscreen restoration, foregrounding, dialog appearance, missing
  accessibility, or other surprises only when they affect the requested route.
  Do not test unrelated states. Enroll a stable app only through a deliberate
  staged registry update, complete maintenance gate, and promotion.

## Temporary development apps

Treat project-local, ad hoc, unsigned, frequently rebuilt, or explicitly
temporary development apps as ephemeral:

- do not enroll them in this installation's registry or the persistent compatibility
  inventory;
- prefer the owning project's backend or test interface;
- when GUI use is explicitly needed, audit the exact current build for that
  task and retain only its exact-build capability observation, never general
  trust;
- if the app becomes a stable production artifact, it may enter the normal
  versioned enrollment workflow.
