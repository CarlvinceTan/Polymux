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

Release timing remains incomplete after attempt 3b at `e20a913`.
The proof-only `release-harness.patch` changes the scheme's LaunchAction to
Release, enables only the existing approval fixture with `APPROVAL_PROOF`, and
exports the existing `ApprovalClock` spans after the rollback appearance callback.
It leaves the TestAction in Debug and does not change timing calculations or UI.
Apply it with `git apply .proof/pr41-af-20261014/release-harness.patch`, build only
with the required verify.sh, then launch the Release product as documented in
`release-attempt.txt`. Reverse the patch after capture. It is not a shipped change.

The macOS Release build succeeded with `-O -whole-module-optimization` and the
signed app launched. Input was blocked: the staged driver reported Accessibility
false; native Computer Use twice returned `Sky Computer Use native pipe startup
failed`. No button tap was dispatched and no trace CSV was produced. The process
was stopped and the source/scheme overlay was restored. `release-attempt.txt`
records the command results, including GitHub's HTTP 401 blocking the PR edit.
The previous build-config.txt remains historical Debug capture provenance.

No measured 16/50 ms result is claimed for ApprovalFeedback, ApprovalState, or
ApprovalRollback. `onAppear` remains an insertion proxy, not a compositor frame;
feedback/rollback budgets are 16 ms and the state budget is 50 ms. Rollback starts
at observed request failure, not at the original tap; the five-second forced
transport failure must not be folded into the rollback rendering budget.
iOS readiness remains Debug; no iOS Release timing is claimed. The twelve existing
FocusCard captures are unchanged. `pr-body-addendum.md` is the proposed verification
addition; it was not uploaded because GitHub authentication failed.

See `verify-summary.md` for the exact passing table from the full verification.
