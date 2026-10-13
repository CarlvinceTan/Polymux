#!/bin/bash
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
. "$ROOT/scripts/verify-result.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cat > "$T/xcodebuild" <<'STUB'
#!/bin/bash
case "$1" in
  timeout) echo 'Failed to initialize for UI testing: Timed out while enabling automation mode.';;
  failure) echo "Test Case '-[ReadinessTests testSidebar]' failed";;
  mixed) echo 'Timed out while enabling automation mode.'; echo "Test Case '-[ReadinessTests testSidebar]' failed";;
esac
exit 65
STUB
chmod +x "$T/xcodebuild"
for kind in timeout failure mixed; do
  rc=0; "$T/xcodebuild" "$kind" > "$T/log" || rc=$?
  result=$(verify_result macos-test "$rc" "$T/log")
  expected=FAIL; [ "$kind" != timeout ] || expected=UNAVAILABLE
  [ "$result" = "$expected" ] || { echo "$kind: expected $expected, got $result"; exit 1; }
done
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
echo 'PASS: runner timeout, readiness cap, real failures, Release and Debug addresses'
