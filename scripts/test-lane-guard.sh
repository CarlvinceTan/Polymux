#!/bin/bash
set -eu
SRC=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export LANES_HOME="$T/ops" LANE_GUARD_STATE="$T/state" LANE_GUARD_EVENTS="$T/events" LANES_REPO="$T/repo" LANE_GATE=true
mkdir -p "$LANES_REPO/scripts" "$LANES_REPO/agents" "$LANES_HOME/queue"
cp "$SRC/scripts/dispatch-guard.sh" "$SRC/scripts/lanes.py" "$LANES_REPO/scripts/"
printf 'mac_hosts = []\n[laneA]\nagent = "codex"\ncmd = "true"\n' > "$LANES_REPO/agents/lanes.toml"
for kind in dep spec scope; do
  bash "$SRC/scripts/lane-guard.sh" --task-end laneA "$kind" 1 /dev/null "$kind"
done
[ ! -f "$LANES_HOME/PAUSE" ]; [ ! -s "$LANE_GUARD_STATE/tasks.tsv" ]
echo 'ok   dependency/spec/scope stops excluded from guard ledger'
mkdir -p "$T/bin"
cat > "$T/bin/gh" <<'SH'
#!/bin/bash
printf '%s\n' "$PR_RESULT"
exit "${PR_EXIT:-0}"
SH
cat > "$T/bin/git" <<'SH'
#!/bin/bash
if [ "$3" = merge-base ]; then
  echo ancestry >> "$ANCESTRY_LOG"
  exit "$ANCESTRY_EXIT"
fi
exit 0
SH
chmod +x "$T/bin/gh" "$T/bin/git"
export PATH="$T/bin:$PATH" ANCESTRY_LOG="$T/ancestry"
# Keep dependency checks hermetic despite the guard's production PATH reset.
sed '/^export PATH=/d' "$SRC/scripts/lane-guard.sh" > "$T/guard.sh"
printf 'after: branch-on-main:topic\n' > "$T/dependency.task"
PASS=1
for PR_RESULT in '' none ERROR 0 'authentication required' '{"number":285}' 285; do
  for ANCESTRY_EXIT in 0 1; do
    export PR_RESULT ANCESTRY_EXIT
    : > "$ANCESTRY_LOG"
    OUT=$(bash "$T/guard.sh" --deps "$T/dependency.task")
    EXPECT=UNMET
    if [ "$PR_RESULT" = 285 ]; then
      EXPECT=MET
      [ ! -s "$ANCESTRY_LOG" ]
    else
      [ -s "$ANCESTRY_LOG" ]
      [ "$ANCESTRY_EXIT" = 0 ] && EXPECT=MET
    fi
    [[ "$OUT" = "$EXPECT "* ]]
    PASS=$((PASS+1))
  done
done
export PR_RESULT=285 PR_EXIT=1 ANCESTRY_EXIT=1
: > "$ANCESTRY_LOG"
OUT=$(bash "$T/guard.sh" --deps "$T/dependency.task")
[[ "$OUT" = 'UNMET '* ]]; [ -s "$ANCESTRY_LOG" ]
PASS=$((PASS+1))
echo 'ok   merged-PR lookup accepts only numbers and falls back to ancestry'
python3 "$SRC/scripts/test-hold-release.py"
echo "test-lane-guard: $PASS passed, 0 failed"
