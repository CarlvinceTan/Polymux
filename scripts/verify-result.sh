#!/bin/bash
verify_result() {
  local name=$1 rc=$2 log=$3
  if [ "$rc" = 0 ]; then echo PASS; return; fi
  case "$name" in macos-test|ios-test|ios-ready)
    if grep -Eiq 'Timed out while enabling automation mode|test runner.*(timed out|timeout)|timed out.*(test runner|UI testing)' "$log" &&
       ! grep -Eq 'Test Case .* failed|Test .* failed after|XCTAssert.*failed|error:|Executed .* with [1-9][0-9]* failure' "$log"; then
      echo UNAVAILABLE; return
    fi;;
  esac
  echo FAIL
}
