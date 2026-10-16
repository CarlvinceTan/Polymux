#!/bin/bash
set -eu
SRC=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export LANES_HOME="$T/ops" LANE_GUARD_STATE="$T/state" LANE_GUARD_EVENTS="$T/events" LANES_REPO="$T/repo" LANE_GATE=true
mkdir -p "$LANES_REPO/scripts" "$LANES_REPO/agents" "$LANES_HOME/queue"
cp "$SRC/scripts/dispatch-guard.sh" "$SRC/scripts/lanelib.sh" "$SRC/scripts/lanes.py" "$LANES_REPO/scripts/"
printf 'mac_hosts = []\n[laneA]\nagent = "codex"\ncmd = "true"\n' > "$LANES_REPO/agents/lanes.toml"
for kind in dep spec scope; do
  bash "$SRC/scripts/lane-guard.sh" --task-end laneA "$kind" 1 /dev/null "$kind"
done
[ ! -f "$LANES_HOME/PAUSE" ]; [ ! -s "$LANE_GUARD_STATE/tasks.tsv" ]
echo 'ok   dependency/spec/scope stops excluded from guard ledger'
PASS=1
cat > "$T/runner" <<'SH'
#!/bin/bash
printf '%s\t987-fresh-pass\trunning\t%s\t%s\n' "$(date '+%F %T')" "$1" "$2" >> "$LANES_HOME/events.tsv"
SH
chmod +x "$T/runner"
for kind in old-event old-ledger same-event same-ledger new-event new-ledger; do
  export LANES_HOME="$T/$kind/ops" LANE_GUARD_STATE="$T/$kind/state"
  mkdir -p "$LANES_HOME/queue" "$LANE_GUARD_STATE"
  touch "$LANES_HOME/events.tsv"
  brief=$LANES_HOME/queue/fresh.task
  printf '# Fresh pass\nneeds: none\nexpected_min: 5\n' > "$brief"
  now=$(date +%s); stamp=$now; filetime=$now
  case $kind in old-*) stamp=$((now-10));; new-*) filetime=1;; esac
  python3 -c 'import os,sys; os.utime(sys.argv[1], (int(sys.argv[2]), int(sys.argv[2])))' "$brief" "$filetime"
  case $kind in
    *-event) python3 -c 'import datetime,sys; stamp=datetime.datetime.fromtimestamp(int(sys.argv[1])).strftime("%Y-%m-%d %H:%M:%S"); print("\n".join(stamp + "\t123-fresh-pass\t" + event + "\tlaneA\tpassed" for event in ("running", "dry")))' "$stamp" > "$LANES_HOME/events.tsv";;
    *-ledger) printf '%s\tlaneA\t123-fresh-pass\t0\tok\t/dev/null\t# Fresh pass\n' "$stamp" > "$LANE_GUARD_STATE/tasks.tsv";;
  esac
  OUT=$(RUN_LANE="$T/runner" bash "$SRC/scripts/lane-guard.sh" --dispatch laneA)
  case $kind in
    new-*) [ -f "$LANES_HOME/queue/dropped/fresh.task" ]; [[ "$OUT" = *'passed'* ]];;
    *) [ -f "$LANES_HOME/queue/started/fresh.task" ]; [[ "$OUT" = *'dispatch: started fresh on laneA'* ]];;
  esac
  PASS=$((PASS+1))
done
echo 'ok   older or simultaneous passes allow new briefs; newer passes still drop duplicates'
export LANES_HOME="$T/ops" LANE_GUARD_STATE="$T/state"
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
