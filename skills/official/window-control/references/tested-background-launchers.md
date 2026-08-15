# Tested background launchers

This is the human-readable evidence ledger. The compiled route source consumed
by the runtime helper is `app-control-registry.json`; keep the two synchronized
whenever a route is added, changed, quarantined, or retested.

This is bounded evidence, not a permanent application allow-list.
Trust only an exact row matching the current host state. Unknown or stale
entries remain blocked for autonomous cold launch.

## Testing a missing or stale tuple

An explicitly requested exact app may use a just-in-time compatibility check as
the only exception to the ordinary compiled-route requirement. Invoke
`prepare-background-app.sh` with `--compatibility-audit`,
`--user-authorized-compatibility-audit`, and the exact `.app` path. The helper
validates the bundle, uses only `/usr/bin/open -g -j -a APP_PATH`, and pre-arms
continuous focus, window-exposure, and recovery monitors. The target must be
stopped when the task actually requires a launch. Run only the one needed task
attempt and record that capability in the observation cache. At least three
complete trials are still required before proposing a new compiled route
through Skill Maintenance; do not perform those extra trials during ordinary
work.

## Evidence scope

- Host test dates: 2026-07-28, 2026-07-29, 2026-08-05, and 2026-08-07
- macOS: 26.5.2
- macOS build: `25F84`
- Focus observation: `NSWorkspace` activation events plus frontmost sampling
  approximately every 2 ms
- Window observation: Core Graphics window sampling approximately every 10 ms
- A trial passed only when the target never became frontmost, emitted no
  activation event, and exposed no onscreen layer-0 window.

## Required identity check

Before using a `verified_safe` row:

1. Confirm `sw_vers -buildVersion` is the recorded macOS build.
2. Read the target's `CFBundleIdentifier`, `CFBundleExecutable`,
   `CFBundleShortVersionString`, and `CFBundleVersion` from its `Info.plist`
   without launching it.
3. Require exact matches for path, bundle identifier, executable, version, and
   build.
4. Run the exact launcher only through `scripts/prepare-background-app.sh`
   with `--compiled-launch`; the helper resolves the command and arguments from
   `app-control-registry.json` and refuses stale or quarantined routes.
5. Proceed only when the gate returns `ready_hidden_launch`.

An example for a matching Calculator installation:

```bash
zsh scripts/prepare-background-app.sh \
  --app "Calculator" \
  --process "Calculator" \
  --bundle-id "com.apple.calculator" \
  --compiled-launch
```

## Verified safe cold-launch tuples

Every row below used the exact launcher
`/usr/bin/open -g -j -a APP_PATH`.

| App | Path | Bundle ID | Executable | Version | Build | Trials |
|---|---|---|---|---|---|---:|
| Calculator | `/System/Applications/Calculator.app` | `com.apple.calculator` | `Calculator` | `12.0` | `225` | 5/5 |
| Calendar | `/System/Applications/Calendar.app` | `com.apple.iCal` | `Calendar` | `16.0` | `3036.4.14` | 5/5 |
| Chess | `/System/Applications/Chess.app` | `com.apple.Chess` | `Chess` | `3.18` | `3.18` | 5/5 |
| Dictionary | `/System/Applications/Dictionary.app` | `com.apple.Dictionary` | `Dictionary` | `2.3.0` | `294` | 5/5 |
| Font Book | `/System/Applications/Font Book.app` | `com.apple.FontBook` | `Font Book` | `11.0` | `526.4.0.1` | 5/5 |
| Image Capture | `/System/Applications/Image Capture.app` | `com.apple.Image_Capture` | `Image Capture` | `8.0` | `1106` | 5/5 |
| Reminders | `/System/Applications/Reminders.app` | `com.apple.reminders` | `Reminders` | `7.0` | `3976` | 5/5 |
| Stickies | `/System/Applications/Stickies.app` | `com.apple.Stickies` | `Stickies` | `10.3` | `10.3` | 5/5 |
| Weather | `/System/Applications/Weather.app` | `com.apple.weather` | `Weather` | `6.0` | `1318` | 5/5 |
| VLC | `/Applications/VLC.app` | `org.videolan.vlc` | `VLC` | `3.0.23` | `3.0.23` | 3/3 |

The 2026-08-05 installed-app audits also certified these exact current tuples
at 3/3: Acrobat Distiller, Activity Monitor, Adobe Acrobat, Adobe Lightroom
Classic, Adobe Photoshop 2026, AirPort Utility, Android Studio, App
Store, Audio MIDI Setup, Automator, Blackmagic RAW Player, Bluetooth File
Exchange, Books, CP210xVCPDriver, Clock, ColorSync Utility, Console, Contacts,
Digital Color Meter, Disk Utility, FaceTime, FindMy, Freeform, Games,
GarageBand, Ghostty, Grapher, Home, Image Playground, Journal,
Karabiner-Elements, Karabiner-EventViewer, Keynote, Keynote Creator Studio,
Magnifier, Maps, News, Notes, Numbers, Pages, Phone, Photo Booth, Photos,
Podcasts, Preview, QuickTime Player, Safari, Screen Sharing, Script Editor,
Shortcuts, Stocks, System Settings, TV, Terminal, TextEdit, Tips, VoiceMemos,
VoiceOver Utility, iMovie, wBlock, zoom.us, Mail, Messages, Music, Passwords,
WhatsApp, Xcode, and iPhone Mirroring. Their complete paths, bundle identities,
versions, builds, commands, and arguments are in
`app-control-registry.json`.

These rows authorize only the recorded cold launch. They do not certify a later
controller initialization or any app-specific interaction.

## Verified exact-window control tuples

On 2026-08-05, exact native-window capture was paired with accessibility-tree
inspection and actions while the user's frontmost app stayed in place. The target windows
were hidden and off-screen. The controller selected the native window by PID
and Core Graphics window ID, mapped that exact window to its accessibility
window, and failed closed on ambiguous matches.

| App | Verified capabilities |
|---|---|
| Calculator | Exact capture, 54 exposed buttons, and a state-changing press |
| Chess | Exact board capture and a complete e2-e4 move through exposed squares |
| Dictionary | Capture, press, text value, and isolation between two same-title windows |
| Weather | Exact capture and a state-changing Air Quality action |
| VLC | Exact capture and reversible playlist control; restored image was byte-identical |

This evidence is app/version/state/capability specific. If capture works but the
required controls are absent from accessibility, classify the route as visual
read-only rather than assuming full control.

The 2026-08-05 installed-app audit also verified read-only exact-window routes
for existing background windows and three additional hidden launches. See
[app-compatibility.md](app-compatibility.md) for the full inventory and strict
coverage labels. These routes add no action capability unless a harmless,
reversible state change was separately tested.

The 2026-08-07 detached audit verified ChatGPT `26.730.61639` build `6234`
as exact-capture-only: native window `17609` captured at `3024x1718` while
WhatsApp remained frontmost. Accessibility was not trusted, so no action was
tested and the tuple is visual-read-only. Zed `1.14.2` build
`20260805.160132` failed both exact capture (`SCStreamErrorDomain -3811`) and
accessibility inspection in its observed restored editor-window state.

A comprehensive read-only audit later on 2026-08-07 accounted for all 127
installed top-level app bundles. It captured 132 exact windows across 85 apps;
76 apps had at least one exact accessibility-window mapping and 9 were
capture-only. Every material call used an exact native window ID and lease,
preserved existing processes, and added no action capability. External browsers
were excluded because their safety unit is an exact leased tab rather than an
app window. Special services, apps without an ordinary window, user-active
ChatGPT and Zed windows, and missing or stale launch tuples remained unclaimed.
The resulting exact tuples and capability limits are recorded in
`app-control-registry.json` and summarized in `app-compatibility.md`.

The Reminders row was retested on 2026-07-29 with the exact launcher
`/usr/bin/open -g -j -a /System/Applications/Reminders.app`. Across five cold
launch trials with six seconds of observation each, Reminders never became
frontmost, emitted no Reminders activation event, and exposed no onscreen
layer-0 window. This evidence authorizes only that exact hidden cold-launch
tuple. The Reminders scripting route that uses `show` followed by `activate`
intentionally foregrounds the app and remains available only as an explicit
user-attention handoff.

## Foregrounding launch tuples

| App or group | Identity | Launcher | Observed failure |
|---|---|---|---|
| Spotify | `com.spotify.client`, version/build `1.2.90.451` | `/usr/bin/open -g -j -a /Applications/Spotify.app` | Activated and exposed a window in 3/3 trials, approximately 0.46-1.76 s after launch |
| Helium | `net.imput.helium`, version/build `0.13.3.1` | `/usr/bin/open -g -j -a /Applications/Helium.app` | Activated and exposed a window in 3/3 trials, approximately 0.74-3.68 s after launch |
| Discord | `com.hnc.Discord`, version/build `0.0.393` | `/usr/bin/open -g -j -a /Applications/Discord.app` | Fresh verification on 2026-08-05 unexpectedly brought Discord frontmost; route quarantined pending independent retest |
| 2026-08-05 audited apps | Exact identities in `app-control-registry.json` | `/usr/bin/open -g -j -a APP_PATH` | Anki, Blackmagic Proxy Generator, Blackmagic RAW Speed Test, Blackmagic Remote Monitor, Cursor, DaVinci Control Panels Setup, DaVinci Resolve, Google Chrome, Opera Air, Telegram, Telegram Lite, Visual Studio Code, Notion, WeChat, and Zed became frontmost; Alacritty, LarkSuite, Dia, and Fairlight Studio Utility exposed significant onscreen windows |
| Tested Apple apps above | Exact versions listed above | `/usr/bin/open -g -a APP_PATH` | Exposed an onscreen window in 16/16 trials; Dictionary also activated in 1/2 trials |

These direct launch behaviors are not background-safe by themselves. They are
still usable through the compiled monitored-recovery path: the recovery watcher
must be running before launch, reactivate the exact last non-target app when the
target takes focus, and verify that the target is nonfrontmost before control
starts. A forced Chrome takeover test recovered ChatGPT in 51-55 ms and passed
three consecutive takeovers in one watcher session. If recovery fails, the
route is quarantined. Ad hoc focus restoration remains forbidden.

Strict non-activating launches also pre-arm the same focus-containment watcher
for saved window restoration or changed app behavior. After a launch-only
takeover, the helper may return `ready_background_recovered_launch` only when it
has restored the exact prior app and verified the target is nonfrontmost.
Subsequent work still requires the exact non-activating control capability.
A forced Calculator launch recovered the user's WeChat window in 47 ms, then
the leased exact-window controller changed the background Calculator display to
`8` and verified it without changing the foreground app.

## Existing-instance observation

The original audit preserved 14 user-owned running apps rather than terminating
them. A later monitored audit classified 12 after the user quit them. Claude
remains unverified because it stayed open. Current ChatGPT `26.730.61639` build
`6234` and Zed `1.14.2` build `20260805.160132` also remain unverified after
their first 2026-08-07 compatibility trials: Zed's was invalidated by an
independent foreground change before launch, while ChatGPT launched frontmost
and did not restore the exact prior app. Neither reached three passing trials.
Their existing-instance
control evidence is recorded separately in
[app-compatibility.md](app-compatibility.md); it is not cold-launch evidence.

Autodesk Fusion, Autodesk Fusion Service Utility, Hermes, and Print Center did
not start through the tested launcher. A failed launch is not a safe route.

Reminders `7.0` build `3976` (`com.apple.reminders`) was already running and
nonfrontmost during three calls to `open -g -j -a Reminders`. It did not
activate, but its existing windows remained onscreen behind the active app.
This is not cold-launch evidence and does not authorize sending reopen events.
For an existing background Reminders process, use only a separately proven
non-activating control interface.

## Evidence limitations

- Full-screen preservation is not a launch goal. Background accessibility
  attempts to enter full-screen foregrounded the tested app, while saved
  expanded windows could sometimes restore behind the active app. Leave a
  nonfrontmost restored layout alone; never enter or exit full-screen merely to
  normalize it during automation.
- The shared helper now watches both focus and newly exposed significant
  layer-0 target windows during its five-second launch boundary. It
  automatically quarantines a strict hidden route after either failure. A
  compiled foregrounding route instead runs the recovery watcher and is
  quarantined only if the target cannot be returned to the background.
- The helper's watchers cover a five-second sampling window. A launcher remains
  app/version-specific evidence rather than a platform guarantee.
- Retest after any app or macOS update before changing a stale row back to
  `verified_safe`.
