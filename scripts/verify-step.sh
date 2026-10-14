#!/bin/bash
# Shared with the lane tests so they exercise the real step recorder.
step() {  # step NAME cmd...
  local n=$1; shift; local t=$SECONDS; mark
  perl -e 'alarm shift; exec @ARGV' 2400 "$@" > "$L/$n.log" 2>&1; local rc=$?
  local res; res=$(verify_result "$n" "$rc" "$L/$n.log")
  [ "$res" = FAIL ] && FAIL=1
  if [ "$res" = UNAVAILABLE ]; then
    UI_UNAVAILABLE=1
    echo "verify: $n readiness unavailable (runner automation timeout); caps level below UI-verified"
  fi
  local tests=$(awk '/^Test Case .* passed/||/^. Test .* passed after/{p++} /^Test Case .* failed/||/^. Test .* failed after/{f++}
    END{if(p+f) printf "%d passed, %d failed", p, f}' "$L/$n.log")
  [ "$res" = FAIL ] && [ -n "${LANE_TEST_LOG:-}" ] && wd_fail_names < "$L/$n.log" | sort -u >> "$LANE_TEST_LOG" 2>/dev/null || true
  ROWS+=("| $n | $res | ${tests:--} | $((SECONDS - t))s |"); echo "verify: $n $res"
}
