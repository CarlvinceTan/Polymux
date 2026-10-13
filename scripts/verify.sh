#!/bin/bash
# The one build contract for agents: build+test macOS and iOS in this worktree, capture
# screenshots/video, write .build/proof/summary.md. Exit 0 only when everything passed.
# Builds wait for a slot in the shared lock dir (max_builds) and for ~/ops/pr-verify builds.
set -uo pipefail
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
[ -f .build/env ] || bash scripts/wt-setup.sh >/dev/null
. .build/env
P=.build/proof; L=.build/logs; R=.build/results
rm -rf "$P" "$R"; mkdir -p "$P" "$L" "$R"
LOCKS=$(python3 scripts/lanes.py get lock_dir); MAX=$(python3 scripts/lanes.py get max_builds)
mkdir -p "$LOCKS"; SLOT=""; VPID=""
cleanup() { [ -n "$VPID" ] && kill -INT "$VPID" 2>/dev/null
  pkill -f "derivedDataPath $DD" 2>/dev/null; xcrun simctl shutdown "$SIM_UDID" >/dev/null 2>&1
  [ -n "$SLOT" ] && rm -rf "$SLOT"; }
trap cleanup EXIT INT TERM
acquire() {  # mkdir is atomic; stale slots (dead pid) are reclaimed
  local t0=$SECONDS
  while :; do
    if ! pgrep -f "ops/pr-verify/.*xcodebuild|xcodebuild.*ops/pr-verify" >/dev/null; then
      for i in $(seq 1 "$MAX"); do
        s="$LOCKS/slot$i"
        if mkdir "$s" 2>/dev/null; then echo $$ > "$s/pid"; echo "$ROOT" > "$s/wt"; SLOT=$s; return; fi
        kill -0 "$(cat "$s/pid" 2>/dev/null)" 2>/dev/null || rm -rf "$s"
      done
    fi
    [ $((SECONDS - t0)) -gt 7200 ] && { echo "verify: no build slot after 2h"; exit 3; }
    sleep 15
  done
}
declare -a ROWS; FAIL=0
step() {  # step NAME cmd...
  local n=$1; shift; local t=$SECONDS
  perl -e 'alarm shift; exec @ARGV' 2400 "$@" > "$L/$n.log" 2>&1; local rc=$?
  local res=PASS; [ $rc -ne 0 ] && { res=FAIL; FAIL=1; }
  local tests=$(grep -Eo "Executed [0-9]+ tests?, with [0-9]+ failures?" "$L/$n.log" | tail -1)
  ROWS+=("| $n | $res | ${tests:--} | $((SECONDS - t))s |"); echo "verify: $n $res"
}
python3 scripts/fetch_cua.py > "$L/fetch_cua.log" 2>&1 || { echo "fetch_cua failed"; FAIL=1; }
XC=(-derivedDataPath "$DD" -clonedSourcePackagesDirPath "$SPM" -parallel-testing-enabled NO
    CLANG_MODULE_CACHE_PATH="$ROOT/.build/modcache" CODE_SIGNING_ALLOWED=NO)
acquire; echo "verify: slot $SLOT"
step packages swift test --scratch-path .build/swiftpm --cache-path .build/SPM-cache
step macos-build xcodebuild build -project apps/Polymux/Polymux.xcodeproj -scheme Polymux \
  -destination platform=macOS "${XC[@]}"
step macos-test xcodebuild test -project apps/Polymux/Polymux.xcodeproj -scheme Polymux \
  -destination platform=macOS -resultBundlePath "$R/mac.xcresult" "${XC[@]}"
xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1
step ios-test xcodebuild test -project apps/Polymux/Polymux.xcodeproj -scheme Polymux \
  -destination "id=$SIM_UDID" -resultBundlePath "$R/ios.xcresult" "${XC[@]}"
rm -rf "$SLOT"; SLOT=""   # heavy work done; media capture doesn't need the slot
# Media: iOS sim screenshots + short video, macOS screenshot, XCUITest attachments.
APP=$(find "$DD/Build/Products" -path "*iphonesimulator/*.app" -maxdepth 3 | head -1)
if [ -n "$APP" ]; then
  xcrun simctl install "$SIM_UDID" "$APP" >/dev/null 2>&1
  BID=$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$APP/Info.plist" 2>/dev/null)
  xcrun simctl io "$SIM_UDID" recordVideo --codec=h264 --force "$P/ios.mp4" >"$L/video.log" 2>&1 & VPID=$!
  xcrun simctl launch "$SIM_UDID" "$BID" >/dev/null 2>&1; sleep 6
  xcrun simctl io "$SIM_UDID" screenshot "$P/ios-1.png" >/dev/null 2>&1; sleep 6
  xcrun simctl io "$SIM_UDID" screenshot "$P/ios-2.png" >/dev/null 2>&1
  kill -INT $VPID; wait $VPID 2>/dev/null; VPID=""
fi
MAC=$(find "$DD/Build/Products" -path "*Debug/*.app" -maxdepth 3 | grep -v iphone | head -1)
if [ -n "$MAC" ]; then open -n "$MAC" 2>/dev/null; sleep 6
  screencapture -x "$P/macos.png" 2>"$L/screencapture.log"
  screencapture -x -v -V 8 "$P/macos.mov" >>"$L/screencapture.log" 2>&1
  pkill -f "$MAC/Contents/MacOS" 2>/dev/null; fi
for r in mac ios; do [ -d "$R/$r.xcresult" ] && xcrun xcresulttool export attachments \
  --path "$R/$r.xcresult" --output-path "$P/att-$r" >/dev/null 2>&1; done
grep -hE "error: .*(failed|XCTAssert)|Test Case .* failed" "$L"/*.log | sort -u | head -20 > "$P/failures.txt"
MEDIA=$(cd "$P" && ls *.png *.mp4 *.mov 2>/dev/null | tr '\n' ' ')
{ echo "## verify.sh: $([ $FAIL = 0 ] && echo PASS || echo FAIL)"
  echo "commit \`$(git rev-parse --short HEAD)\` on $(hostname -s), $(date '+%F %T %Z'), worktree $WT_NAME"
  echo; echo "| step | result | tests | time |"; echo "|---|---|---|---|"; printf '%s\n' "${ROWS[@]}"
  echo; echo "media: ${MEDIA:-none (see logs; Screen Recording permission?)}"
  [ -s "$P/failures.txt" ] && { echo; echo '```'; cat "$P/failures.txt"; echo '```'; }
} > "$P/summary.md"
cat "$P/summary.md"; exit $FAIL
