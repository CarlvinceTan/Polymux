#!/bin/bash
# Test-integrity + behaviour-needs-test checks on BASE...HEAD (default origin/dev).
# Overrides (printed when used): "Test-integrity: <reason>" / "No-test-reason: <reason>"
# in a commit message in the range or in $PR_BODY.
BASE=${1:-${TI_BASE:-origin/dev}}; R="$BASE...HEAD"; FAIL=0
MSGS="$(git log --format=%B "${R/.../..}" 2>/dev/null)"$'\n'"${PR_BODY:-}"
reason() { printf '%s\n' "$MSGS" | grep -m1 -E "^$1: *[^ ]" | sed "s/^$1: *//"; }
TESTRE='(^|/)(Tests|UITests)/|Tests?\.swift$'
FILES=(); while IFS= read -r l; do FILES+=("$l"); done < <(git diff --name-status "$R" -- '*.swift')
bad=(); add() { bad+=("$1"); }
for row in "${FILES[@]}"; do
  st=${row%%$'\t'*}; f=${row##*$'\t'}
  [[ $f =~ $TESTRE ]] || continue
  [[ $st == D* ]] && { add "deleted test file: $f"; continue; }
  d=$(git diff -U0 "$R" -- "$f")
  plus=$(grep -E '^\+[^+]' <<<"$d"); minus=$(grep -E '^-[^-]' <<<"$d")
  grep -qE 'XCTSkip|\.disabled\b|@available\(\*, *unavailable\)' <<<"$plus" && add "skip/disable added: $f"
  rm_fn=$(grep -oE 'func test[A-Za-z0-9_]+|@Test[^\n]*func [A-Za-z0-9_]+' <<<"$minus" | awk '{print $NF}' | sort -u)
  ad_fn=$(grep -oE 'func test[A-Za-z0-9_]+|@Test[^\n]*func [A-Za-z0-9_]+' <<<"$plus" | awk '{print $NF}' | sort -u)
  gone=$(comm -23 <(echo "$rm_fn") <(echo "$ad_fn") | grep .) && add "deleted test function(s) in $f: $(echo $gone)"
  w() { awk '{n=0} /XCTAssertEqual|XCTAssertIdentical|XCTAssertThrows|XCTAssertNotEqual|XCTAssertLessThan|XCTAssertGreaterThan|#expect\(.*==|#require/{n=2}
    n==0 && /XCTAssertTrue|XCTAssertFalse|XCTAssert\(|#expect\(/{n=1} {s+=n} END{print s+0}'; }
  [ "$(w <<<"$minus")" -gt "$(w <<<"$plus")" ] && add "assertions removed or weakened in $f"
  oa=$(grep -oE 'accuracy: *[0-9.e-]+' <<<"$minus" | grep -oE '[0-9.e-]+$' | sort -g | tail -1)
  na=$(grep -oE 'accuracy: *[0-9.e-]+' <<<"$plus" | grep -oE '[0-9.e-]+$' | sort -g | tail -1)
  [ -n "$oa" ] && [ -n "$na" ] && awk -v a="$na" -v b="$oa" 'BEGIN{exit !(a>b)}' && add "accuracy widened $oa -> $na in $f"
  grep -qE 'contentsOf: *[^)]*(\.swift|Sources)|#filePath.*Sources|"/usr/bin/grep"|"grep"|\.swift"\)' <<<"$plus" && \
    add "test reads/greps source code instead of exercising behaviour: $f"
done
if [ ${#bad[@]} -gt 0 ]; then
  printf 'test-integrity: %s\n' "${bad[@]}"
  r=$(reason Test-integrity); if [ -n "$r" ]; then echo "test-integrity OVERRIDE: $r"; else FAIL=1; fi
fi
src=0; tst=0
for row in "${FILES[@]}"; do f=${row##*$'\t'}
  if [[ $f =~ $TESTRE ]]; then tst=1; elif [[ $f == *Sources/* ]]; then src=1; fi; done
if [ $src = 1 ] && [ $tst = 0 ]; then
  r=$(reason No-test-reason)
  if [ -n "$r" ]; then echo "behaviour-test rule OVERRIDE (No-test-reason): $r"
  else echo "test-integrity: Swift under Sources/ changed with no Tests/ or UITests/ change (add a test or No-test-reason:)"; FAIL=1; fi
fi
[ $FAIL = 0 ] && echo "test-integrity: OK ($R, ${#FILES[@]} swift files)"; exit $FAIL
