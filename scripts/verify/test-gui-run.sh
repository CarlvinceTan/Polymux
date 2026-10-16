#!/bin/bash
# gui-run.sh with a stub launchctl (Background session) on PATH.
# Checks stdout/stderr and exit code pass through, the agent is booted out, the temp dir is removed,
# and a failed bootstrap returns 125.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd); T=$(mktemp -d); trap "rm -rf $T" EXIT
mkdir -p "$T/bin" "$T/tmp"
cat > "$T/bin/launchctl" <<"SH"
#!/bin/bash
echo "$*" >> "$STUB_LOG"
case $1 in
  managername) echo Background;;
  bootstrap) [ "${STUB_FAIL:-0}" = 1 ] && exit 5
    run=$(plutil -extract ProgramArguments.1 raw -o - "$3"); bash "$run" > /dev/null 2>&1 &;;
  bootout) ;;
esac
SH
chmod +x "$T/bin/launchctl"
fail() { echo "FAIL: $1"; exit 1; }
export PATH="$T/bin:$PATH" TMPDIR="$T/tmp" STUB_LOG="$T/log"
rc=0; out=$(bash "$ROOT/scripts/verify/gui-run.sh" sh -c "echo out-line; echo err-line >&2; exit 7") || rc=$?
[ "$rc" = 7 ] || fail "exit code $rc, want 7"
echo "$out" | grep -qx out-line || fail "stdout not passed through: $out"
echo "$out" | grep -qx err-line || fail "stderr not passed through: $out"
grep -q "^bootstrap gui/$(id -u) " "$T/log" || fail "no bootstrap into gui/<uid>"
grep -q "^bootout gui/$(id -u)/com.carlvince.gui-run." "$T/log" || fail "agent not booted out"
[ -z "$(ls -A "$T/tmp")" ] || fail "temp dir left: $(ls "$T/tmp")"
out=$(POLYMUX_DATA_DIR="$T/data" TEST_RUNNER_POLYMUX_DATA_DIR="$T/runner" \
  SIMCTL_CHILD_POLYMUX_DATA_DIR="$T/simulator" bash "$ROOT/scripts/verify/gui-run.sh" \
  sh -c 'printf "%s\n" "$POLYMUX_DATA_DIR" "$TEST_RUNNER_POLYMUX_DATA_DIR" "$SIMCTL_CHILD_POLYMUX_DATA_DIR"')
[ "$out" = "$T/data
$T/runner
$T/simulator" ] || fail "verification data environment not preserved: $out"
: > "$T/log"; rc=0; out=$(STUB_FAIL=1 bash "$ROOT/scripts/verify/gui-run.sh" true 2>&1) || rc=$?
[ "$rc" = 125 ] || fail "failed bootstrap rc $rc, want 125"
[ -z "$(ls -A "$T/tmp")" ] || fail "temp dir left after failed load"
echo "PASS: gui-run passes stdout/stderr and exit code, boots out the agent, removes its temp dir, 125 on failed load"
