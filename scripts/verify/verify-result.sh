#!/bin/bash
# verify_result STEP RC LOG -> PASS | FAIL | UNAVAILABLE on stdout. Sets VERIFY_UNAVAILABLE_REASON
# when a step is UNAVAILABLE. UNAVAILABLE = the runner never connected (machine condition, caps the
# level); a test that ran and failed is always FAIL.
verify_result() {
  local name=$1 rc=$2 log=$3
  local timeout="Timed out while enabling (UI )?automation( mode)?|test runner.*(timed out|timeout)|timed out.*(test runner|UI testing)"
  local failed='Test Case .* failed|Test .* failed after|XCTAssert.*failed|Executed .* with [1-9][0-9]* failure'
  VERIFY_UNAVAILABLE_REASON=""
  case "$name:$rc" in macos-test:11|ios-test:11|ios-ready:11) echo BLOCKED; return;; esac
  if [ "$rc" = 0 ]; then echo PASS; return; fi
  case "$name" in macos-test|ios-test|ios-ready)
    # A blocking macOS system alert: XCUITest's interruption monitor keeps re-matching the
    # com.apple.UserNotificationCenter dialog instead of the runner connecting (one macos-test took
    # 373 s that way). That is a machine condition, never a hang or a test failure. The dialog is
    # reported only: nothing here clicks or dismisses it.
    local alerts=0 capped=0
    # `|| :`: grep -c exits 1 on zero matches; callers with set -e (test-readiness.sh) must not abort.
    alerts=$(grep -c 'com\.apple\.UserNotificationCenter' "$log" 2>/dev/null || :)
    alerts=${alerts:-0}   # unreadable log: no alert lines
    case "$rc" in 142|143) capped=1;; esac  # step alarm: 142 = perl, 143 = gui-run.sh on the alarm
    if ! grep -Eq "$failed" "$log" &&
       { [ "$alerts" -ge "${ALERT_MIN:-5}" ] || { [ "$capped" = 1 ] && [ "$alerts" -gt 0 ]; }; }; then
      VERIFY_UNAVAILABLE_REASON="readiness unavailable: blocking system alert com.apple.UserNotificationCenter"
      echo UNAVAILABLE; return
    fi
    if grep -Eiq "$timeout" "$log" &&
       ! grep -Eq "$failed" "$log" &&
       ! grep -Ei "error:" "$log" | grep -Eiv "$timeout" >/dev/null; then
      echo UNAVAILABLE; return
    fi;;
  esac
  echo FAIL
}
