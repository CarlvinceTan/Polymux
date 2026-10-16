#!/bin/bash
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
. "$ROOT/scripts/verify/support.sh"
PASS=0
FAILS=0
check() {
  if eval "$2"; then PASS=$((PASS+1)); echo "ok   $1"
  else FAILS=$((FAILS+1)); echo "FAIL $1"
  fi
}

LOCK="$T/live.lock"
lock_take "$LOCK"
check "a live lock cannot be taken" '! bash -c '\''. "$1"; lock_take "$2"'\'' _ "$ROOT/scripts/lib/locks.sh" "$LOCK"'
lock_drop "$LOCK"
check "the holder can drop its lock" '[ ! -d "$LOCK" ]'

RACE_BAD=0
for round in $(seq 1 15); do
  LOCK="$T/race.lock"
  rm -rf "$LOCK" "$LOCK.reclaim" "$T"/winner.*
  mkdir "$LOCK"
  echo 999999 > "$LOCK/pid"
  for racer in 1 2 3 4; do
    bash -c '. "$1"; lock_take "$2" && echo win' _ "$ROOT/scripts/lib/locks.sh" "$LOCK" > "$T/winner.$racer" &
  done
  wait
  [ "$(cat "$T"/winner.* | grep -c win)" = 1 ] || RACE_BAD=$((RACE_BAD+1))
done
check "one process wins each stale-lock race" '[ $RACE_BAD = 0 ]'

LOCK="$T/empty.lock"
mkdir "$LOCK"
check "an empty lock observes its grace period" '! lock_take "$LOCK"'
touch -t 202001010000 "$LOCK"
check "an old empty lock is reclaimed" 'lock_take "$LOCK" && [ -s "$LOCK/pid" ]'
check "portable lock age is numeric" '[ "$(_age "$LOCK")" -ge 0 ] 2>/dev/null'

git init -q -b main "$T/repo"
cd "$T/repo"
git config user.name Test
git config user.email test@example.invalid
echo base > README
git add -A
git commit -qm base
git switch -qc scope-test
mkdir -p apps/x/y docs
echo swift > apps/x/y/z.swift
echo docs > docs/n.md
echo top > TOP.md
git add -A
git rm -q README
git commit -qm scope
scope() { scope_check main "$1" 2>&1; }
check "scope accepts nested and deleted matching files" 'scope "apps/**,*.md,README" >/dev/null'
check "scope reports a deleted file outside scope" '! scope "apps/**,*.md" >/dev/null && grep -q "outside scope: README" <<< "$(scope "apps/**,*.md" || true)"'
check "scope globs match nested paths without shell expansion" '! scope "apps/**,*.md,README" | grep -q docs/n.md'

echo "test-support: $PASS passed, $FAILS failed"
[ $FAILS = 0 ]
