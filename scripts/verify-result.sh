#!/bin/bash
verify_result() {
  local name=$1 rc=$2 log=$3
  local timeout="Timed out while enabling (UI )?automation( mode)?|test runner.*(timed out|timeout)|timed out.*(test runner|UI testing)"
  if [ "$rc" = 0 ]; then echo PASS; return; fi
  case "$name" in macos-test|ios-test|ios-ready)
    if grep -Eiq "$timeout" "$log" &&
       ! grep -Eq 'Test Case .* failed|Test .* failed after|XCTAssert.*failed|Executed .* with [1-9][0-9]* failure' "$log" &&
       ! grep -Ei "error:" "$log" | grep -Eiv "$timeout" >/dev/null; then
      echo UNAVAILABLE; return
    fi;;
  esac
  echo FAIL
}
