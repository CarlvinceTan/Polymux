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

git init -q -b dev "$T/repo"
git -C "$T/repo" config user.name Test
git -C "$T/repo" config user.email test@example.invalid
git -C "$T/repo" commit -qm Base --allow-empty
check "dev accepts commits" '(cd "$T/repo" && "$ROOT/.githooks/pre-commit")'
git -C "$T/repo" checkout -q --detach
check "detached worktrees accept commits" '(cd "$T/repo" && "$ROOT/.githooks/pre-commit")'
git -C "$T/repo" checkout -qb topic
check "other named branches reject commits" '! (cd "$T/repo" && "$ROOT/.githooks/pre-commit")'

zero=0000000000000000000000000000000000000000
one=1111111111111111111111111111111111111111
check "dev accepts pushes" 'printf "refs/heads/dev %s refs/heads/dev %s\n" "$one" "$zero" | "$ROOT/.githooks/pre-push"'
check "main rejects direct pushes" '! printf "refs/heads/dev %s refs/heads/main %s\n" "$one" "$zero" | "$ROOT/.githooks/pre-push"'
check "other branches reject pushes" '! printf "refs/heads/dev %s refs/heads/topic %s\n" "$one" "$zero" | "$ROOT/.githooks/pre-push"'
check "obsolete branches can be deleted" 'printf "(delete) %s refs/heads/topic %s\n" "$zero" "$one" | "$ROOT/.githooks/pre-push"'
check "permanent branches cannot be deleted" '! printf "(delete) %s refs/heads/dev %s\n" "$zero" "$one" | "$ROOT/.githooks/pre-push"'

check "CMS writes directly to dev" 'grep -q "^  branch: dev$" "$ROOT/apps/site/public/admin/config.yml" && ! grep -q "editorial_workflow" "$ROOT/apps/site/public/admin/config.yml"'
check "pull requests are dev to main only" 'grep -q "HEAD.*!= dev" "$ROOT/.github/workflows/branch-topology.yml" && grep -q "BASE.*!= main" "$ROOT/.github/workflows/branch-topology.yml"'
check "release notes run only for promotion" 'grep -q "branches: \[main\]" "$ROOT/.github/workflows/pull-request-release-notes.yml"'
check "proof branches have no publisher" '[ ! -e "$ROOT/scripts/run-lane.sh" ] && ! grep -R -E "git (push|checkout).*proof-media" "$ROOT/scripts" >/dev/null'

echo "test-branch-policy: $PASS passed, $FAILS failed"
[ $FAILS = 0 ]
