#!/bin/bash
# Armed Release scroll measurement for PR #39 (lane4/opencode), step the FIX asks for:
# build the Release app, serve the staged long thread (100 messages + 600 activity events)
# on a loopback port, run ReadinessTests.testReleaseScroll in the GUI session, and keep the
# CADisplayLink frame log plus scroll-stats.json under .proof/df2-release-scroll/.
# The armed run needs the app under test in Release, so the scheme's TestAction config is
# patched for the run and restored on exit (the patch is kept as release-test.patch).
# verify.sh's own runs skip testReleaseScroll without POLYMUX_RELEASE_SCROLL_PORT.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
PORT=${PORT:-48741}
PROOF="$ROOT/.proof/df2-release-scroll"
SCHEME=apps/Polymux/Polymux.xcodeproj/xcshareddata/xcschemes/Polymux.xcscheme
LOG="$PROOF/run.log"
XC=(-project apps/Polymux/Polymux.xcodeproj -scheme Polymux -destination 'platform=macOS' -jobs 6
    -derivedDataPath .build/DD -clonedSourcePackagesDirPath .build/SPM -parallel-testing-enabled NO
    CLANG_MODULE_CACHE_PATH="$ROOT/.build/modcache" CODE_SIGNING_ALLOWED=NO)

: > "$LOG"
echo "+ python3 .proof/df2-release-scroll/proxy.py $PORT (background)" | tee -a "$LOG"
python3 "$PROOF/proxy.py" "$PORT" >> "$LOG" 2>&1 &
PROXY_PID=$!
restore() { git checkout -- "$SCHEME" 2>/dev/null || true; kill "$PROXY_PID" 2>/dev/null || true; }
trap restore EXIT
trap 'exit 143' INT TERM HUP

echo "+ xcodebuild build -configuration Release" | tee -a "$LOG"
xcodebuild build "${XC[@]}" -configuration Release >> "$LOG" 2>&1

sed -i '' 's/<TestAction buildConfiguration="Debug"/<TestAction buildConfiguration="Release"/' "$SCHEME"
git diff -- "$SCHEME" > "$PROOF/release-test.patch"
grep -q 'TestAction buildConfiguration="Release"' "$SCHEME" || { echo "scheme patch failed" | tee -a "$LOG"; exit 1; }

rm -rf .build/results/release-scroll.xcresult
echo "+ gui-run xcodebuild test -only-testing:PolymuxUITests/ReadinessTests/testReleaseScroll" | tee -a "$LOG"
bash scripts/gui-run.sh env TEST_RUNNER_POLYMUX_RELEASE_SCROLL_PORT="$PORT" \
  xcodebuild test "${XC[@]}" -only-testing:PolymuxUITests/ReadinessTests/testReleaseScroll \
  -resultBundlePath .build/results/release-scroll.xcresult >> "$LOG" 2>&1
echo "exit: 0 (see $LOG)" | tee -a "$LOG"
