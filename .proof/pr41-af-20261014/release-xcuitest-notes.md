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
