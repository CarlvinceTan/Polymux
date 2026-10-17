#!/bin/bash
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
PASS=0
FAILS=0
check() {
  if eval "$2"; then PASS=$((PASS+1)); echo "ok   $1"
  else FAILS=$((FAILS+1)); echo "FAIL $1"
  fi
}

git init -q -b main "$T/repo"
mkdir -p "$T/bin"
cat > "$T/bin/xcrun" <<SCRIPT
#!/bin/bash
echo "\$*" >> "$T/xcrun.log"
case "\$2" in
  list) [ "\$3" = devices ] && echo '{"devices":{"r":[{"name":"polymux-template","udid":"TPL1","isAvailable":true}]}}';;
  bootstatus) [ -f "$T/warm-fails" ] && exit 1;;
  clone) echo CLONE1;;
esac
exit 0
SCRIPT
chmod +x "$T/bin/xcrun"

run_setup() {
  (cd "$T/repo" && PATH="$T/bin:$PATH" VERIFY_HOME="$1" SIM_WARM_SETTLE=0 SIM_WARM_TIMEOUT=5 \
    bash "$ROOT/scripts/verify/wt-setup.sh") >/dev/null 2>&1
}

touch "$T/warm-fails"
: > "$T/xcrun.log"
run_setup "$T/failed"; run_setup "$T/failed"; run_setup "$T/failed"
check "template warm failures stop after two attempts" '[ "$(grep -c "simctl bootstatus" "$T/xcrun.log")" = 2 ] && [ "$(cat "$T/failed/.sim-warm-fail-TPL1")" = 2 ]'

rm "$T/warm-fails"
: > "$T/xcrun.log"
run_setup "$T/success"; run_setup "$T/success"
check "a successful template warm runs once" '[ "$(grep -c "simctl bootstatus" "$T/xcrun.log")" = 1 ] && [ -f "$T/success/.sim-warm-TPL1" ] && [ ! -e "$T/success/.sim-warm-fail-TPL1" ]'

echo "test-wt-setup: $PASS passed, $FAILS failed"
[ $FAILS = 0 ]
