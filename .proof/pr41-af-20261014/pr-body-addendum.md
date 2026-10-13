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
