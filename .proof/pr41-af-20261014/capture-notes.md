# PR #41 FocusCard evidence

Source candidate: `6695ebd`, based on `a739839dd00a5465e01bd09889ab0dcd11f2a725`.
All twelve PNGs show the production `FocusCard`, using `ApprovalChoice.apply` and
`APIClient.answerFocus`. No manually assigned answered/failed state is used.

The DEBUG-only `--verify-approval` root supplies one pending approval through the
existing fixture transport. The answer request stalls for five seconds, then
fails with `cannotConnectToHost`. This creates the optimistic and rollback states.
`--approval-dark` selects the dark theme; the default is light. Bubble colours
come from the same `BubbleStyle.incoming` token as the conversation flow.

macOS: launch `.build/DD/Build/Products/Debug/Polymux.app/Contents/MacOS/Polymux`
with these arguments, capture the exact window with `cua-driver get_window_state`,
press the observed A button with AXPress, capture the chosen answer while the
request is pending, then capture the restored choices and error caption.
The local unsigned artifact required ad hoc signing before launch. The capture
session was ended and its app processes were stopped after capture.

iOS: `ReadinessTests.testApprovalStates` runs in the worktree simulator via the
required verify.sh. It checks the unanswered option, taps it, checks the answered
row and missing option, then checks the restored option and failure caption.
The six images are exported XCUITest attachments from `att-ready/manifest.json`,
renamed from `focus-<theme>-<state>` to `ios-<theme>-<state>.png`.
All twelve images were visually inspected. Sidebar readiness images are excluded.

Release timing remains incomplete. `build-config.txt` records the actual build
commands, Debug product paths, and Debug scheme actions from this run. The only
permitted build entrypoint supplies no Release override; changing the scheme to
Release would remove the DEBUG fixture needed by the existing readiness tests.
No Release trace or measured 16/50 ms result is claimed. `onAppear` remains an
insertion proxy, not a measured compositor frame; feedback/rollback budgets are
16 ms and the state budget is 50 ms. Package budget tests are separate evidence.

See `verify-summary.md` for the exact passing table from the full verification.
