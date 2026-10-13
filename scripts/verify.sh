#!/bin/bash
# The one build contract for agents: Go server vet+test, Swift packages, macOS and iOS
# build/test in this worktree, readiness UI test (proof = its XCUITest attachments), optional
# allowed-files check (VERIFY_SCOPE="glob,glob" from the task brief's scope: line),
# VERIFY_TARGETS=full (default; merge lane / --verify-only) | affected (task lanes: only the Go packages,
# Swift test targets and app builds reachable from paths changed since TI_BASE, via scripts/affected.py),
# write .build/proof/summary.md. Exit 0 only when everything passed.
# Builds wait for a slot in the shared lock dir (max_builds; 1 while ~/ops/pr-verify builds).
set -uo pipefail
SD=$(cd "$(dirname "$0")" && pwd)   # scripts may live in another checkout (cloud PRs)
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
# Toolchain preflight, before any step (and before wt-setup): every tool this run needs must be on PATH.
# Needed = the steps that will run (apps/server -> go; Swift packages + Xcode app -> swift, xcodebuild,
# xcrun;) plus the task's needs: line (VERIFY_NEEDS from run-lane.sh: go,
# swift/ios/macos/xcode, node/npm/web). Missing -> exit 10 = infra error (run-lane.sh: failures.tsv
# 'infra' row + NEEDS_CODY, not a task failure, not counted by lane-guard). VERIFY_PATH: test hook.
# Go lives in ~/.local/go on the Macs, which launchd (lane-guard dispatch) PATHs lack.
[ -x "$HOME/.local/go/bin/go" ] && case ":$PATH:" in *":$HOME/.local/go/bin:"*) ;; *) export PATH="$PATH:$HOME/.local/go/bin";; esac
need_tools() { local t=" " n
  [ -d apps/server ] && t+="go "
  { [ -f Package.swift ] || [ -d apps/Polymux ]; } && t+="swift xcodebuild xcrun "
  for n in $(echo "${VERIFY_NEEDS:-}" | tr 'A-Z,' 'a-z '); do case $n in
    go|server) t+="go ";; swift|ios|macos|mac|xcode|apple) t+="swift xcodebuild xcrun ";;
    node|npm|web|js|ts) t+="node npm ";; esac; done
  echo $t | tr ' ' '\n' | awk 'NF&&!s[$0]++' | tr '\n' ' '; }
MISSING=""; for t in $(need_tools); do PATH="${VERIFY_PATH:-$PATH}" command -v "$t" >/dev/null 2>&1 || MISSING+="$t "; done
if [ -n "$MISSING" ]; then echo "verify: INFRA missing toolchain: ${MISSING% }"
  mkdir -p .build/proof && echo blocked > .build/proof/level
  printf '## verify.sh: INFRA\nmissing toolchain on %s: %s (needs: %s)\n' "$(hostname -s)" "${MISSING% }" "${VERIFY_NEEDS:-none}" > .build/proof/summary.md
  exit 10; fi
[ -f .build/env ] || bash "$SD/wt-setup.sh" >/dev/null
. .build/env
# One verify per worktree at a time. An agent may start verify.sh in the background and exit,
# then run-lane.sh starts its own; both use $DD and xcodebuild fails "build.db is locked".
. "$SD/lanelib.sh"; WL="$ROOT/.build/verify.lock"; WT0=$SECONDS
until lock_take "$WL"; do
  [ $((SECONDS-WT0)) -gt 2700 ] && { echo "verify: another verify (pid $(lock_holder "$WL")) still running here after 45m"; exit 1; }
  echo "verify: waiting for verify pid $(lock_holder "$WL") in this worktree"; sleep 10
done
P=.build/proof; L=.build/logs; R=.build/results
VD="$ROOT/.build/verify-data"; rm -rf "$P" "$R" "$VD"; mkdir -p "$P" "$L" "$R" "$VD"
# Own app data per worktree; the seed switch is the app launch argument --verify-fixture
# (verify-polymux-features.md Part 2), passed by ReadinessTests, not an env var. The flag exists
# only in -tags verifyfixture builds; verify.sh starts no fixture server yet and the app has no
# --verify-fixture handler, so ReadinessTests cannot use it until wiring lands.
export POLYMUX_DATA_DIR="$VD" TEST_RUNNER_POLYMUX_DATA_DIR="$VD" SIMCTL_CHILD_POLYMUX_DATA_DIR="$VD"
LOCKS=$(python3 "$SD/lanes.py" get lock_dir); MAX=${VERIFY_MAX_BUILDS:-$(python3 "$SD/lanes.py" get max_builds)}
mkdir -p "$LOCKS"; SLOT=""; VPID=""
# Freshness markers for cleanup.sh (hourly): it skips a worktree/sim whose verify holds .build/verify.lock
# or touched a marker < 2h ago. Touched again before each step, so long runs stay fresh.
mkdir -p "$LOCKS/active"; mark() { touch .build/verify-active "$LOCKS/active/polymux-$WT_NAME" 2>/dev/null; }; mark
cleanup() { [ -n "$VPID" ] && kill -INT "$VPID" 2>/dev/null
  pkill -f "derivedDataPath $DD" 2>/dev/null; xcrun simctl shutdown "$SIM_UDID" >/dev/null 2>&1
  [ -n "$SLOT" ] && rm -rf "$SLOT"; rm -rf "$WL"; }
trap cleanup EXIT INT TERM
acquire() {  # mkdir is atomic; stale slots (dead pid) are reclaimed
  local t0=$SECONDS
  while :; do
    local m=$MAX   # ~/ops/pr-verify busy -> share politely: at most one of ours at a time
    pgrep -f "xcodebuild.*ops/pr-verify" >/dev/null && m=1
    if :; then
      for i in $(seq 1 "$m"); do
        s="$LOCKS/slot$i"
        if lock_take "$s"; then echo "$ROOT" > "$s/wt"; SLOT=$s; return; fi
      done
    fi
    [ $((SECONDS - t0)) -gt 7200 ] && { echo "verify: no build slot after 2h"; echo blocked > "$P/level"; exit 3; }
    sleep 15
  done
}
declare -a ROWS; FAIL=0
skip() { ROWS+=("| $1 | SKIP | not affected | 0s |"); echo "verify: $1 SKIP (not affected)"; }
GO_PKGS=./... SWIFT=all APP=1; VT=${VERIFY_TARGETS:-full}
if [ "$VT" = affected ]; then
  if A=$(python3 "$SD/affected.py" "${TI_BASE:-origin/main}" 2>"$L/affected.log"); then eval "$A"
    [ "$GO_PKGS" = all ] && GO_PKGS=./...
    echo "verify: affected ($WHY): go=[${GO_PKGS:-none}] swift=[${SWIFT:-none}] app=$APP"
  else VT=full; echo "verify: affected.py failed, running full (see $L/affected.log)"; fi
fi
step() {  # step NAME cmd...
  local n=$1; shift; local t=$SECONDS; mark
  perl -e 'alarm shift; exec @ARGV' 2400 "$@" > "$L/$n.log" 2>&1; local rc=$?
  local res=PASS; [ $rc -ne 0 ] && { res=FAIL; FAIL=1; }
  local tests=$(awk '/^Test Case .* passed/||/^. Test .* passed after/{p++} /^Test Case .* failed/||/^. Test .* failed after/{f++}
    END{if(p+f) printf "%d passed, %d failed", p, f}' "$L/$n.log")
  ROWS+=("| $n | $res | ${tests:--} | $((SECONDS - t))s |"); echo "verify: $n $res"
}
step test-integrity bash "$SD/test-integrity.sh" "${TI_BASE:-origin/main}"
[ -n "${VERIFY_SCOPE:-}" ] && step allowed-files bash -c '. "$1"; scope_check "$2" "$3"' _ "$SD/lanelib.sh" "${TI_BASE:-origin/main}" "$VERIFY_SCOPE"
# Lane scripts changed -> run their hermetic tests too.
# From the worktree under test, so --verify-only checks the PR's own scripts and tests.
lane_files_changed "${TI_BASE:-origin/main}" && step lane-tests bash "$(lane_tests_path "$ROOT" "$SD")"
if [ -d apps/server ] && [ -z "$GO_PKGS" ]; then skip go-vet; skip go-test; skip fixture-off
elif [ -d apps/server ]; then
  step go-vet sh -c 'cd apps/server && GOMAXPROCS=4 go vet -tags sqlite_fts5 $1 && GOMAXPROCS=4 go vet -tags "sqlite_fts5 verifyfixture" $1' _ "$GO_PKGS"
  # -json keeps per-test times (go-test.json); the text log stays readable for failures.txt.
  step go-test sh -c 'cd apps/server && GOMAXPROCS=4 go test -p 4 -tags "sqlite_fts5 verifyfixture" -count=1 -json $1 > "$2" ; rc=$?; python3 -c "import json,sys
for l in open(sys.argv[1]):
  try: e=json.loads(l)
  except ValueError: continue
  if e.get(\"Action\")==\"output\": sys.stdout.write(e.get(\"Output\",\"\"))" "$2"; exit $rc' _ "$GO_PKGS" "$ROOT/$L/go-test.json"
  # Opt-in fixture: a default-tag build must compile and must not advertise --verify-fixture.
  step fixture-off sh -c 'cd apps/server && out=$(go run ./cmd/server -h 2>&1) || { printf "%s\n" "$out"; exit 1; }; printf "%s" "$out" | grep -q verify-fixture && { echo "default build advertises --verify-fixture"; exit 1; }; exit 0'
fi
NEED_SLOT=1; [ "$APP" = 0 ] && [ -z "$SWIFT" ] && NEED_SLOT=0
if [ "$APP" = 1 ]; then python3 scripts/fetch_cua.py > "$L/fetch_cua.log" 2>&1 || { echo "verify: fetch_cua failed"; echo blocked > "$P/level"; exit 3; }; fi
XC=(-jobs 6 -derivedDataPath "$DD" -clonedSourcePackagesDirPath "$SPM" -parallel-testing-enabled NO
    CLANG_MODULE_CACHE_PATH="$ROOT/.build/modcache" CODE_SIGNING_ALLOWED=NO)
[ $NEED_SLOT = 1 ] && { acquire; echo "verify: slot $SLOT"; }
if [ -z "$SWIFT" ]; then skip packages
elif [ "$SWIFT" = all ]; then step packages swift test --scratch-path .build/swiftpm --cache-path .build/SPM-cache
else step packages swift test --scratch-path .build/swiftpm --cache-path .build/SPM-cache --filter "$SWIFT"; fi
if [ "$APP" = 0 ]; then skip macos-build; skip ios-build; ACT=skip; READY=unavailable
else
step macos-build xcodebuild build -project apps/Polymux/Polymux.xcodeproj -scheme Polymux \
  -destination platform=macOS "${XC[@]}"
# App scheme gains a test action later (UI tests); until then build it and rely on package tests.
ACT=build; grep -q "<TestableReference" apps/Polymux/Polymux.xcodeproj/xcshareddata/xcschemes/Polymux.xcscheme && ACT=test
[ $ACT = test ] && step macos-test xcodebuild test -project apps/Polymux/Polymux.xcodeproj -scheme Polymux \
  -destination platform=macOS -resultBundlePath "$R/mac.xcresult" "${XC[@]}"
xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1
step ios-$ACT xcodebuild $ACT -project apps/Polymux/Polymux.xcodeproj -scheme Polymux \
  -destination "id=$SIM_UDID" $([ $ACT = test ] && echo -resultBundlePath "$R/ios.xcresult") "${XC[@]}"
# Readiness: a UI test waits on chats.list + all 12 sidebar.row.<id> and the plan's waits, never sleeps.
READY=unavailable; UT=apps/Polymux/PolymuxUITests/ReadinessTests.swift
if [ -f "$UT" ]; then step ios-ready xcodebuild test -project apps/Polymux/Polymux.xcodeproj -scheme Polymux \
  -destination "id=$SIM_UDID" -only-testing:PolymuxUITests/ReadinessTests -resultBundlePath "$R/ready.xcresult" "${XC[@]}"
  grep -q '^| ios-ready | PASS' <(printf '%s\n' "${ROWS[@]}") && READY=yes || READY=no
else echo "verify: readiness unavailable (no $UT; see scripts/templates/ReadinessTests.swift); caps level below UI-verified"; fi
fi
rm -rf "$SLOT"; SLOT=""
# Proof = XCUITest attachments (readiness screenshots taken after every wait held). No sleep-N
# simctl shots and no macOS screencapture (unreliable over SSH on cvmini).
for r in mac ios ready; do [ -d "$R/$r.xcresult" ] && xcrun xcresulttool export attachments \
  --path "$R/$r.xcresult" --output-path "$P/att-$r" >/dev/null 2>&1; done
# Exported files have generated names; manifest.json maps them to the attachment names.
[ -f "$P/att-ready/manifest.json" ] && python3 - "$P" <<'PY'
import json, shutil, sys, os
P = sys.argv[1]; A = os.path.join(P, "att-ready")
for t in json.load(open(os.path.join(A, "manifest.json"))):
    for a in t.get("attachments", []):
        f, n = a.get("exportedFileName", ""), a.get("suggestedHumanReadableName", "")
        if not f or not os.path.exists(os.path.join(A, f)): continue
        if n.startswith("ready.json"): shutil.copy(os.path.join(A, f), os.path.join(P, "ready.json"))
        elif f.endswith(".png"): shutil.copy(os.path.join(A, f), os.path.join(P, "ready-" + f))
PY
grep -hE "error: .*(failed|XCTAssert)|Test Case .* failed" "$L"/*.log | sort -u | head -20 > "$P/failures.txt"
MEDIA=$(cd "$P" && ls *.png *.mp4 *.mov 2>/dev/null | tr '\n' ' ')
# Verification level (exact names): UI-verified | unit-test-verified | build-only | blocked | failed
ok() { printf '%s\n' "${ROWS[@]}" | grep -q "^| $1 | PASS | [1-9]"; }
LEVEL=build-only; ok packages && LEVEL=unit-test-verified
[ "$VT" = affected ] && [ -z "$SWIFT" ] && printf "%s\n" "${ROWS[@]}" | grep -q "^| go-test | PASS" && LEVEL=unit-test-verified   # Go-only change
[ $READY = yes ] && [ -s "$P/ready.json" ] && ls "$P"/ready-*.png >/dev/null 2>&1 && LEVEL=UI-verified   # readiness + ready.json required
[ $FAIL = 1 ] && LEVEL=failed
echo $LEVEL > "$P/level"
{ echo "## verify.sh: $([ $FAIL = 0 ] && echo PASS || echo FAIL)"
  echo "commit \`$(git rev-parse --short HEAD)\` on $(hostname -s), $(date '+%F %T %Z'), worktree $WT_NAME"
  echo "targets: $VT$([ "$VT" = affected ] && echo " (go: ${GO_PKGS:-none}; swift: ${SWIFT:-none}; app: $APP)")"
  echo "level: **$LEVEL**, ready (chats.list + 12 sidebar rows + waits): $READY"
  echo; echo "| step | result | tests | time |"; echo "|---|---|---|---|"; printf '%s\n' "${ROWS[@]}"
  echo; echo "media: ${MEDIA:-none (readiness test attachments only)}"
  [ -s "$P/failures.txt" ] && { echo; echo '```'; cat "$P/failures.txt"; echo '```'; }
} > "$P/summary.md"
# Evidence layout (verify-polymux-features.md): ~/verify-evidence/<worktree>/<run-id>
EV="$HOME/verify-evidence/$WT_NAME/$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"; mkdir -p "$EV"
cp -R "$P" "$EV/proof"; cp -R "$L" "$EV/logs"
for x in "$R"/*.xcresult; do [ -d "$x" ] && xcrun xcresulttool get test-results summary --path "$x" \
  > "$EV/$(basename "$x" .xcresult)-summary.json" 2>/dev/null; done
echo "evidence: $EV" | tee -a "$P/summary.md"; echo "$EV" > "$P/evidence"
cat "$P/summary.md"; exit $FAIL
