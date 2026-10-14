Approval answers appear immediately after a choice and restore the unanswered
card with an error message if recording fails.

## Verification — Release timing attempt 3b

Insert this addition before the existing final Release Notes section. Remote edit
was blocked by `gh pr view`: HTTP 401 Requires authentication.

macOS Release build via the required verify.sh: PASS, `-O` and whole-module
optimization. Reproducible overlay: `.proof/pr41-af-20261014/release-harness.patch`.
The overlay was reversed after the attempt; production sources and scheme are
unchanged. All twelve existing FocusCard captures are preserved.

Release timing remains incomplete: ApprovalFeedback (16 ms), ApprovalState
(50 ms), and forced-failure ApprovalRollback (16 ms) have **no measured result**.
The driver reported Accessibility false, and native Computer Use twice failed
with `Sky Computer Use native pipe startup failed`. No tap or trace was recorded.
Command results: `.proof/pr41-af-20261014/release-attempt.txt`.
`onAppear` is an insertion proxy, not a compositor frame. Rollback timing begins
at observed failure, excluding the fixture's five-second request stall.
iOS readiness is Debug; no iOS Release timing is claimed.

Final verification after restoring the overlay: required verify.sh exited 0 on
cvmini at 2026-10-14 02:24:24 +08, full targets, UI-verified. Exact table:

| step | result | tests | time |
|---|---|---|---|
| test-integrity | PASS | - | 0s |
| affected-tests | PASS | - | 2s |
| go-vet | PASS | - | 2s |
| go-test | PASS | - | 59s |
| fixture-off | PASS | - | 1s |
| packages | PASS | 193 passed, 0 failed | 8s |
| macos-build | PASS | - | 13s |
| ios-test | PASS | 2 passed, 0 failed | 54s |
| ios-ready | PASS | 2 passed, 0 failed | 32s |

## Verification — Release timing attempt 4b

At db9ca15, the proof-only overlay switched the scheme TestAction to Release,
enabled the existing fixture under APPROVAL_PROOF, and attached ApprovalClock
CSV through XCUITest. Production timing calculations were unchanged. The required
verifier exited 0; both ios-test and ios-ready passed (2 tests each). All twelve
existing FocusCard captures remain unchanged. The overlay was reversed before
final verification. macOS XCUITest was skipped by verify.sh because its runner
hangs on this host; no macOS Release timing is claimed.

Measured milliseconds (strict budgets: feedback <16, state <50, rollback <16):

| XCUITest run / theme | ApprovalFeedback | ApprovalState | ApprovalRollback |
|---|---:|---:|---:|
| ios-test / light | 2.867542 | 0.980500 | 5.280000 |
| ios-test / dark | 2.620875 | 0.617250 | 1.867375 |
| ios-ready / light | 1.991167 | 0.435792 | 4.931375 |
| ios-ready / dark | 2.648958 | 0.609125 | 5.778834 |

All recorded spans met their budgets. These are four samples, not a latency
percentile or compositor-frame measurement. `onAppear` is an insertion proxy.
Feedback/state start at the app button action after XCUITest's option.tap(); they
do not include XCTest input-dispatch latency. Forced-failure rollback starts when
ApprovalChoice catches the request failure and arms ApprovalClock, excluding the
fixture's five-second transport stall.

Evidence: release-xcuitest-harness.patch, approval-release-*-ios.csv and
approval-release-*-ready.csv, release-xcuitest-summary.md, release-xcuitest-config.txt,
and release-xcuitest-verify.log under .proof/pr41-af-20261014/.
Command: `bash /Users/carlvincetan/code/proj/Polymux/scripts/verify.sh`.
No cua-driver, Computer Use, browser, or manual tap was used.

GitHub returned HTTP 401 from `gh pr view 41 --repo CarlvinceTan/Polymux
--json body,headRefOid`; exact output is in gh-attempt.txt. The proposed final body
is saved as pr-body.md. The remote body could not be fetched or edited, so its
previous prose and release bullet could not be verified or preserved verbatim.

Final verification after reversing the overlay: verify.sh exited 0, full targets,
UI-verified, 2026-10-14 02:56:30 +08. Exact table:

| step | result | tests | time |
|---|---|---|---|
| test-integrity | PASS | - | 0s |
| affected-tests | PASS | - | 1s |
| go-vet | PASS | - | 1s |
| go-test | PASS | - | 57s |
| fixture-off | PASS | - | 1s |
| packages | PASS | 193 passed, 0 failed | 9s |
| macos-build | PASS | - | 4s |
| ios-test | PASS | 2 passed, 0 failed | 73s |
| ios-ready | PASS | 2 passed, 0 failed | 32s |

Release Notes:

- AI: Improved approval choices with immediate feedback and failure recovery.
