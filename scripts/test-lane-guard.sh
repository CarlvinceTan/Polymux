#!/bin/bash
set -eu
SRC=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export LANES_HOME="$T/ops" LANE_GUARD_STATE="$T/state" LANE_GUARD_EVENTS="$T/events" LANES_REPO="$T/repo" LANE_GATE=true
mkdir -p "$LANES_REPO/scripts" "$LANES_REPO/agents" "$LANES_HOME/queue"
cp "$SRC/scripts/dispatch-guard.sh" "$SRC/scripts/queue-write.sh" "$SRC/scripts/lanelib.sh" "$SRC/scripts/hold-release.py" "$SRC/scripts/lanes.py" "$LANES_REPO/scripts/"
printf 'mac_hosts = []\n[laneA]\nagent = "codex"\ncmd = "true"\n' > "$LANES_REPO/agents/lanes.toml"
for kind in dep spec scope; do
  bash "$SRC/scripts/lane-guard.sh" --task-end laneA "$kind" 1 /dev/null "$kind"
done
[ ! -f "$LANES_HOME/PAUSE" ]; [ ! -s "$LANE_GUARD_STATE/tasks.tsv" ]
echo 'ok   dependency/spec/scope stops excluded from guard ledger'
PASS=1
mkdir -p "$T/supersede-bin"
cat > "$T/supersede-bin/gh" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$GH_CALLS"
printf '%s\n' "$GH_RESULT"
SH
cat > "$T/runner" <<'SH'
#!/bin/bash
cat "$2" > "$SEEN"
printf '%s\t987-held-task\trunning\t%s\t%s\n' "$(date '+%F %T')" "$1" "$2" >> "$LANES_HOME/events.tsv"
SH
sed '/^export PATH=/d' "$SRC/scripts/lane-guard.sh" > "$T/supersede-guard"
chmod +x "$T/runner" "$T/supersede-guard" "$T/supersede-bin/gh"
for kind in older equal newer plain other releasable reset multiple; do
  export LANES_HOME="$T/$kind/ops" LANE_GUARD_STATE="$T/$kind/state" SEEN="$T/$kind/seen" GH_CALLS="$T/$kind/gh" GH_RESULT=OPEN
  mkdir -p "$LANES_HOME/queue" "$LANES_HOME/queue-hold"
  : > "$LANES_HOME/events.tsv"
  queued=$LANES_HOME/queue/new.task; held=$LANES_HOME/queue-hold/held.task
  title='# Held task (attempt 3)'; old='# Held task (attempt 2)'; stamp=1
  case $kind in equal) stamp=100;; newer) stamp=200;; plain) old='# Held task';; other) old='# Other task (attempt 2)';; reset) title='# Held task';; esac
  printf '%s\nneeds: none\nexpected_min: 5\nbranch: test/new\n' "$title" > "$queued"
  printf '%s\nneeds: none\nexpected_min: 5\nbranch: test/old\n' "$old" > "$held"
  if [ "$kind" = releasable ]; then printf 'release: after:pr:255 merged\n' >> "$held"; export GH_RESULT=MERGED; fi
  cp "$held" "$T/held.expected"
  python3 -c 'import os,sys; os.utime(sys.argv[1], (100,100)); os.utime(sys.argv[2], (int(sys.argv[3]),int(sys.argv[3])))' "$queued" "$held" "$stamp"
  [ "$kind" != multiple ] || cp -p "$held" "$LANES_HOME/queue-hold/second.task"
  OUT=$(PATH="$T/supersede-bin:$PATH" RUN_LANE="$T/runner" bash "$T/supersede-guard" --dispatch laneA)
  case $kind in
    equal|newer|plain) [ -f "$held" ]; [ -f "$queued" ]; [ ! -f "$SEEN" ];;
    *) [ -f "$LANES_HOME/queue/started/new.task" ]; grep -qx 'branch: test/new' "$SEEN"
      if [ "$kind" = other ]; then [ -f "$held" ]
      else
        [ ! -f "$held" ]; set -- "$LANES_HOME"/queue-hold/superseded/*/held.task
        [ "$#" = 1 ]; cmp "$T/held.expected" "$1"
        grep -q 'superseded held held.task with queued new.task' <<< "$OUT"
        grep -q $'held\tsuperseded\tnew\t' "$LANES_HOME/events.tsv"
      fi;;
  esac
  [ "$kind" != releasable ] || [ ! -s "$GH_CALLS" ]
  if [ "$kind" = multiple ]; then
    [ ! -f "$LANES_HOME/queue-hold/second.task" ]; set -- "$LANES_HOME"/queue-hold/superseded/*/second.task
    [ "$#" = 1 ]; cmp "$T/held.expected" "$1"
  fi
  PASS=$((PASS+1))
done
echo 'ok   newer queued attempts archive older held retries before release scanning, preserving bytes and other holds'
for kind in equal newer queued; do
  export LANES_HOME="$T/atomic-$kind/ops"
  mkdir -p "$LANES_HOME/queue" "$LANES_HOME/queue-hold" "$LANES_HOME/queue.lock.d"
  queued=$LANES_HOME/queue/new.task; held=$LANES_HOME/queue-hold/held.task
  printf '# Atomic task (attempt 3)\nneeds: none\nexpected_min: 5\n' > "$queued"
  printf '# Atomic task (attempt 2)\nneeds: none\nexpected_min: 5\n' > "$held"
  python3 -c 'import os,sys; os.utime(sys.argv[1], (100,100)); os.utime(sys.argv[2], (1,1))' "$queued" "$held"
  echo $$ > "$LANES_HOME/queue.lock.d/pid"
  QUEUE_LOCK_MKDIR=1 QUEUE_LOCK_WAIT=3 bash "$LANES_REPO/scripts/queue-write.sh" --supersede "$queued" "$held" > "$T/archive" & writer=$!
  sleep 0.2
  kill -0 "$writer"
  if [ "$kind" = queued ]; then
    printf '# Different task (attempt 3)\nneeds: none\nexpected_min: 5\n' > "$T/replacement"
    QUEUE_LOCK_HELD=1 bash "$LANES_REPO/scripts/queue-write.sh" --force --name new.task "$T/replacement" >/dev/null
  else
    printf '# Atomic task (attempt 2)\nneeds: none\nexpected_min: 5\nrelease: after:pr:255 merged alert-only\nReplacement held brief\n' > "$T/replacement"
    QUEUE_LOCK_HELD=1 bash "$LANES_REPO/scripts/queue-write.sh" --force --dir "$LANES_HOME/queue-hold" --name held.task "$T/replacement" >/dev/null
    stamp=100; [ "$kind" != newer ] || stamp=200
    python3 -c 'import os,sys; n=int(sys.argv[2]); os.utime(sys.argv[1], (n,n))' "$held" "$stamp"
  fi
  rm -rf "$LANES_HOME/queue.lock.d"
  wait "$writer"
  [ -f "$queued" ]; [ -f "$held" ]; [ ! -s "$T/archive" ]
  if [ "$kind" = queued ]; then cmp "$T/replacement" "$queued"; else cmp "$T/replacement" "$held"; fi
  PASS=$((PASS+1))
done
echo 'ok   conditional archival rechecks replaced queued and equal/newer held briefs under the queue lock'
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
