#!/bin/bash
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
. "$ROOT/scripts/verify-result.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cat > "$T/xcodebuild" <<'STUB'
#!/bin/bash
case "$1" in
  timeout) echo 'Failed to initialize for UI testing: Timed out while enabling automation mode.';;
  runner) echo 'xcodebuild: error: Timed out waiting for test runner to initialize.';;
  compile) echo 'Timed out while enabling automation mode.'; echo 'error: cannot find symbol';;
  failure) echo "Test Case '-[ReadinessTests testSidebar]' failed";;
  mixed) echo 'Timed out while enabling automation mode.'; echo "Test Case '-[ReadinessTests testSidebar]' failed";;
  alert) for i in 1 2 3 4 5 6; do echo "    t = ${i}s Find \"action-button-$i\" Button in com.apple.UserNotificationCenter"; done;;
  alert-fail) echo "Find \"Help\" Button in com.apple.UserNotificationCenter"; echo "Test Case '-[ReadinessTests testSidebar]' failed";;
esac
exit 65
STUB
chmod +x "$T/xcodebuild"
for kind in timeout runner compile failure mixed alert alert-fail; do
  rc=0; "$T/xcodebuild" "$kind" > "$T/log" || rc=$?
  result=$(verify_result macos-test "$rc" "$T/log")
  expected=FAIL; case "$kind" in timeout|runner|alert) expected=UNAVAILABLE;; esac
  [ "$result" = "$expected" ] || { echo "$kind: expected $expected, got $result"; exit 1; }
done
# Blocking system alert (com.apple.UserNotificationCenter) at the macos-test cap: UNAVAILABLE with
# the alert named, never a hang; the same cap with no dialog is a real hang and stays FAIL.
"$T/xcodebuild" alert > "$T/log" || :
# Direct call: verify_result sets VERIFY_UNAVAILABLE_REASON for its caller, and verify.sh step() reads
# it the same way (a $( ) capture would run in a subshell and lose it).
verify_result macos-test 143 "$T/log" > "$T/result"
result=$(<"$T/result")
[ "$result" = UNAVAILABLE ] || { echo "capped alert: expected UNAVAILABLE, got $result"; exit 1; }
case "$VERIFY_UNAVAILABLE_REASON" in *"blocking system alert com.apple.UserNotificationCenter"*) ;;
  *) echo "capped alert reason: ${VERIFY_UNAVAILABLE_REASON:-none}"; exit 1;; esac
result=$(verify_result macos-test 143 /dev/null)
[ "$result" = FAIL ] || { echo "capped hang: expected FAIL, got $result"; exit 1; }
# check-runner-sign.sh: a stub codesign decides, so no real signing and no damaged dialog.
mkdir -p "$T/bin/PolymuxUITests-Runner.app"
cat > "$T/bin/codesign" <<'STUB'
#!/bin/bash
[ -n "${STUB_SIGN_OUT:-}" ] && echo "$STUB_SIGN_OUT"
exit "${STUB_SIGN_RC:-0}"
STUB
chmod +x "$T/bin/codesign"
rc=0; out=$(STUB_SIGN_RC=1 STUB_SIGN_OUT='code object is not signed at all' PATH="$T/bin:$PATH" \
  bash "$ROOT/scripts/check-runner-sign.sh" "$T/bin/PolymuxUITests-Runner.app" 2>&1) || rc=$?
[ "$rc" = 1 ] || { echo "unsigned runner: rc $rc, want 1"; exit 1; }
case "$out" in *"code object is not signed at all"*) ;; *) echo "codesign output lost: $out"; exit 1;; esac
case "$out" in *"PolymuxUITests-Runner.app fails codesign -v; Gatekeeper would show the damaged dialog"*) ;;
  *) echo "unsigned runner message: $out"; exit 1;; esac
PATH="$T/bin:$PATH" bash "$ROOT/scripts/check-runner-sign.sh" "$T/bin/PolymuxUITests-Runner.app" \
  || { echo "signed runner rejected"; exit 1; }
rc=0; PATH="$T/bin:$PATH" bash "$ROOT/scripts/check-runner-sign.sh" "$T/bin/absent.app" >/dev/null 2>&1 || rc=$?
[ "$rc" = 1 ] || { echo "missing runner: rc $rc, want 1"; exit 1; }
# Exercise the same level gate used by verify, with otherwise valid readiness proof.
python3 - "$ROOT/scripts/verify.sh" <<'PY'
import pathlib, subprocess, sys, tempfile
s = pathlib.Path(sys.argv[1]).read_text()
gate = next(line for line in s.splitlines() if 'LEVEL=UI-verified' in line)
with tempfile.TemporaryDirectory() as p:
    pathlib.Path(p, 'ready.json').write_text('{}')
    pathlib.Path(p, 'ready-test.png').touch()
    for unavailable, expected in [(0, 'UI-verified'), (1, 'unit-test-verified')]:
        script = f'P={p}; READY=yes; UI_UNAVAILABLE={unavailable}; LEVEL=unit-test-verified\n{gate}\necho "$LEVEL"'
        assert subprocess.check_output(['bash', '-c', script], text=True).strip() == expected
PY
for mode in release debug; do
  flags=(); [ "$mode" != debug ] || flags=(-D DEBUG)
  swiftc "${flags[@]}" "$ROOT/apps/Polymux/Sources/ServerAddress.swift" \
    "$ROOT/scripts/ServerAddressTest.swift" -o "$T/address"
  "$T/address"
done
# gui-run.sh: passes the exit code and output through, and verify.sh routes macos-test via it.
rc=0; out=$(GUI_RUN_FORCE_EXEC=1 bash "$ROOT/scripts/gui-run.sh" sh -c "echo hi; exit 7") || rc=$?
[ "$rc" = 7 ] && [ "$out" = hi ] || { echo "FAIL: gui-run.sh rc=$rc out=$out"; exit 1; }
grep -q "step macos-test bash \"\$ROOT/scripts/gui-run.sh\" xcodebuild test" "$ROOT/scripts/verify.sh" || { echo "FAIL: macos-test not run via gui-run.sh"; exit 1; }
grep -q "step macos-sign bash \"\$ROOT/scripts/check-runner-sign.sh\"" "$ROOT/scripts/verify.sh" || { echo "FAIL: macos-sign preflight missing"; exit 1; }
grep -q 'MACOS_TEST_TIMEOUT:-600' "$ROOT/scripts/verify.sh" || { echo "FAIL: macos-test has no own cap"; exit 1; }
# Scope 0: the macOS path ad-hoc signs (never CODE_SIGNING_ALLOWED=NO) and builds the runner before
# macos-sign reads it, so the Gatekeeper "damaged" dialog can never come back.
grep -q '^XCT=(.*CODE_SIGN_IDENTITY=- ' "$ROOT/scripts/verify.sh" || { echo "FAIL: no ad-hoc sign flags in XCT"; exit 1; }
grep -q '^XCT=(.*CODE_SIGN_ENTITLEMENTS= ENABLE_HARDENED_RUNTIME=NO' "$ROOT/scripts/verify.sh" || { echo "FAIL: XCT keeps entitlements or hardened runtime"; exit 1; }
! grep -q '^XCT=(.*CODE_SIGNING_ALLOWED=NO' "$ROOT/scripts/verify.sh" || { echo "FAIL: XCT disables signing"; exit 1; }
grep -A2 'step macos-build' "$ROOT/scripts/verify.sh" | grep -q 'XCT\[@\]' || { echo "FAIL: macOS app build is not ad-hoc signed"; exit 1; }
grep -q 'step macos-test-build xcodebuild build-for-testing' "$ROOT/scripts/verify.sh" || { echo "FAIL: runner is not built before macos-sign"; exit 1; }
grep -A3 'step macos-test bash' "$ROOT/scripts/verify.sh" | grep -q 'XCT\[@\]' || { echo "FAIL: macos-test does not use the ad-hoc flags"; exit 1; }
awk '/step macos-sign /{s=NR} /step macos-test /{t=NR} END{exit !(s && t && s<t)}' "$ROOT/scripts/verify.sh" \
  || { echo "FAIL: macos-sign must run before macos-test"; exit 1; }
bash "$ROOT/scripts/test-gui-run.sh"
echo 'PASS: runner timeout, blocking-alert guard, readiness cap, real failures, runner signing, Release and Debug addresses, gui-run'
