#!/bin/bash
# run-lane.sh <lane> "<task>"|<task-file> [--branch B] [--base origin/main]
# run-lane.sh --verify-only <branch>     (Mac proof for cloud-agent PRs)
# Worktree -> headless agent -> our own verify.sh -> push + PR with proof.
# On a first failure the brief is re-queued for lane-guard to place on a free lane; a failed
# attempt 2+ writes ~/ops/lanes/failures.tsv + NEEDS_CODY. No daemon, no DB.
# One writer per branch: $OPS/branches/<branch>.lock (plus the unit lock). Lane commits carry
# a "Lane: <lane>/<agent>" trailer so one writer per branch can be audited from history.
set -uo pipefail
SD=$(cd "$(dirname "$0")" && pwd); REPO=$(git -C "$SD/.." rev-parse --show-toplevel); . "$SD/lanelib.sh"
OPS=${LANES_HOME:-$HOME/ops/lanes}; WTR=${LANES_WT:-$HOME/code/wt}; mkdir -p "$OPS/logs"; EV="$OPS/events.tsv"
SLUG_REPO=$(repo_slug "$REPO"); HOST=$(hostname -s)
ev() { printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$ID" "$1" "${2:-}" "${3:-}" >> "$EV"; }
cfg() { python3 "$SD/lanes.py" "$@"; }
BU() { bash "$SD/board-update.sh" "$@" >> "${LOG:-$OPS/logs/$ID-board.log}" 2>&1 || true; }   # board; errors -> board_error event + lane log
started() { [ -n "$STARTED" ] && return; { [ -n "$(git -C "$WT" log --oneline "$BASE"..HEAD 2>/dev/null)" ] || [ -n "$(git -C "$WT" status --porcelain 2>/dev/null)" ]; } && { STARTED=1; BU start "$SLUG"; }; }  # first real output
publish_proof() {  # $1 worktree, $2 task id -> markdown; media goes to its own branch proof-media/<id>
  local wt=$1 id=$2 idx c err ref="proof-media/$2-$(date +%Y%m%d%H%M%S)-$$" n=0; idx=$(mktemp)   # unique per run; never force
  for f in "$wt"/.build/proof/*.png "$wt"/.build/proof/*.mp4; do [ -f "$f" ] && n=$((n+1)); done
  [ $n = 0 ] && { echo "_no media captured_"; return; }
  err=$( cd "$wt" && export GIT_INDEX_FILE=$idx && git read-tree --empty &&
    for f in .build/proof/*.png .build/proof/*.mp4; do [ -f "$f" ] || continue
      git update-index --add --cacheinfo "100644,$(git hash-object -w "$f"),$(basename "$f")" || exit 1; done &&
    c=$(git commit-tree "$(git write-tree)" -m "proof $id") &&
    git push -q origin "$c:refs/heads/$ref" 2>&1 ); local rc=$?; rm -f "$idx"
  [ $rc = 0 ] && (cd "$wt/.build/proof" && ls *.png *.mp4 2>/dev/null) > "$wt/.build/proof/uploaded"   # board appends only these
  if [ $rc -ne 0 ]; then echo "proof push failed ($ref): $err" >&2
    echo "_media upload to \`$ref\` failed: $(echo "$err" | tail -1 | cut -c1-200)_"; return; fi
  local u="https://github.com/$SLUG_REPO/raw/$ref"; echo "$u" > "$wt/.build/proof/url-base"   # for approve-proof.sh
  for f in "$wt"/.build/proof/*.png; do [ -f "$f" ] && echo "![$(basename "$f")]($u/$(basename "$f"))"; done
  [ -f "$wt/.build/proof/ios.mp4" ] && echo "[iOS video]($u/ios.mp4)"
}
if [ "${1:-}" = "--verify-only" ]; then
  BR=$2; ID="verify-${BR//\//-}"; WT="$WTR/$ID"; BL=$(branch_lock_dir "$BR")
  lock_take "$BL" || { echo "branch '$BR' already has a writer (pid $(lock_holder "$BL")); not verifying"; exit 3; }
  trap 'lock_drop "$BL"' EXIT; ev running verify "$BR"
  git -C "$REPO" fetch -q origin "$BR" || { echo "git fetch origin $BR failed"; ev failed verify "fetch failed"; exit 1; }
  SHA=$(git -C "$REPO" rev-parse FETCH_HEAD)   # FETCH_HEAD is per-worktree: resolve it here
  [ -d "$WT" ] || git -C "$REPO" worktree add -q --detach "$WT" "$SHA" || { ev failed verify "worktree add failed"; exit 1; }
  git -C "$WT" checkout -q --detach "$SHA" || { ev failed verify "checkout failed"; exit 1; }
  (cd "$WT" && { [ -n "${LANE_SKIP_SETUP:-}" ] || bash "$SD/wt-setup.sh"; } && \
    if [ -n "${LANE_VERIFY_CMD:-}" ]; then bash -c "$LANE_VERIFY_CMD"; else bash "$SD/verify.sh"; fi) > "$OPS/logs/$ID.log" 2>&1; rc=$?   # LANE_VERIFY_CMD: test hook
  BODY="$(cat "$WT/.build/proof/summary.md")"$'\n\n'"$(publish_proof "$WT" "$ID" 2>>"$OPS/logs/$ID.log")"
  gh pr comment "$BR" -R "$SLUG_REPO" --body "Mac proof ($HOST):"$'\n'"$BODY" && ev pr verify "$BR"
  [ $rc = 0 ] || ev failed verify "$BR"; exit $rc
fi
LANE=$1; TASK=$2; UNIT=$2; shift 2; BASE=origin/main; BRANCH=""; NEEDS=none; EXP=60; SCOPE=""
TASKF=""; if [ -f "$TASK" ]; then TASKF=$TASK  # task file: "card:" (Notion card), "needs:", "expected_min:", "scope: a/**,b/*" (allowed files); rest is the brief
  NEEDS=$(sed -n 's/^needs: *//p' "$TASK" | head -1); EXP=$(sed -n 's/^expected_min: *//p' "$TASK" | head -1)
  SCOPE=$(sed -n 's/^scope: *//p' "$TASK" | head -1)
  TASK=$(grep -vE '^(unit|needs|scope|expected_min|card|branch|after):' "$TASK"); EXP=${EXP:-60}   # branch:/after: are headers too (a branch: above the title used to become the title)
fi
QW() { bash "$SD/queue-write.sh" "$@"; }   # every queue/queue-hold write goes through the locked helper
TARGET=${LANE_TARGET:-$HOST}   # dispatcher Xcode guard: refuse before any claim/worktree
bash "$SD/dispatch-guard.sh" "$UNIT" "$TARGET" || exit 4
while [ $# -gt 0 ]; do case $1 in --branch) BRANCH=$2; shift 2;; --base) BASE=$2; shift 2;; *) shift;; esac; done
TITLE=$(echo "$TASK" | head -1); SLUG=$(echo "$TITLE" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-*//' | cut -c1-32 | sed 's/-*$//')   # '# SA1: x' -> sa1-x (no leading '-')
ID="$(date +%m%d%H%M)-$SLUG"; BRANCH=${BRANCH:-agent/$SLUG}
prompt() { echo "Task: $TASK
Rules: work only in this worktree. Keep the change small and scoped.${SCOPE:+ Only touch files matching: $SCOPE.} Build and test ONLY via
'bash "$SD/verify.sh"' and iterate until it exits 0 (never run it in the background). Commit your work with a clear message
ending in the trailer line 'Lane: $1/$(cfg lane "$1" agent)'.
Do not push and do not open a PR. Never skip, delete or weaken tests; a behaviour change
needs a test change (or a 'No-test-reason: ...' line in the commit). Size cap: ${SIZE_CAP:-300} changed lines for this run. Before your final commit run 'git diff --stat $START..HEAD' (this run's start commit $START; plus 'git diff --stat' for uncommitted work): if the total is over the cap, cut the change down, or end the commit message with a 'Size-reason: ...' trailer if the brief allows it. Otherwise the lane rejects the work. Commit early (a WIP commit is fine): a run with no commit and no file changes for $((IDLE_S / 60)) minutes is stopped. If you cannot make verify.sh pass, say why and stop."; }
run_agent() {  # $1 lane, $2 worktree, $3 log. Lane identity is in the committer name.
  local a cmd P; a=$(cfg lane "$1" agent); cmd=$(cfg lane "$1" cmd); P=$(prompt "$1")
  export GIT_COMMITTER_NAME="$(git -C "$2" config user.name || echo agent) ($1/$a)"
  case " ${LANE_FORCE_FAIL:-} " in *" $1 "*) echo "forced failure (LANE_FORCE_FAIL test)" >> "$3"; return 97;; esac
  [ -n "${LANE_STUB_CMD:-}" ] && { (cd "$2" && LANE="$1" AGENT="$a" PROMPT="$P" bash -c "$LANE_STUB_CMD") >> "$3" 2>&1; return; }  # test hook
  case $a in
    cursor) local K; K=$(vault get "$(cfg lane "$1" key)" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' 2>/dev/null) || { echo "vault read failed" >>"$3"; return 98; }
      # Key only in this child's environment: never argv (ps), never exported, keychain untouched.
      (cd "$2" && CURSOR_API_KEY="$K" "$cmd" -p --force --trust --workspace "$2" --output-format text "$P") >> "$3" 2>&1;;
    # No workspace-write sandbox (tested 13 Oct, codex 0.162 seatbelt, network on, .git common dir +
    # ~/ops/lanes as writable roots): .git stays read-only inside the sandbox, so the agent can't
    # commit, and simctl/CoreSimulator XPC is refused, so verify.sh (iOS sim build) fails. Re-test
    # before tightening. (--full-auto no longer exists in codex exec.)
    codex) (cd "$2" && "$cmd" exec -s danger-full-access "$P") >> "$3" 2>&1;;
    opencode) (cd "$2" && "$cmd" run "$P") >> "$3" 2>&1;;
    *) echo "unknown agent $a" >> "$3"; return 99;;
  esac
}
# Stop rule: a brief that already failed twice goes to Cody, never straight back to an agent.
grep -qF "	$TITLE	" "$OPS/failures.tsv" 2>/dev/null && { echo "refusing: '$TITLE' already failed twice (see $OPS/failures.tsv); fix the brief"; exit 2; }
G=$(guard --preflight "$LANE" "$TITLE" 2>&1) || { echo "lane-guard --preflight refused: $G"; exit 5; }
# One writer per unit and per branch.
UL="$OPS/units/$SLUG.lock"; BLS=""
lock_take "$UL" || { echo "unit '$SLUG' already has a writer (pid $(lock_holder "$UL")); not starting"; exit 3; }
# Continuous dispatch: whenever a lane becomes free, for any reason (success, failure, failover to
# another lane, blocked, infra error), ask lane-guard at once to refill it, so no lane idles until the
# 10-min launchd tick (now only a backstop): 'lane-guard --dispatch --free-lane <lane>' when its --help
# lists --free-lane, else plain '--dispatch'. Background, non-fatal, never changes our exit code;
# LANE_NO_CHAIN=1 disables it, and SIGINT/SIGTERM (a stop) does not chain.
# Runaway guards limit retrying the SAME failing task, never refilling the lane: when this task failed
# fast (< LANE_CHAIN_MIN_S, default 120 s) or failed for the 2nd+ time in a row ($OPS/chain-fails/<slug>,
# reset by its success), its queued retries (queue/*.task with the same title, any "(attempt N)")
# move to $OPS/queue-hold/ for Cody and the lane is still refilled with the next eligible card.
# Exception: an infra error (verify.sh exit 10, missing toolchain) does not chain, since every next card
# would hit the same missing tool; the task goes to queue-hold/ (not failed) and NEEDS_CODY names the tool.
# Global breaker: per-task streaks can't see a systemic fault (expired login, fetch failure, full disk)
# that fails every card fast. Each fast failure appends "<epoch> <task>" to $OPS/fast-fails.tsv; when
# LANE_BREAKER_N (3) distinct tasks failed fast within LANE_BREAKER_WIN_S (900 s), we write $OPS/PAUSE
# (honoured by lane-guard --preflight/--dispatch), add a NEEDS_CODY line, and stop chaining. Cody clears PAUSE.
# The call runs under the lanelib lock $OPS/dispatch-chain.lock (one chained dispatch at a time; we wait
# up to ~10 s for it so a failover refill isn't lost). lane-guard takes its own $OPS/dispatch.lock.
UNIT_T0=$(date +%s); SIGNALED=""; FREED=$LANE; CF="$OPS/chain-fails"
[ -f "$CF" ] && rm -f "$CF"; mkdir -p "$CF"   # old global streak file -> per-task dir
base_title() { echo "$1" | sed -E 's/ \(attempt [0-9]+\)$//'; }
hold_retries() {  # move queued retries of this task to queue-hold/
  local f t bt; bt=$(base_title "$TITLE"); mkdir -p "$OPS/queue-hold"
  for f in "$OPS"/queue/*.task; do [ -f "$f" ] || continue
    t=$(grep -vE '^(unit|needs|scope|expected_min|card|branch|after):' "$f" | head -1)
    [ "$(base_title "$t")" = "$bt" ] && QW --force --mv "$f" "$OPS/queue-hold/" >/dev/null && echo "$(date '+%F %T') $SLUG: held retry $(basename "$f") (runaway guard)" >> "$OPS/logs/dispatch-chain.log"
  done; }
fail_guard() { local rc=$1 n k f="$CF/$(echo "$(base_title "$TITLE")" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-*//' | cut -c1-40 | sed 's/-$//')"
  for k in $(seq 1 50); do lock_take "$OPS/chain-state.lock" && break; sleep 0.1; done
  if [ "$rc" = 0 ]; then rm -f "$f"; lock_drop "$OPS/chain-state.lock"; return 0; fi
  n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 )); echo $n > "$f"; lock_drop "$OPS/chain-state.lock"
  FAST=""; [ $(( $(date +%s) - UNIT_T0 )) -lt "${LANE_CHAIN_MIN_S:-120}" ] && FAST=1
  { [ -n "$FAST" ] || [ $n -ge 2 ]; } && hold_retries
  [ -n "$FAST" ] && breaker "${f##*/}"; return 0; }
breaker() {  # $1 task key of a fast failure; trips PAUSE on N distinct fast-failing tasks within the window
  local now d FF="$OPS/fast-fails.tsv"; now=$(date +%s)
  for k in $(seq 1 50); do lock_take "$OPS/chain-state.lock" && break; sleep 0.1; done
  printf '%s\t%s\n' "$now" "$1" >> "$FF"
  awk -F'\t' -v c=$(( now - ${LANE_BREAKER_WIN_S:-900} )) '$1>=c' "$FF" > "$FF.tmp" && mv "$FF.tmp" "$FF"
  d=$(cut -f2 "$FF" | sort -u | grep -c .); lock_drop "$OPS/chain-state.lock"
  [ "$d" -ge "${LANE_BREAKER_N:-3}" ] || return 0
  [ -f "$OPS/PAUSE" ] || { echo "run-lane $(date '+%F %T'): breaker: $d distinct tasks failed fast within ${LANE_BREAKER_WIN_S:-900}s ($(cut -f2 "$FF" | sort -u | tr '\n' ' '))" > "$OPS/PAUSE"
    echo "$(date '+%F %T') $SLUG: BREAKER: $d distinct tasks failed fast within ${LANE_BREAKER_WIN_S:-900}s (systemic fault? login, fetch, disk); chaining paused via $OPS/PAUSE; last log $LOG" >> "$OPS/NEEDS_CODY"
    echo "$(date '+%F %T') $SLUG: breaker tripped ($d distinct fast failures) -> PAUSE" >> "$OPS/logs/dispatch-chain.log"; }; }
free_lane() {  # $1 lane now free; non-blocking
  { [ -n "${LANE_NO_CHAIN:-}" ] || [ ! -x "$LANE_GUARD" ]; } && return 0
  local fl=""; { "$LANE_GUARD" --help 2>&1 </dev/null || true; } | grep -q -- '--free-lane' && fl="--free-lane $1"
  nohup bash -c '. "$1"; for k in $(seq 1 100); do lock_take "$2" && break; [ $k = 100 ] && { echo "$(date "+%F %T") $4: refill of lane $3 skipped: $2 busy for ~10 s (pid $(lock_holder "$2"))"; exit 0; }; sleep 0.1; done
    trap "lock_drop \"$2\"" EXIT; shift 4; "$@"' _ \
    "$SD/lanelib.sh" "$OPS/dispatch-chain.lock" "$1" "$SLUG" "$LANE_GUARD" --dispatch $fl >> "$OPS/logs/dispatch-chain.log" 2>&1 </dev/null &
  echo "$(date '+%F %T') $SLUG: lane $1 free -> dispatch${fl:+ $fl}" >> "$OPS/logs/dispatch-chain.log"; return 0; }
next_dispatch() { [ -n "$SIGNALED" ] && { echo "$(date '+%F %T') $SLUG rc=$1: not chaining (signal)" >> "$OPS/logs/dispatch-chain.log"; return 0; }
  [ "$1" = 10 ] && { echo "$(date '+%F %T') $SLUG rc=10: not chaining (infra: missing toolchain; every card would hit it)" >> "$OPS/logs/dispatch-chain.log"; return 0; }
  fail_guard "$1"
  [ -f "$OPS/PAUSE" ] && { echo "$(date '+%F %T') $SLUG rc=$1: not chaining (PAUSE set)" >> "$OPS/logs/dispatch-chain.log"; return 0; }
  free_lane "$FREED"; }
trap 'rc=$?; lock_drop "$UL"; for b in $BLS; do lock_drop "$b"; done; next_dispatch $rc; exit $rc' EXIT
trap 'SIGNALED=1; [ -n "${AP:-}" ] && stop_agent; exit 143' TERM
trap 'SIGNALED=1; [ -n "${AP:-}" ] && stop_agent; exit 130' INT
BU card "$SLUG" "${TASKF:-/dev/null}"; STARTED=""
ev queued "$LANE" "$TITLE (needs=$NEEDS, expected=${EXP}m)"
git -C "$REPO" fetch -q origin; TRIED=""
# No in-process failover (it stacked units onto busy lanes): one lane per run. On a first failure the
# brief goes back to $OPS/queue/ as "<title> (attempt 2)" and we exit; lane-guard --dispatch (chained
# at exit) starts it on a free lane. A failed attempt 2+ goes to failures.tsv + NEEDS_CODY.
# free_branch BRANCH WT: another worktree holding refs/heads/BRANCH makes `git worktree add` fail. If no live
# process has its cwd in it (lsof; missing/failing lsof = in use, fail closed) and lanelib in_use (cleanup.sh's
# rule: live verify lock / fresh marker, build slot, live unit lock, pgrep) says free, it is stale (.build/proof is
# archived to $OPS/proof-archive first): a clean one is removed, a dirty one is
# detached (changes kept). A local branch that has diverged from origin/BRANCH is kept as
# cody-stale/<branch>-<sha7> and the local branch is moved to origin/BRANCH.
free_branch() {
  local b=$1 me=$2 p="" cur="" sha
  while IFS= read -r line; do case $line in "worktree "*) cur=${line#worktree };; "branch refs/heads/$b") p=$cur;; esac; done \
    < <(git -C "$REPO" worktree list --porcelain)
  if [ -n "$p" ] && [ "$p" != "$me" ]; then
    local cw; cwd_in_use "$p"; cw=$?; LOCKS=${LOCKS:-$(cfg get lock_dir)}
    if [ $cw = 0 ]; then echo "branch $b is checked out in $p by a live process; leaving it" >> "$LOG"
    elif [ $cw = 2 ]; then echo "branch $b is checked out in $p; can't check live processes (lsof missing or failed); leaving it (fail closed)" >> "$LOG"
    elif OPS=$OPS in_use "$p"; then echo "branch $b is checked out in $p, which is in use (verify lock/marker, build slot or unit lock); leaving it" >> "$LOG"
    elif [ -z "$(git -C "$p" status --porcelain 2>/dev/null)" ]; then
      [ -d "$p/.build/proof" ] && mkdir -p "$OPS/proof-archive" && cp -R "$p/.build/proof" "$OPS/proof-archive/$(basename "$p")-$(date +%Y%m%d%H%M%S)" 2>/dev/null   # keep evidence (ignored files go with the tree)
      git -C "$REPO" worktree remove "$p" >> "$LOG" 2>&1 && echo "removed stale worktree $p (held $b)" >> "$LOG"
    else git -C "$p" checkout -q --detach >> "$LOG" 2>&1 && echo "detached stale dirty worktree $p (held $b; changes kept)" >> "$LOG"; fi
  fi
  git -C "$REPO" show-ref -q "refs/heads/$b" && git -C "$REPO" show-ref -q "refs/remotes/origin/$b" || return 0
  git -C "$REPO" merge-base --is-ancestor "refs/heads/$b" "refs/remotes/origin/$b" && return 0   # behind or equal: fine
  git -C "$REPO" merge-base --is-ancestor "refs/remotes/origin/$b" "refs/heads/$b" && return 0   # only ahead: unpushed work, keep
  sha=$(git -C "$REPO" rev-parse --short=7 "refs/heads/$b")
  git -C "$REPO" worktree list --porcelain | grep -qx "branch refs/heads/$b" && { echo "branch $b diverged but is still checked out; leaving it" >> "$LOG"; return 0; }
  git -C "$REPO" branch -q "cody-stale/$b-$sha" "refs/heads/$b" && git -C "$REPO" branch -q -f "$b" "refs/remotes/origin/$b" &&
    echo "local $b diverged from origin; kept as cody-stale/$b-$sha, $b now at origin/$b" >> "$LOG"; }
IDLE_S=${LANE_IDLE_S:-$(( ${LANE_IDLE_MIN:-12} * 60 ))}; RS=${LANE_RETRY_SLEEP:-1}   # RS: retry backoff multiplier (tests: 0)
# The agent runs in its own process group (set -m: background job gets pgid = its pid). stop_agent TERMs the
# whole group, waits up to LANE_KILL_WAIT (10) s, then KILLs it, and confirms nothing in the group survives.
stop_agent() { local k; kill -TERM -- -"$AP" 2>/dev/null
  for k in $(seq 1 $(( ${LANE_KILL_WAIT:-10} * 10 ))); do pgrep -g "$AP" >/dev/null 2>&1 || return 0; sleep 0.1; done
  kill -KILL -- -"$AP" 2>/dev/null; sleep 0.2
  if pgrep -g "$AP" >/dev/null 2>&1; then echo "warn: agent group $AP still has processes after KILL: $(pgrep -g "$AP" | tr '\n' ' ')" >> "$LOG"; return 1; fi
  echo "agent group $AP stopped (KILL after ${LANE_KILL_WAIT:-10}s)" >> "$LOG"; }
L=$LANE; for _once in 1; do   # 'continue' = this attempt failed
  B=$BRANCH; WT="$WTR/$L-$SLUG"; LOG="$OPS/logs/$ID-$L.log"
  TRIED="$TRIED $L"; BL=$(branch_lock_dir "$B")
  lock_take "$BL" || { ev failed "$L" "branch $B has another writer (pid $(lock_holder "$BL"))"; continue; }; BLS="$BLS $BL"
  ev running "$L" "$WT"
  [ -d "$WT" ] || free_branch "$B" "$WT"
  if [ ! -d "$WT" ]; then  # reuse an existing local branch, else track origin/<B> (continuing a PR), else create from BASE
    WOK=""; for wtry in 1 2 3; do   # transient failures (index.lock, stale admin dir): prune and retry; the agent never ran
      if git -C "$REPO" show-ref -q "refs/heads/$B"; then git -C "$REPO" worktree add -q "$WT" "$B"
      elif git -C "$REPO" show-ref -q "refs/remotes/origin/$B"; then git -C "$REPO" worktree add -q -b "$B" "$WT" "origin/$B"
      else git -C "$REPO" worktree add -q -b "$B" "$WT" "$BASE"; fi > "$LOG.wt" 2>&1 && WRC=0 || WRC=1; cat "$LOG.wt" >> "$LOG"
      [ $WRC = 0 ] && { WOK=1; rm -f "$LOG.wt"; break; }
      grep -q "is already used by worktree" "$LOG.wt" && break   # THIS attempt: branch checked out elsewhere, retrying won't help
      echo "worktree add failed (try $wtry); pruning and retrying" >> "$LOG"; git -C "$REPO" worktree prune; rm -rf "$WT"; sleep $((wtry * 5 * RS)); done; rm -f "$LOG.wt"
    [ -n "$WOK" ] || { ev failed "$L" "worktree add failed"; continue; }
  fi
  if git -C "$REPO" show-ref -q "refs/remotes/origin/$B" && [ "$(git -C "$WT" rev-parse HEAD)" != "$(git -C "$REPO" rev-parse "origin/$B")" ]; then
    if git -C "$WT" merge-base --is-ancestor HEAD "origin/$B"; then   # local branch behind origin: fast-forward, never reset
      git -C "$WT" merge -q --ff-only "origin/$B" >> "$LOG" 2>&1 && echo "fast-forwarded $B to origin/$B" >> "$LOG" || { ev failed "$L" "fast-forward of $B failed"; continue; }
    elif ! git -C "$REPO" merge-base --is-ancestor "origin/$B" "$(git -C "$WT" rev-parse HEAD)"; then
      ev failed "$L" "local $B and origin/$B have diverged; not force-pushing"; continue; fi
  fi
  [ -n "${LANE_SKIP_SETUP:-}" ] || (cd "$WT" && bash "$SD/wt-setup.sh") >> "$LOG" 2>&1
  START=$(git -C "$WT" rev-parse HEAD)   # branch head at unit start: size, trailer and no-commit checks measure only this run's work
  set -m; run_agent "$L" "$WT" "$LOG" < /dev/null & AP=$!; set +m; LAST=$(date +%s); SIG=""; T0=$LAST; IDLE=""
  while kill -0 $AP 2>/dev/null; do sleep "${LANE_POLL:-30}"   # liveness = new commit/push/change, not log mtime
    S=$(git -C "$WT" rev-parse HEAD; git -C "$WT" ls-remote origin "$B" 2>/dev/null; git -C "$WT" status --porcelain | shasum)
    [ "$S" != "$SIG" ] && { SIG=$S; LAST=$(date +%s); started; }
    if [ $(( $(date +%s) - LAST )) -gt $((EXP * 60)) ]; then ev STUCK "$L" "no commit/push/change for ${EXP}m; requeue"
      stop_agent; break; fi
    # Fast-fail: no commit and no file change at all since start for LANE_IDLE_MIN (12) min -> stop now, not at EXP.
    if [ "$(git -C "$WT" rev-parse HEAD)" = "$START" ] && [ -z "$(git -C "$WT" status --porcelain)" ] && \
       [ $(( $(date +%s) - T0 )) -gt $IDLE_S ]; then IDLE=1
      echo "fast-fail: no commit or file change after ${IDLE_S}s" >> "$LOG"; stop_agent; break; fi
  done; wait $AP; rc=$?; started
  [ -n "$IDLE" ] && { ev failed "$L" "no commit (fast-fail: idle ${IDLE_S}s)"; continue; }
  if [ $rc -ne 0 ]; then ev failed "$L" "agent rc=$rc"; continue; fi
  [ -n "$(git -C "$WT" log --oneline "$START"..HEAD)" ] || { echo "agent made no commit" >> "$LOG"; ev failed "$L" "no commit"; continue; }
  NT=$(git -C "$WT" log --format='%H%x09%(trailers:key=Lane,valueonly,separator=%x2C)' "$START"..HEAD | awk -F'\t' '$2==""' | wc -l | tr -d ' ')
  [ "$NT" = 0 ] || echo "warn: $NT lane commit(s) without a 'Lane:' trailer (committer name still says $L)" | tee -a "$LOG"
  CH=$(git -C "$WT" diff --shortstat "$START"..HEAD | awk '{print $4+$6}')
  if [ "${CH:-0}" -gt "${SIZE_CAP:-300}" ]; then echo "warn: $CH changed lines > ${SIZE_CAP:-300}" | tee -a "$LOG"
    git -C "$WT" log --format=%B "$START"..HEAD | grep -qE '^Size-reason: *[^ ]' || { ev failed "$L" "size $CH > cap, no Size-reason"; continue; }; fi
  [ -n "${LANE_DRY:-}" ] && { ev dry "$L" "checks passed; stopping before verify/push"; echo "DRY-OK $L"; exit 0; }
  (cd "$WT" && if [ -n "${LANE_VERIFY_CMD:-}" ]; then bash -c "$LANE_VERIFY_CMD"; else TI_BASE=$BASE VERIFY_SCOPE="$SCOPE" VERIFY_NEEDS="$NEEDS" bash "$SD/verify.sh"; fi) >> "$LOG" 2>&1; VRC=$?   # LANE_VERIFY_CMD: test hook
  if [ $VRC = 10 ]; then   # infra error (verify.sh toolchain preflight): not a task failure, no PAUSE count, no failover
    MISS=$(sed -n 's/^verify: INFRA missing toolchain: *//p' "$LOG" | tail -1)
    printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" infra "$L" "missing toolchain: ${MISS:-?} (task: $SLUG)" "$LOG" >> "$OPS/failures.tsv"
    echo "$(date '+%F %T') $ID: INFRA missing toolchain on $HOST: ${MISS:-?} (lane $L, task '$TITLE' not failed) log $LOG" >> "$OPS/NEEDS_CODY"
    [ -n "$TASKF" ] && QW --no-check --dir "$OPS/queue-hold" --name "$ID-infra.task" "$TASKF" >/dev/null
    ev infra "$L" "missing toolchain: ${MISS:-?}"; BU verify "$SLUG" blocked; echo "INFRA: missing toolchain: ${MISS:-?} -> $OPS/NEEDS_CODY"; exit 10; fi
  [ -x "$LANE_GUARD" ] && { "$LANE_GUARD" --task-end "$L" "$ID" "$VRC" "$LOG" >> "$LOG" 2>&1 || true; }  # Carl's hook; non-fatal
  [ $VRC = 0 ] || { ev failed "$L" "verify failed"; continue; }
  git -C "$WT" push -q -u origin "$B" >> "$LOG" 2>&1 || { ev failed "$L" "push failed"; continue; }
  BODY="Task: $TITLE"$'\n'"Lane: $L ($(cfg lane "$L" agent)/$(cfg lane "$L" account)), tried:$TRIED"$'\n\n'
  BODY+="$(cat "$WT/.build/proof/summary.md")"$'\n\n'"$(publish_proof "$WT" "$ID" 2>>"$LOG")"
  LV=$(cat "$WT/.build/proof/level" 2>/dev/null || echo build-only); DRAFT=""
  case $LV in UI-verified|unit-test-verified) ;; build-only) ;; *) ev failed "$L" "level $LV"; continue;; esac
  [ "$LV" = build-only ] && { DRAFT=--draft; BODY="**Verification level: build-only, so this is NOT ready for review (draft).**"$'\n\n'"$BODY"; }
  BODY+=$'\n\n'"Release Notes:"$'\n\n'"- N/A"   # PR validator: body (and lane comments) end with this
  # Continuing an existing PR (--branch with an open PR): no new PR; comment the new head + summary on it.
  EX=$(cd "$WT" && gh pr list -R "$SLUG_REPO" --head "$B" --state open --json url -q '.[0].url' 2>>"$LOG") ||
    { ev failed "$L" "gh pr list failed (pushed $B; no PR created or commented)"; continue; }
  if [ -n "$EX" ]; then URL=$EX; NH=$(git -C "$WT" rev-parse HEAD)
    (cd "$WT" && gh pr comment "$URL" -R "$SLUG_REPO" --body "Lane update: new head $NH (from $START)"$'\n\n'"$BODY") >> "$LOG" 2>&1 ||
      echo "warn: comment on existing PR $URL failed (push succeeded)" | tee -a "$LOG"
    [ -n "$DRAFT" ] && { (cd "$WT" && gh pr ready --undo "$URL" -R "$SLUG_REPO") >> "$LOG" 2>&1 ||
      echo "warn: could not mark existing PR $URL as draft (build-only)" | tee -a "$LOG"; }
  else
    URL=""; for ptry in 1 2 3; do   # pushed already: retry the API call only, never the agent
      URL=$(cd "$WT" && gh pr create $DRAFT -R "$SLUG_REPO" --head "$B" --base main --title "$(echo "$TASK" | head -1 | cut -c1-70)" --body "$BODY" 2>>"$LOG") && [ -n "$URL" ] && break
      sleep $((ptry * 10 * RS)); URL=$(cd "$WT" && gh pr list -R "$SLUG_REPO" --head "$B" --state open --json url -q '.[0].url' 2>>"$LOG"); [ -n "$URL" ] && break
      echo "gh pr create failed (try $ptry); retrying" >> "$LOG"; done
    [ -n "$URL" ] || { ev failed "$L" "gh pr create failed (3 tries; $B is pushed)"; continue; }
  fi
  basename "$WT" > "$OPS/cards/$SLUG.wt"; BU pr "$SLUG" "$URL"   # .wt: exact worktree name for cleanup
  BU verify "$SLUG" "$LV" "$WT/.build/proof" "$(echo "$BODY" | grep -oE "https://github.com/$SLUG_REPO/raw/proof-media/[^/) ]+" | head -1)"
  ev pr "$L" "$URL level=$LV"; printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$ID" "$URL" "$(git -C "$WT" rev-parse HEAD)" "$LV" >> "$OPS/results.tsv"
  echo "$URL ($LV)"; exit 0
done
BT=$(base_title "$TITLE"); AT=$(echo "$TITLE" | sed -nE 's/.* \(attempt ([0-9]+)\)$/\1/p'); AT=${AT:-1}
if [ "$AT" -lt 2 ]; then   # first failure: back to the queue for lane-guard to place on a free lane
  QD="$OPS/queue"; mkdir -p "$QD"; DUP=""
  for f in "$QD"/*.task; do [ -f "$f" ] || continue   # lane-guard --task-end may already have re-queued it
    [ "$(base_title "$(grep -vE '^(unit|needs|scope|expected_min|card|branch|after):' "$f" | head -1)")" = "$BT" ] && DUP=$f; done
  if [ -z "$DUP" ]; then Q="$QD/$(date +%m%d%H%M%S)-$SLUG-retry.task"
    QB=$(mktemp); { echo "$BT (attempt 2)"; echo "needs: ${NEEDS:-none}"; echo "expected_min: $EXP"   # title first (queue-write rule)
      [ -n "$TASKF" ] && grep -E '^(unit|scope|card|after):' "$TASKF"; [ "$BRANCH" != "agent/$SLUG" ] && echo "branch: $BRANCH"
      echo "$TASK" | tail -n +2; } > "$QB"
    sleep 1   # file newer than our events (lane-guard drop rule)
    if QW --name "$(basename "$Q")" "$QB" >/dev/null 2>"$QB.err"; then ev requeued "$L" "failed on $L; brief back in queue ($Q)"
    else ev failed "$L" "requeue rejected: $(tr '\n' ' ' < "$QB.err" | cut -c1-200)"
      echo "$(date '+%F %T') $ID: requeue of '$BT' rejected by queue-write: $(tr '\n' ' ' < "$QB.err")" >> "$OPS/NEEDS_CODY"; fi
    rm -f "$QB" "$QB.err"
  else ev requeued "$L" "failed on $L; already re-queued ($DUP)"; fi
  echo "REQUEUED after: $L -> $OPS/queue (lane-guard dispatches it to a free lane)"; exit 1; fi
ERR=$(tail -n 5 "$LOG" | tr '\t\n' '  ')
printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$TITLE" "${TRIED# }" "$ERR" "$LOG" >> "$OPS/failures.tsv"
echo "$(date '+%F %T') $ID: $TITLE (lanes:$TRIED) log $LOG" >> "$OPS/NEEDS_CODY"
BU verify "$SLUG" failed; BU drop "$SLUG" "abandoned: failed on$TRIED"; ev needs_cody "${TRIED# }" "$LOG"; echo "FAILED after:$TRIED -> $OPS/NEEDS_CODY"; exit 1
