#!/bin/bash
# check-runner-sign.sh APP: fail fast when the macOS UI test runner is not validly signed.
# verify.sh builds macOS with signing enabled (CODE_SIGN_IDENTITY=-, ad-hoc). If Xcode ever leaves
# PolymuxUITests-Runner.app unsigned or half-rewritten, macOS shows the Gatekeeper "damaged" dialog
# and XCUITest's interruption monitor loops on it instead of connecting (VERIFY-ALERT-GUARD).
# codesign -v is the check Gatekeeper makes; one second here beats a 600 s macos-test cap.
# codesign comes from PATH (stub in scripts/test-readiness.sh).
set -uo pipefail
APP=${1:?usage: check-runner-sign.sh /path/to/PolymuxUITests-Runner.app}
[ -d "$APP" ] || { echo "$APP was not built"; exit 1; }
if ! out=$(codesign -v "$APP" 2>&1); then
  printf '%s\n' "$out"
  echo "$(basename "$APP") fails codesign -v; Gatekeeper would show the damaged dialog"
  exit 1
fi
echo "$(basename "$APP") verifies with codesign -v"
