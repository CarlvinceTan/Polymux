---
name: window-control
description: Mandatory prerequisite for any action that may initialize, launch, open, reveal, focus, inspect, or control a local GUI app, directly or through another skill, plugin, script, or tool. Use it to protect or immediately restore the user's current focus, select preverified background routes, bind work to an exact window or tab, pair exact-window capture with accessibility control, prevent controller overlap, allow passive observation, and prepare user intervention without foregrounding the target. It does not apply to local file inspection, headless rendering, or screenshots produced without a GUI app.
author: FlareAI
category: System
---

# GUI Control

Own only the shared launch, focus-safety, window-identity, and control-ownership
contract for local GUI apps. App-specific skills decide which app, account,
workflow, or remote device to use.

Keep first answers brief and outcome-first. Omit internal preflight and recovery
detail unless the user asks for it.

Two boundaries are non-negotiable:

- For an OTP, CAPTCHA, biometric/passkey challenge, secret entry, unmatched
  account, or another genuinely user-only choice, prepare the exact target in
  the background and require the user to switch to it. A screen labelled
  sign-in, permission, or install is not automatically user-only: proceed when
  the request already authorizes the exact account, scope, and consequence and
  the action needs no new secret, biometric, legal/privacy consent, or
  ambiguous choice. This classification decides only whether attention is
  needed; it never replaces an owning skill's recipient, payload, submission,
  payment, deletion, or other consequential approval boundary. Even an explicit
  request to “bring it forward” never authorizes the agent to do so.
- Recovery applies only to a compiled launch with containment already armed.
  Continue only after it restores and verifies the exact prior app and verifies
  the target nonfrontmost. Failed recovery or any later controller takeover
  stops.

When explaining either boundary, never abbreviate it as merely “safe
preparation” or “monitored recovery.” State that containment is armed before
launch, the exact prior app is restored and verified, the target is verified
nonfrontmost, and any failed recovery or later takeover stops. For an external
browser, identify and lease only agent-operated tabs; never inspect, lease,
group, select, or otherwise operate the user's working tab. A user interaction
pauses only that exact handed-off tab; independent leased tabs may continue.
External browsers never use the launch-recovery exception: require a verified
non-activating route or stop and prepare a user handoff. Start with one concise
objective group and create another only for a genuinely distinct parallel
objective. On completion, close only agent-created tabs, restore every operated
pre-existing tab to its prior group or ungrouped state, remove the temporary
objective group, and release its leases. Apply the same cleanup after an
existing-tab continuation or a temporary CAPTCHA or passkey fallback.

## Routing and session gate

- Every local GUI route, including an app-specific fallback selected by another
  skill, stays hidden or background/nonfrontmost unless the user explicitly
  requests foreground interaction or a prepared user-only handoff.
- Nonfrontmost is a rule about what the agent may raise, never a precondition
  the user must satisfy. A window the user is already in and has pointed the
  agent at is a valid target exactly as it sits: work in it in place, at its
  current position in the window order. Asking the user to switch away, hide
  the window, or "let it go to the background" before work can start is wrong
  and is never the answer to such a request.
- Load this skill before any call that may initialize, launch, reveal, inspect,
  or control a local GUI, including state calls or integrations that may launch
  an app transparently.
- For an external local browser, preserve this exact preflight order in both
  action and explanation: (1) explicitly load `window-control`; (2) verify the
  current default-browser boundary without launching it; (3) validate the
  trusted non-activating route; (4) identify the exact window or tab; (5) check
  ownership and acquire its lease. External-browser preflight does not use the
  foreground-launch recovery exception. Never replace the first step with a later
  generic “session gate.” Any grouping must itself use a verified
  background-safe route; otherwise skip grouping and leave the exact tab in
  place. Pause automation before the user begins any CAPTCHA, passkey, OTP, or
  other attention-only interaction, not after interaction has started.
- Explicitly apply all five external-browser preflight steps before every
  external-browser scenario, including same-window multi-tab work; do not rely
  on having described the sequence for a different example.
- Exact external-tab identification searches every window using stable window
  and tab IDs, URL, title, and relevant profile or account context without
  selecting neighboring tabs. Sign-in is observed state, not an eligibility
  requirement: an exact signed-out match remains usable for a prepared login
  handoff. Ask when multiple matches remain ambiguous.
- Route an ordinary public website directly to the FlareAI in-app Browser. For an
  external attention handoff, run the preflight against the verified current
  default browser itself; never reuse a Chrome-specific preflight for another
  browser.
- Prefer a direct API, connector, CLI, or headless interface that is documented
  not to start a GUI process. Such routes do not require GUI preflight, but this
  generic preference never overrides an owning skill's required surface order.
- Use the compiled route registry to decide in advance which exact host,
  app/version, launcher, controller, and recovery tuples are trusted. At runtime
  perform only the changing checks: current app identity, exact window or tab,
  user activity, lease ownership, focus, and whether the route has since been
  quarantined by an incident. Check any route identifier with
  `scripts/app-control-registry.py check-route` before use.
- An explicit request to use an exact unregistered or stale app authorizes a
  just-in-time compatibility check for only the capability required by that
  task. Do not run a full launch, window-state, capture, inspection, and action
  matrix when the task needs only one of them. Keep containment and exact-window
  leases active, record the exact observed capability for later route selection,
  and never generalize it to an untested capability. Read
  [references/dialog-and-unregistered-apps.md](references/dialog-and-unregistered-apps.md)
  before proceeding.
- Run that lightweight session gate before starting or resuming GUI control,
  before controller initialization, and whenever live evidence becomes stale.
- The monitored preflight is still required at the start of every distinct GUI
  case, including a compiled recovery launch and a user-attention handoff. Say
  so explicitly when asked. This does not require repeating the full process
  preflight before every unchanged read or action in one continuous session.
- During one continuous session, do not rerun the process preflight before every
  unchanged read or action. Keep validating the exact window lease instead.
  Rerun preflight after an app launch or restart, window or profile change,
  controller reconnect, lease expiry, unexpected focus change, user interaction
  with the target, or any other event that invalidates the prior evidence.
- Never let an app controller be the first operation that cold-launches an app.
  Use a compiled launcher and pre-arm focus containment. If launch restoration
  takes focus, continue only after containment restores the exact prior app and
  the target is verified nonfrontmost. Failed recovery stops. This exception
  never extends beyond launch: later control requires an exact verified
  non-activating route, and any later controller takeover stops.
  Whenever explaining this order, state the complete narrow exception:
  containment is armed before launch, it restores and verifies the exact prior
  app, the target is verified nonfrontmost, and failed recovery or any later
  takeover stops the path.
  If a scenario says a controller may foreground and restore an app, explain
  both boundaries: the controller still cannot cold-launch or take focus, while
  a separately compiled launcher may use only that complete pre-armed launch
  exception.
- Treat generic requests such as “open,” “show,” “display,” “leave it ready,” or
  “watch” as preparation or passive-observation requests. Never foreground the
  target automatically; the user may switch to a prepared window when ready.
- A request for a live-app screenshot does not authorize foregrounding. Capture
  it only through an independently verified non-activating route. Inspection of
  an existing local image, PDF rendering, or another headless capture does not
  trigger this skill merely because the result is visual.
- Outside an explicitly authorized compatibility audit, if neither a
  non-activating launcher nor a compiled monitored-recovery launcher is
  available, fail closed: keep the user's screen untouched, use a non-GUI
  route, or complete safe preparation and explain which window the user may
  open themselves. Recovery authorizes only launch preparation; later control
  still requires a non-activating exact-window route.
- Do not infer recovery eligibility from an app category, a similar app, or the
  mere possibility that focus could be restored. An exact prior observation may
  select the likely route for the same app identity and capability, but it never
  proves an untested capability or replaces current focus, lease, identity, and
  incident checks. A changed app or macOS build triggers only scoped
  revalidation of the requested capability unless relevant evidence fails.
- Do not mention, offer, or assume monitored recovery in a generic or
  hypothetical safety answer. It becomes available only after a live
  `lookup-launch` for the exact current app tuple returns
  `verified_monitored_recovery`. Without that current lookup evidence, require
  non-activating preparation or fail closed. A controller that may itself
  foreground and restore focus is always rejected.
- Never enter, exit, or restore full-screen state. Leave incidental restoration
  alone when backgrounded; if it takes focus, contain it under the launch rule.
- A request to watch allows passive observation under the exact-window rules;
  it does not authorize the agent to foreground routine progress. Prepare the
  exact window and let the user switch to it themselves.

## Exact window and exclusive control

An app name alone never identifies the target.

- Identify the exact current window without activation using the strongest
  available process, bundle, native-window, profile, document, URL, tab, title,
  content, and controller evidence. Never infer it from the frontmost window,
  recency, list order, position, or an old screenshot.
- If multiple windows still match, ask the user to distinguish them without
  changing either window.
- Acquire the window or exact tab atomically with `python3
  scripts/window-control-lease.py`, recording a caller-stable owner,
  controller, app/window identity, scope, and tab identity when relevant.
  Window-scoped control conflicts with every controller in that window.
  Tab-scoped controllers may coexist only on different exact tabs and only when
  neither route can change window-wide state or spill into the other tab.
- Keep the returned token private. Validate it before each material action and
  renew when needed. Release it on pause, transfer, or completion. Treat
  `blocked_held`, `blocked_owner_has_window`, `invalid`, and expiry as hard
  stops; never overwrite another controller's lease.
- Controllers may not operate the same leased window or tab concurrently.
  Settle work, release the conflicting lease, acquire the new lease, and
  re-identify the same target before transferring control.
- A lease authorizes only window control. It does not authorize sending,
  submitting, paying, deleting, or any other app-specific side effect.

## User activity and observation

- A target being frontmost when the user requests GUI control is not a blocker.
  The explicit request authorizes control to begin in
  that exact identified and leased window; do not require the user to switch
  away first and do not confuse visibility with concurrent use.
  This is the common case, not an edge case: a request like "do X in this
  window" or "fix this in <app>" while that app is frontmost hands the agent
  the window it names. Preflight it with `--allow-frontmost-requested` and
  proceed. What the request must never do is make the agent raise a *different*
  window over the one the user is in — that, not the user's own focus, is what
  the focus-safety rules protect.
- The user may switch to an already leased window solely to watch; that focus
  change does not release the lease or pause exactly targeted automation.
  Pause mutating control only when the user clicks or selects content, types,
  scrolls, navigates, or otherwise operates inside the target. Merely switching
  to or away from the window and moving the pointer without acting is passive
  observation.
- If the user switches to another window after control begins, continue only
  through the same exact-window, non-activating route while its lease and
  identity remain valid. Never activate, raise, reopen, or refocus the target
  above the window the user is now using. If continued control requires that,
  pause instead.
- Do not hide, minimize, close, switch, type into, click, reorganize, or
  otherwise control the different window the user has moved to.
- With explicit authorization, the user may work in a different verified window
  of the same app while the agent controls its leased window. Continue only when
  the controller is window-scoped and cannot spill into the user's window.
- Never infer the automation target from whichever window is frontmost. The
  agent must not foreground a window merely because observation is allowed.
- For a tab handoff, pause control only on the exact tab the user operates;
  independent leased tabs may continue. Keep an unrelated user tab outside
  agent discovery, grouping, and leasing. Identify it only when that exact tab
  is itself the requested target.

## Background interaction

- Prefer backend operations first. When visual inspection is needed, use exact
  native-window capture paired with direct accessibility inspection and actions
  that do not synthesize input. This is the default visual controller.
- Whenever proposing accessibility control, explicitly require a verified
  direct, exact-window, non-activating action route. A semantic label by itself
  is not evidence that the action avoids synthesized or app-wide input.
- Select the capture by exact PID and native window ID. Map only that native
  window to its accessibility window using matching current identity and frame
  evidence. If the mapping is absent or ambiguous, stop rather than falling
  back to app-wide or frontmost-window control.
- Treat coverage separately: `full` requires the needed capture, semantic
  controls, successful action, and verified state change; `visual-read-only`
  means pixels are available but accessibility lacks the required controls;
  `unsupported` means either exact capture or safe control is unavailable.
- Never use coordinate clicks, pointer movement, global keyboard input, generic
  scrolling, focus commands, Dock clicks or reopen events, or app-wide selection
  against a background window.
- Computer Use is disabled. Do not invoke it through a dedicated integration,
  the bundled Node runtime, or an owning skill, and never use it for hidden,
  background, off-screen, or separately hosted OS dialogs. If the user later
  explicitly enables it for a foreground observation session, revalidate focus
  before every synthesized action, stop immediately when the user switches
  away, and never bring the window back.
- App-targeted keyboard or accessibility actions are allowed only when that
  exact path has already been verified to preserve the user's foreground app
  and pointer. A claim that input is app-targeted is not evidence.
- If an action fails because the target is not active, stop; do not retry by
  activating it. Restoring focus afterward is recovery, not success.
- Create windows, documents, or tabs only through the active route's verified
  scope. A frontmost target explicitly handed to the agent is eligible; a
  background target requires a non-activating window-scoped route.

## Compiled routes and macOS session gate

For explicitly user-authorized testing of an exact missing or stale tuple, read
[references/compatibility-audits.md](references/compatibility-audits.md). Audit
mode never changes the pre-armed containment, exact-prior-app restoration,
nonfrontmost verification, lease, no-global-input, or fail-closed boundaries,
and its evidence never approves a route automatically.

Use `scripts/runtime-route-observations.py` to remember exact successful or
failed task capabilities outside the deployed skill. This observation cache is
route-selection evidence, not a compiled trust registry: reuse it to avoid
unrelated retesting, then perform the changing session checks and verify the
requested material result.

The machine-readable registry at
`references/app-control-registry.json` contains exact pretested route tuples.
Use `scripts/app-control-registry.py lookup-launch` to verify the current macOS
build and app bundle identity without launching the app. A matching compiled
route avoids repeated launch experiments; it never replaces live window,
focus, user-activity, or lease checks.

Before using exact-window capture or an accessibility action, check the exact
app/version/capability tuple with `scripts/app-control-registry.py
lookup-control`. A verified capture capability does not imply action coverage;
request the material capability actually needed.

Use `scripts/exact-window-control.sh` for discovery, capture, inspection,
presses, and value changes. It validates the compiled capability and exact
window lease before every material call. Read
[references/exact-window-controller.md](references/exact-window-controller.md)
for its concise command contract.

Before starting or resuming a macOS GUI-control session, inspect the target
without launching it:

```bash
zsh scripts/prepare-background-app.sh \
  --app "TARGET DISPLAY NAME" \
  --process "EXACT EXECUTABLE NAME" \
  --bundle-id "EXACT BUNDLE ID" \
  --check-only
```

- `ready_existing_background`: the app is running and nonfrontmost. Proceed only
  through a proven non-activating interface after acquiring the exact window.
- `ready_existing_frontmost_requested`: the target was already frontmost and
  the user's current request explicitly handed that visible target to the
  agent. Pass `--allow-frontmost-requested` whenever the request identifies the
  window the user is in — "do this here", "in this window", or naming the app
  they are looking at. Withhold the flag only when the frontmost app is
  incidental: the request never identified it, or it names a different target.
- `blocked_user_active` on a frontmost target means only that
  `--allow-frontmost-requested` was not supplied. When the request did hand the
  agent that window, re-run the preflight with the flag rather than reporting a
  blocker. Never answer such a request by asking the user to switch away.
- `needs_hidden_launch`: do not use generic `open`, controller initialization,
  or an untested launcher. Consult
  [references/tested-background-launchers.md](references/tested-background-launchers.md).
- `ready_compiled_hidden_launch`: `--check-only --compiled-launch` verified a
  current trusted cold-launch tuple without launching it. A later actual launch
  must still pass the monitored helper and return `ready_hidden_launch`.
- `ready_compiled_recoverable_launch`: the exact launcher is known to take or
  expose focus, but the compiled route may be attempted with the recovery
  watcher already active. Continue only when the launch returns
  `ready_background_recovered_launch` and the target is confirmed nonfrontmost.
- For an exact current `verified_safe` tuple, use `--compiled-launch` and require
  either `ready_hidden_launch` or `ready_background_recovered_launch`. The helper
  pre-arms containment and verifies the entire recorded route before launching.
  The recovered result is usable only when the prior app was restored and the
  target is currently nonfrontmost.
- After every successful cold launch, explicitly verify the target is currently
  nonfrontmost before any controller initialization, discovery, get-state, or
  inspection call. A trusted route, successful lease, or exact window identity
  never substitutes for this post-launch focus check.
- Any missing or changed identity field makes the evidence stale. Unknown and
  failed-launch routes remain blocked. A recorded foregrounding route is usable
  only through its compiled monitored-recovery path.
- Use `--launch-even-if-running` and `--verify-command-contains VALUE` only for
  a recorded profile-specific or separate-instance route that requires them.
- Treat every `blocked_*` result as a hard stop. `--check-only` diagnoses state;
  it does not prepare a stopped app for control.
- Do not treat `open -g -j`, `open -n`, a final focus check, or ad hoc focus
  restoration as general proof. Never bypass the shared helper for either a
  non-activating or monitored-recovery launcher.

The two supported prepared states are `hidden` and `background/nonfrontmost`.
Use only the state certified for the exact app, controller, and operation in the
compiled registry; do not infer that either state is universally better.
Minimized windows are not a supported prepared state because no current
compiled route certifies minimized control.

The session gate protects the launch boundary. Every later background action
must still use a non-activating, exactly window-targeted interface.

## Dialogs and temporary apps

- Treat every unexpected app sheet, update notice, onboarding screen, save
  prompt, or OS-hosted panel as a new exact GUI case. Read
  [references/dialog-and-unregistered-apps.md](references/dialog-and-unregistered-apps.md),
  re-identify its owning process and window, and acquire its own lease before
  inspecting or acting.
- Before controlling an Open or Save panel, try to bypass it through the owning
  app. First read
  [references/dialog-bypass-routes.md](references/dialog-bypass-routes.md) and
  query the exact recorded capability. Use its verified route directly; do not
  cycle through CLI, Apple Events, accessibility, and GUI guesses. For a missing
  entry, inspect bundle files and metadata directly, then documented or
  owning-skill interfaces, choose the narrowest candidate, test only it, and
  record the result. Never treat `sdef` as static inspection: it may initialize
  the app and is eligible only as the single chosen launch-risk probe after the
  full session gate and pre-armed containment. If the app is under the user's
  control, prefer adding a direct integration around its `NSOpenPanel` or
  `NSSavePanel` completion result. Never dismiss an existing panel merely
  because a bypass exists; verify the owning workflow advanced or cancel it
  through an exact semantic action.
- Never guess a dialog's default action or use Return, Escape, coordinates, or
  app-wide input. Preserve existing user work by default. When an exact safe
  control is unavailable, prepare the dialog for a user handoff and stop.
- Keep temporary development apps out of the persistent registry. They may use
  the same just-in-time capability checks and exact-build observation cache when
  explicitly needed; only a stable production app/version is eligible for
  compiled enrollment.

## Exact-window controller and local viewers

- Use ScreenCaptureKit or Core Graphics only to capture the leased native
  window, including when hidden or off-screen. Use accessibility only within
  the corresponding exact accessibility window. Never infer action coordinates
  from the image or inject global input.
- Use the bundled exact-window controller rather than creating one-off Swift,
  AppleScript, or accessibility harnesses. Its discovery is read-only; every
  later call is lease-enforced and fails closed on ambiguous window or control
  matches.
- The compiled registry currently verifies full tested coverage for Calculator,
  Chess, Dictionary, Weather, and VLC on the recorded host/app versions. Read
  [references/tested-background-launchers.md](references/tested-background-launchers.md)
  for the exact capabilities and limitations.
- For any other installed app, read
  [references/app-compatibility.md](references/app-compatibility.md) before
  classifying it as supported, visual-only, untested, or unsafe. A recorded
  read-only route never implies mutation coverage.
- For a visual-read-only custom canvas, video surface, remote viewer, or
  inaccessible web view, ask the owning skill for a direct protocol or
  app-specific controller before declaring the requested action unsupported.

For iPhone Mirroring or another local viewer, first run:

```bash
xcrun swift scripts/check-background-layout.swift \
  --target-process "iPhone Mirroring" \
  --target-bundle-id "com.apple.ScreenContinuity" \
  --target-window-id "EXACT CG WINDOW ID"
```

- Proceed for `ready_background_layout`, or for
  `ready_frontmost_observation_layout` when the user explicitly switched to the
  exact viewer only to watch and `--allow-frontmost-requested` was supplied.
- A separate screen-filling user window is not a blocker. Pause only when the
  target viewer itself is unavailable, ambiguously expanded, or mostly
  off-screen in a way that prevents exact capture or control. Do not raise,
  resize, move, or activate it yourself.
- Treat every `blocked_*` layout result as a hard stop. User-chosen passive
  observation is allowed; agent-caused foregrounding is an incident and must
  follow the recovery and quarantine rules below.

## Background user intervention

- When visible control is still required, complete all safe preparation first
  without foregrounding it. State the exact app, window or tab, prepared state,
  and the one action the user needs to perform.
- An attention handoff always means a prepared user switch, never an
  agent-caused foreground operation. This remains true when the user nominates
  an existing signed-in browser tab or asks to open, show, view, watch, or bring
  forward the work. Stop all control as soon as the user begins interacting.
- For a local-app attention handoff, suspend all local GUI mutation while the
  user acts, not merely actions on that window. The narrower exact-tab exception
  applies only to independent browser tabs whose separate leases and routes are
  already proven unable to affect the handed-off tab.
- Keep the task active when the host supports waiting. Suspend mutating GUI
  control, retain or safely renew the exact lease, and monitor only a proven
  non-invasive completion signal. Resume automatically as soon as completion
  is verified and the user is no longer operating the target.
- Do not busy-poll or manipulate the window while the user acts. Use a bounded
  wait or product monitoring mechanism. If no reliable completion signal exists
  or the task cannot remain active indefinitely, say so and ask the user to
  reply when done rather than pretending automatic continuation is reliable.
- Never foreground a CAPTCHA, OTP, biometric/passkey challenge, secret entry,
  unmatched account, new legal/privacy consent, payment, submission, or other
  genuinely user-only step. Prepare it in the background and let the user
  switch to it themselves. Do not hand off an exact one-click account or scope
  choice that the current request has already authorized merely because it is
  part of sign-in, permission, or installation.
- A generic need for visible interaction is not an attention handoff. Do not
  foreground for routine progress; use the prepared user-switch workflow only
  for a genuine user-only step.

## Verification and failure

- For fragile launch or control paths, use activation history or continuous
  observation; a final frontmost-app check can miss a brief takeover.
- Treat any user-observed takeover as authoritative evidence that the path
  foregrounded. Every cold launch pre-arms focus containment. A strict route
  may continue after a launch-only takeover only when the exact prior app is
  restored and the target is verified nonfrontmost.
- The recovery exception applies only to the launch boundary. If initialization
  or routine control later foregrounds the target, or if launch recovery does
  not complete within its bound, stop using that route, record and quarantine
  the exact route, and report the failure. Never generalize recovery into
  permission to activate, raise, reopen, or refocus the target during control.
- This exception changes no controller lease, exact-recipient or payload
  approval, no-global-input, user-activity, attention-handoff, or owning-skill
  fail-closed boundary.

On other platforms, use a true non-activating GUI launch primitive and verify
window behavior, not merely process creation. If that cannot be guaranteed,
fail closed and prepare a clearly identified user-intervention location without
foregrounding it.
