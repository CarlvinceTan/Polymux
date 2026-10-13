# PR #42 UI evidence: new chat without a blocking spinner

Captures for the four states the review asked for, in both themes, on macOS and iOS, plus the
tap-to-visible signpost trace from Release builds.

| state | macOS | iOS |
|---|---|---|
| New Chat panel idle | mac-light-idle.png, mac-dark-idle.png | ios-light-idle.png, ios-dark-idle.png |
| optimistic row while the create is stalled | mac-light-optimistic.png, mac-dark-optimistic.png | ios-light-optimistic.png, ios-dark-optimistic.png |
| sidebar notice after the create fails | mac-light-notice.png, mac-dark-notice.png | ios-light-notice.png, ios-dark-notice.png |
| New Chat panel with the error shown | mac-light-error.png, mac-dark-error.png | ios-light-error.png, ios-dark-error.png |

The optimistic captures were taken while the create POST was still held by the proxy: macOS at
22:39:32 with the reply at 22:39:51; iOS at 22:36:14 with the reply at 22:36:28. The notice
captures were taken after the 500 and before the 8 s notice expiry. run.log carries the commands
and timestamps, and the stall/fail ordering is visible in the same log.

## Trace

`tap-trace-mac.txt` and `tap-trace-ios.txt` pair the OSSignposter intervals (`newChat`,
`newChatFeedback`, `newAgent`, `newAgentFeedback`) emitted by the InstantUI signposts. `newChat`
starts at the Create tap instant and ends when the state is published, so its duration is the
tap-to-visible time the app itself measures; budgets are 50 ms and 16 ms.

macOS: intervals from the running Release app (process Polymux,
`.build/DD-macrel/Build/Products/Release/Polymux.app`), 0.08-0.15 ms.
iOS: intervals from the harness run inside the booted simulator (process newchatcheck-ios linked
against release PolymuxKit), 0.04-0.06 ms.
Both are far inside budget; the raw events are in tap-trace-{mac,ios}.json.

## Method

- `apps/server` ran with `-tags verifyfixture --verify-fixture` (the verification data set) on
  127.0.0.1:22507.
- `proxy.py` forwards everything to that server except POST /threads and /agents, whose reply is
  controlled per request (`pass`, `stall` then 500, or fail with 500) - so the stall and the
  failure are real HTTP exchanges, logged with timestamps.
- macOS: the Release app window (built for this worktree) was driven with CUA AX clicks and
  captured with the same driver. Server-driven appearance settings switch the theme.
- iOS: this host has no Simulator.app and the checkout has no XCUITest target, so `NewChatCheck`
  (committed) renders the real `NewChatView` and the real sidebar rows/notice in an offscreen
  `UIWindow` inside the booted simulator and runs the same `InstantChat.start` / agent-create calls
  a tap runs, against the same proxy. The built iOS app is installed and runs against the same
  server; the harness is the only way to reach the panel states without a tap.
- The iOS sidebar scene reuses ShellView's row views and notice inset without
  `NavigationSplitView`, which asserts when rendered outside an app bundle; row content, inset
  styling and the store are the real ones.

## Not verified here

- Visual diffs against DESIGN.md tokens beyond what the screenshots show; hover/focus states.
- Frame-level (CADisplayLink) latency: the trace is the app's own tap-to-visible signpost interval,
  not a display-link measurement.
- macOS dark mode came from the server appearance setting, not the system appearance.
