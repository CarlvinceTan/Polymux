#!/bin/bash
# Shared verifier step implementation.
step() {  # step NAME cmd...
  local n=$1; shift; local t=$SECONDS; mark
  local -a command=("$@")
  case "$n" in macos-test|ios-test|ios-ready)
    if [ "${UI_READY:-0}" != 1 ]; then
      ROWS+=("| $n | SKIP | macOS UI preflight build failed | 0s |")
      echo "verify: $n SKIP (macOS UI preflight build failed)"; return
    fi
    command=(python3 "$SD/ui-guard.py" --helper "$ROOT/.build/ui-environment"
      --app "$DD/Build/Products/Debug/Polymux.app" --evidence "$ROOT/$L/ui-guard/$n" -- "${command[@]}");;
  esac
  local cap=2400; [ "$n" = macos-test ] && cap=${MACOS_TEST_TIMEOUT:-600}
  perl -e 'alarm shift; exec @ARGV' "$cap" "${command[@]}" > "$L/$n.log" 2>&1; local rc=$?
  case $rc in 142|143) echo "verify: $n hit the ${cap}s cap (step alarm)" >> "$L/$n.log";; esac
  local vf="$L/$n.verdict"; verify_result "$n" "$rc" "$L/$n.log" > "$vf"
  local res; res=$(<"$vf")
  if [ "$res" = BLOCKED ]; then
    local reason; reason=$(sed -n 's/^verify: ENV //p' "$L/$n.log" | tail -1)
    reason=${reason:-UI environment could not be verified}
    ROWS+=("| $n | BLOCKED | environment | $((SECONDS - t))s |")
    echo "verify: ENV $reason"
    echo blocked > "$P/level"
    python3 - "$P/environment.json" "$reason" <<'PY'
import json, sys, time
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({"class": "environment", "reason": sys.argv[2], "time": time.time()}))
PY
    { echo '## verify.sh: BLOCKED'; echo "environment: $reason"
      echo 'level: **blocked**; UI verification stopped; no retry'
      echo; echo '| step | result | tests | time |'; echo '|---|---|---|---|'; printf '%s\n' "${ROWS[@]}"
      echo; echo "Local dialog evidence: $ROOT/$L/ui-guard/$n"
    } > "$P/summary.md"
    local archive="$HOME/verify-evidence/$WT_NAME/$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
    mkdir -p "$archive"
    echo "evidence: $archive" >> "$P/summary.md"
    echo "$archive" > "$P/evidence"
    cp -R "$P" "$archive/proof"; cp -R "$L" "$archive/logs"
    cat "$P/summary.md"
    exit 11
  fi
  [ "$res" = FAIL ] && FAIL=1
  if [ "$res" = UNAVAILABLE ]; then
    UI_UNAVAILABLE=1
    echo "verify: $n ${VERIFY_UNAVAILABLE_REASON:-readiness unavailable (runner automation timeout)}; caps level below UI-verified"
  fi
  local tests=$(awk '/^Test Case .* passed/||/^. Test .* passed after/{p++} /^Test Case .* failed/||/^. Test .* failed after/{f++}
    END{if(p+f) printf "%d passed, %d failed", p, f}' "$L/$n.log")
  ROWS+=("| $n | $res | ${tests:--} | $((SECONDS - t))s |"); echo "verify: $n $res"
}
