#!/bin/bash
# Armed Release scroll measurement for PR #39 (lane4/opencode), step the FIX asks for:
# build the Release app, serve the staged long thread (100 messages + 600 activity events)
# on a loopback port, run ReadinessTests.testReleaseScroll in the GUI session, and keep the
# CADisplayLink frame log plus scroll-stats.json under .proof/df2-release-scroll/.
# Nothing here runs from verify.sh; verify.sh's runs skip testReleaseScroll without the port.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
PORT=${PORT:-48741}
PROOF="$ROOT/.proof/df2-release-scroll"
LOG="$PROOF/run.log"
XC=(-project apps/Polymux/Polymux.xcodeproj -scheme Polymux -destination 'platform=macOS' -jobs 6
    -derivedDataPath .build/DD -clonedSourcePackagesDirPath .build/SPM -parallel-testing-enabled NO
    CLANG_MODULE_CACHE_PATH="$ROOT/.build/modcache" CODE_SIGNING_ALLOWED=NO)

: > "$LOG"
echo "+ python3 .proof/df2-release-scroll/proxy.py $PORT (background)" | tee -a "$LOG"
python3 "$PROOF/proxy.py" "$PORT" >> "$LOG" 2>&1 &
PROXY_PID=$!
trap 'kill "$PROXY_PID" 2>/dev/null || true' EXIT

echo "+ xcodebuild build -configuration Release" | tee -a "$LOG"
xcodebuild build "${XC[@]}" -configuration Release >> "$LOG" 2>&1

rm -rf .build/results/release-scroll.xcresult
echo "+ gui-run xcodebuild test -only-testing:PolymuxUITests/ReadinessTests/testReleaseScroll" | tee -a "$LOG"
TEST_RUNNER_POLYMUX_RELEASE_SCROLL_PORT="$PORT" bash scripts/gui-run.sh env \
  TEST_RUNNER_POLYMUX_RELEASE_SCROLL_PORT="$PORT" \
  xcodebuild test "${XC[@]}" -only-testing:PolymuxUITests/ReadinessTests/testReleaseScroll \
  -resultBundlePath .build/results/release-scroll.xcresult >> "$LOG" 2>&1
echo "exit: 0 (see $LOG)" | tee -a "$LOG"
