#!/bin/bash
# Hermetic publication checks: local Git origin, stub verifier and GitHub, scratch HOME.
set -uo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
git init -q --bare "$T/origin.git"; git init -q -b main "$T/repo"
cd "$T/repo" || exit 1
git config user.name "Lane Test"; git config user.email lane@test.invalid
mkdir scripts agents
cp "$SRC"/scripts/{run-lane,verify,lanelib,dispatch-guard,cleanup,wt-setup,board-update,queue-write}.sh "$SRC"/scripts/{hold-release,media-check,lanes}.py scripts/
printf '[laneA]\nagent = "codex"\ncmd = "true"\n' > agents/lanes.toml
printf '.build/\n' > .gitignore
git add -A; git commit -qm base; git remote add origin "$T/origin.git"; git push -q origin main
export HOME="$T/home" LANES_HOME="$T/ops" LANES_WT="$T/wt" LANE_SKIP_SETUP=1 LANE_NO_CHAIN=1
export LANE_STAGGER=0 LANE_POLL=1 LANE_RETRY_SLEEP=0 LANE_BREAKER_N=99 LANE_CHAIN_MIN_S=0 GIT_OPTIONAL_LOCKS=0
mkdir -p "$HOME" "$LANES_HOME" "$LANES_WT" "$T/bin"
cat > "$T/bin/gh" <<'SH'
#!/bin/bash
printf '%s %s\n' "$1" "$2" >> "$CALLS"
case "$1 $2" in
  'pr list') [ "$MODE" != list ] || exit 1; case "$MODE" in mutation) git commit -q --allow-empty -m Later;; esac
    case "$MODE" in open|comment|draft|mutation) echo https://github.com/o/r/pull/55;; esac;;
  'pr create') printf '%s\n' "$@" > "$CAPTURE_BODY"; [ "$MODE" != create ] || exit 1; echo https://github.com/o/r/pull/100;;
  'pr comment') printf '%s\n' "$@" > "$CAPTURE_BODY"; [ "$MODE" != comment ] || exit 1;;
  'pr ready') [ "$MODE" != draft ] || exit 1;;
esac
exit 0
SH
cat > "$T/guard" <<'SH'
#!/bin/bash
[ "$1" != --task-end ] || printf '%s\n' "$4" >> "$ENDS"
exit 0
SH
chmod +x "$T/bin/gh" "$T/guard"
export PATH="$T/bin:$PATH" LANE_GUARD="$T/guard"
VC='mkdir -p .build/proof; printf "## verify.sh: PASS\n" > .build/proof/summary.md; echo unit-test-verified > .build/proof/level; git rev-parse HEAD > .build/proof/head'
CHANGE='echo change > changed; git add changed; git commit -qm Change'
PASS=0; FAILS=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "ok   $1"; else FAILS=$((FAILS+1)); echo "FAIL $1"; fi; }
run() {
  NAME=$1; BRANCH=test/$NAME; export MODE=${2:-ok} CALLS="$T/$NAME.calls" CAPTURE_BODY="$T/$NAME.body" ENDS="$T/$NAME.ends"
  printf '# Publish %s\nneeds: none\nexpected_min: 5\nissue: 280\n' "$NAME" > "$T/$NAME.task"
  OUT=$(LANE_VERIFY_CMD="${4:-$VC}" LANE_STUB_CMD="$3" bash scripts/run-lane.sh laneA "$T/$NAME.task" --branch "$BRANCH" 2>&1); RC=$?
  WT=$LANES_WT/laneA-publish-$NAME
}
git checkout -q -b test/resume main; eval "$CHANGE"; RESUMED=$(git rev-parse HEAD); git checkout -q main
run resume ok true
check 'existing unpushed commit is verified and published without a dummy commit' '[ "$RC" = 0 ] && [ "$(git ls-remote origin refs/heads/test/resume | cut -f1)" = "$RESUMED" ] && [ "$(cat "$WT/.build/proof/head")" = "$RESUMED" ] && [ "$(git rev-parse --abbrev-ref "test/resume@{upstream}")" = origin/test/resume ] && [ "$(cat "$ENDS")" = 0 ] && grep -qx "Closes #280" "$CAPTURE_BODY" && tail -3 "$CAPTURE_BODY" | grep -qx "Release Notes:"'
git branch test/reverify test/resume; git push -q origin test/reverify
run reverify open true
check 'an existing published PR is reverified and updated without a new commit' '[ "$RC" = 0 ] && [ "$(cat "$WT/.build/proof/head")" = "$RESUMED" ] && [ "$(cat "$ENDS")" = 0 ] && grep -qx "pr comment" "$CALLS" && ! grep -qx "pr create" "$CALLS"'
run mutation mutation "$CHANGE"
VERIFIED=$(cat "$WT/.build/proof/head")
check 'comments and result records stay bound to the pushed SHA after a later HEAD change' '[ "$RC" = 0 ] && [ "$(git -C "$WT" rev-parse HEAD)" != "$VERIFIED" ] && [ "$(git ls-remote origin refs/heads/test/mutation | cut -f1)" = "$VERIFIED" ] && grep -q "new head $VERIFIED" "$CAPTURE_BODY" && grep -q "publish-mutation.*$VERIFIED" "$LANES_HOME/results.tsv"'
run alias ok 'git checkout -q -b test/agent-alias; echo change > changed; git add changed; git commit -qm Change'
check 'publication pushes the verified HEAD when the agent chose another local branch' '[ "$RC" = 0 ] && [ "$(git ls-remote origin refs/heads/test/alias | cut -f1)" = "$(cat "$WT/.build/proof/head")" ] && [ "$(git rev-parse test/alias)" != "$(cat "$WT/.build/proof/head")" ]'
run empty ok true
check 'a branch with no changes still fails before verification or publication' '[ "$RC" != 0 ] && [ ! -f "$WT/.build/proof/head" ] && [ ! -f "$CALLS" ] && grep -q "no changes from origin/main" "$LANES_HOME/events.tsv"'
cat > "$T/origin.git/hooks/pre-receive" <<'SH'
#!/bin/bash
while read -r old new ref; do [ "$ref" != refs/heads/test/push ] || { echo 'fixture rejected push' >&2; exit 1; }; done
SH
chmod +x "$T/origin.git/hooks/pre-receive"
run push ok "$CHANGE"
check 'push rejection records failure and never records a successful task end or result' '[ "$RC" != 0 ] && [ "$(cat "$ENDS")" = 1 ] && [ ! -f "$CALLS" ] && ! grep -q "publish-push.*https://" "$LANES_HOME/results.tsv" 2>/dev/null && grep -q "push failed (test/push at" "$LANES_HOME/events.tsv"'
rm "$T/origin.git/hooks/pre-receive"
for mode in list create comment; do
  run "$mode" "$mode" "$CHANGE"
  check "$mode failure after verify leaves the branch pushed and marks the attempt failed" '[ "$RC" != 0 ] && [ "$(cat "$ENDS")" = 1 ] && [ "$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)" = "$(cat "$WT/.build/proof/head")" ] && ! grep -q "publish-$NAME.*https://" "$LANES_HOME/results.tsv" 2>/dev/null && grep -q "publish-$NAME.*failed.*$mode.*failed" "$LANES_HOME/events.tsv"'
done
run draft draft "$CHANGE" "$VC; echo build-only > .build/proof/level"
check 'failure to restore draft state is a failed publication' '[ "$RC" != 0 ] && [ "$(cat "$ENDS")" = 1 ] && grep -qx "pr ready" "$CALLS" && grep -q "publish-draft.*failed.*could not mark existing PR" "$LANES_HOME/events.tsv"'
run moved ok "$CHANGE" "$VC; git commit -q --allow-empty -m Moved"
check 'a verifier that changes HEAD cannot publish a different commit as verified' '[ "$RC" != 0 ] && [ "$(cat "$ENDS")" = 1 ] && [ ! -f "$CALLS" ] && [ -z "$(git ls-remote origin refs/heads/test/moved)" ] && grep -q "source changed during verification" "$LANES_HOME/events.tsv"'
run dirty ok "$CHANGE; echo dirty >> changed"
check 'uncommitted source cannot be published as a verified commit' '[ "$RC" != 0 ] && [ "$(cat "$ENDS")" = 1 ] && [ ! -f "$CALLS" ] && [ -z "$(git ls-remote origin refs/heads/test/dirty)" ]'
echo "test-publish: $PASS passed, $FAILS failed"
[ "$FAILS" = 0 ]
