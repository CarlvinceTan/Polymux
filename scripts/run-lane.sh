#!/bin/bash
# run-lane.sh <lane> "<task>"|<task-file> [--branch B] [--base origin/main]
# run-lane.sh --verify-only <branch>     (Mac proof for cloud-agent PRs)
# run-lane.sh --check <lane> <task-file>  (would it start? exit 0, else its refusal code; no side effects)
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
  local wt=$1 id=$2 idx c err ref="proof-media-$2-$(date +%Y%m%d%H%M%S)-$$" n=0; idx=$(mktemp)   # unique per run; never force
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
    if [ -n "${LANE_VERIFY_CMD:-}" ]; then bash -c "$LANE_VERIFY_CMD"; else VERIFY_TARGETS=full bash "$SD/verify.sh"; fi) > "$OPS/logs/$ID.log" 2>&1; rc=$?   # LANE_VERIFY_CMD: test hook
  BODY="$(cat "$WT/.build/proof/summary.md")"$'\n\n'"$(publish_proof "$WT" "$ID" 2>>"$OPS/logs/$ID.log")"
  gh_write pr comment "$BR" -R "$SLUG_REPO" --body "Mac proof ($HOST):"$'\n'"$BODY" && ev pr verify "$BR"
  [ $rc = 0 ] || ev failed verify "$BR"; exit $rc
fi
CHECK=""; [ "${1:-}" = "--check" ] && { CHECK=1; shift; }
LANE=$1; TASK=$2; UNIT=$2; shift 2; BASE=origin/main; BRANCH=""; NEEDS=none; EXP=60; SCOPE=""
TASKF=""; if [ -f "$TASK" ]; then TASKF=$TASK  # task file: "issue: N" (GitHub issue on Project 3; legacy "card:" ids map through board-map.tsv), "needs:", "expected_min:", "scope: a/**,b/*" (allowed files); rest is the brief
  NEEDS=$(sed -n 's/^needs: *//p' "$TASK" | head -1); EXP=$(sed -n 's/^expected_min: *//p' "$TASK" | head -1)
  SCOPE=$(sed -n 's/^scope: *//p' "$TASK" | head -1)
  BRANCH=$(sed -n 's/^branch: *//p' "$TASK" | head -1)
  WANT_AGENT=$(sed -n 's/^agent: *//p' "$TASK" | head -1 | tr -d ' ')   # watchdog retry: run only on this agent (codex|opencode|cursor)
  TASK=$(grep -viE '^(unit|needs|scope|expected_min|card|issue|labels|branch|after|type|area|agent):' "$TASK"); EXP=${EXP:-60}   # branch:/after: are headers too (a branch: above the title used to become the title)
fi
# GitHub labels for the PR (type:/area: headers, else inferred; see brief_labels in lanelib.sh)
LBF=${TASKF:-$(mktemp)}; [ -n "$TASKF" ] || printf '%s\n' "$TASK" > "$LBF"
PR_TITLE=$(brief_title "$LBF"); PR_LINK=$(brief_link "$LBF"); PR_WARNING=""
[ -n "$PR_LINK" ] || PR_WARNING="missing issue: in brief"
LABELS=$(brief_labels "$LBF" "$(basename "${TASKF:-inline}")") || { [ -n "$TASKF" ] || rm -f "$LBF"; echo "refusing: invalid brief label headers"; exit 2; }
[ -n "$TASKF" ] || rm -f "$LBF"
# Lane gate FIRST: a disabled (lane1 = main Cursor account), expired or unknown lane never runs; no claim, worktree or vault read.
cfg usable "$LANE" || { echo "refusing: lane '$LANE' is disabled, expired or unknown in agents/lanes.toml"; exit 5; }
cfg mainkey "$LANE" && { echo "refusing: lane '$LANE' key/account points at the main account"; exit 5; }
[ -n "${WANT_AGENT:-}" ] && [ "$(cfg lane "$LANE" agent)" != "$WANT_AGENT" ] && { echo "refusing: brief wants agent '$WANT_AGENT', lane '$LANE' runs '$(cfg lane "$LANE" agent)'"; exit 5; }
QW() { bash "$SD/queue-write.sh" "$@"; }   # every queue/queue-hold write goes through the locked helper
TARGET=${LANE_TARGET:-$HOST}   # dispatcher Xcode guard: refuse before any claim/worktree
while [ $# -gt 0 ]; do case $1 in --branch) BRANCH=$2; shift 2;; --base) BASE=$2; shift 2;; *) shift;; esac; done
TITLE=$(echo "$TASK" | head -1); SLUG=$(echo "$TITLE" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-*//' | cut -c1-32 | sed 's/-*$//')   # '# SA1: x' -> sa1-x (no leading '-')
ID="$(date +%m%d%H%M)-$SLUG"; BRANCH=${BRANCH:-agent/$SLUG}
prompt() { echo "Task: $TASK
Rules: work only in this worktree. Never search or list outside it (no ls, find or grep above it; no \$HOME scans). Keep the change small and scoped.${SCOPE:+ Only touch files matching: $SCOPE.} Build and test ONLY via
'bash "$SD/verify.sh"' and iterate until it exits 0 (never run it in the background). Commit your work with a clear message
ending in the trailer line 'Lane: $1/$(cfg lane "$1" agent)'.
Do not push and do not open a PR. Never skip, delete or weaken tests; a behaviour change
needs a test change (or a 'No-test-reason: ...' line in the commit). Size cap: ${SIZE_CAP:-300} changed lines for this run. Before your final commit run 'git diff --stat $START..HEAD' (this run's start commit $START; plus 'git diff --stat' for uncommitted work): if the total is over the cap, cut the change down, or end the commit message with a 'Size-reason: ...' trailer if the brief allows it. Otherwise the lane rejects the work. Commit early (a WIP commit is fine): a run with no commit and no file changes for $((IDLE_S / 60)) minutes is stopped. Never open a browser, a browser profile or any Grok Bot session. If you cannot make verify.sh pass, say why and stop."; }
run_agent() {  # $1 lane, $2 worktree, $3 log. Lane identity is in the committer name.
  cfg usable "$1" || { echo "refusing: lane $1 not usable" >>"$3"; return 95; }   # belt and braces
  unset CURSOR_API_KEY   # never inherit the main account key into any agent child
  local a cmd P H; a=$(cfg lane "$1" agent); cmd=$(cfg lane "$1" cmd); P=$(prompt "$1")
  H=$(cfg lane "$1" home); if [ -n "$H" ]; then [ "$H" = "$HOME" ] && { echo "refusing: lane home is the real HOME" >>"$3"; return 96; }; mkdir -p "$H"; fi
  export GIT_COMMITTER_NAME="$(git -C "$2" config user.name || echo agent) ($1/$a)"
  case " ${LANE_FORCE_FAIL:-} " in *" $1 "*) echo "forced failure (LANE_FORCE_FAIL test)" >> "$3"; return 97;; esac
  [ -n "${LANE_STUB_CMD:-}" ] && { (cd "$2" && HOME="${H:-$HOME}" LANE="$1" AGENT="$a" PROMPT="$P" bash -c "$LANE_STUB_CMD") >> "$3" 2>&1; return; }  # test hook
  case $a in
    cursor) local K KT; KT=$(cfg lane "$1" key)
      [ -n "$KT" ] || { echo "refusing: cursor lane $1 has no key" >>"$3"; return 98; }
      { python3 "$SD/lanes.py" forbidden "$KT" || cfg mainkey "$1"; } && { echo "refusing: lane $1 key is a main-account key" >>"$3"; return 98; }
      K=$(vault get "$KT" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' 2>/dev/null) || { echo "vault read failed" >>"$3"; return 98; }
      # Key only in this child's environment: never argv (ps), never exported, keychain untouched.
      (cd "$2" && HOME="${H:-$HOME}" CURSOR_API_KEY="$K" "$cmd" -p --force --trust --workspace "$2" --output-format text "$P") >> "$3" 2>&1;;
    # codex has no per-lane home (unlike cursor): the child gets a scratch HOME inside the worktree
    # (.build/lanehome, git-ignored) so anything it or its shell reaches via $HOME stays in the
    # worktree. On 14 Oct 00:56 a run with the real HOME prompted TCC for Downloads, Documents,
    # Music and Photos; those dialogs block XCUITest alert handling. Auth stays in the real
    # CODEX_HOME, gh/git config stay reachable through GH_CONFIG_DIR/GIT_CONFIG_GLOBAL, and the
    # links keep the shared state $HOME-relative paths point at: .local (go toolchain for verify.sh)
    # and ops/lanes (build slots, sim-warm markers; OPS).
    # The Go caches stay shared too (GOMODCACHE/GOCACHE below): under a scratch HOME every lane would
    # build its own ~1.8 GB module+build cache, and the read-only module cache survives a plain rm.
    # workspace-write re-tested 14 Oct (codex 0.162.1, network on): the agent still cannot commit
    # ("index.lock: Operation not permitted" under the worktree gitdir, with -c
    # sandbox_workspace_write.writable_roots=[git common dir, ~/ops/lanes] or --add-dir), and
    # simctl/CoreSimulator XPC is refused, so verify.sh cannot pass in the sandbox; keep
    # danger-full-access. Re-test before tightening. (--full-auto no longer exists in codex exec.)
    codex) local LH="$2/.build/lanehome" RH=$HOME
      local GC="$RH/Library/Caches/polymux-lanes"
      mkdir -p "$LH" "$LH/ops" "$GC/gomod" "$GC/gobuild"
      [ -e "$LH/.local" ] || [ -L "$LH/.local" ] || ln -s "$RH/.local" "$LH/.local"
      [ -e "$LH/ops/lanes" ] || [ -L "$LH/ops/lanes" ] || ln -s "$OPS" "$LH/ops/lanes"
      # gh keeps its token in the login keychain (hosts.yml has none); with HOME=$LH the keychain is
      # not found and every gh call 401s (14 Oct 02:14-02:48). Keychains is not TCC-protected.
      mkdir -p "$LH/Library"; [ -e "$LH/Library/Keychains" ] || [ -L "$LH/Library/Keychains" ] || ln -s "$RH/Library/Keychains" "$LH/Library/Keychains"
      (cd "$2" && HOME="$LH" CODEX_HOME="${CODEX_HOME:-$RH/.codex}" \
        GH_CONFIG_DIR="${GH_CONFIG_DIR:-$RH/.config/gh}" GIT_CONFIG_GLOBAL="${GIT_CONFIG_GLOBAL:-$RH/.gitconfig}" \
        GOMODCACHE="$GC/gomod" GOCACHE="$GC/gobuild" \
        "$cmd" exec -s danger-full-access "$P") >> "$3" 2>&1;;
    opencode) (cd "$2" && "$cmd" run "$P") >> "$3" 2>&1;;
    *) echo "unknown agent $a" >> "$3"; return 99;;
  esac
}
# Continuous dispatch: whenever a lane becomes free, for any reason (success, failure, failover to
# another lane, blocked, infra error), ask lane-guard at once to refill it, so no lane idles until the
# 10-min launchd tick (now only a backstop). Also on a refusal (exit 2/3/4/5), but never on a kill (TERM/INT: a stop must not restart work): 'lane-guard --dispatch --free-lane <lane>' when its --help
# lists --free-lane, else plain '--dispatch'. Background, non-fatal, never changes our exit code;
# LANE_NO_CHAIN=1 disables it; $OPS/PAUSE stops it. The detached refill waits LANE_CHAIN_DEBOUNCE_S
# (3 s) first, so a burst of exits coalesces (lane-guard also queues one re-run while its dispatch.lock is held).
# Storm guard: every refusal appends "<epoch> <slug> <rc>" to $OPS/refusals.tsv (cleared when a unit
# takes its lock); LANE_STORM_N (3) refusals in a row within LANE_STORM_WIN_S (60 s) -> no refill, logged
# to dispatch-chain.log + NEEDS_CODY (the 600 s tick still runs; lane-guard honours the same file).
# A kill -9 can't be trapped: the 600 s tick is the backstop for that.
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
STOP_CLASS=run; UNIT_T0=$(date +%s); SIGNALED=""; FREED=$LANE; CF="$OPS/chain-fails"
[ -f "$CF" ] && rm -f "$CF"; mkdir -p "$CF"   # old global streak file -> per-task dir
base_title() { echo "$1" | sed -E 's/ \(attempt [0-9]+\)$//'; }
deferred_hit() {  # $1 base title, $2 slug: print the $OPS/deferred/*.task (parked by policy, e.g. dogfood-first) that is this unit
  local f t st; for f in "$OPS"/deferred/*.task; do [ -f "$f" ] || continue
    st=$(basename "$f" .task | sed -E 's/^[0-9]+-+//; s/-retry(-[0-9]+)?$//')
    t=$(grep -viE '^(unit|needs|scope|expected_min|card|issue|labels|branch|after|type|area|queue-note):' "$f" | head -1)
    { [ "$(base_title "$t")" = "$1" ] || [ "$st" = "$2" ]; } && { echo "$f"; return 0; }; done; return 1; }
hold_retries() {  # move queued retries of this task to queue-hold/
  local f t bt; bt=$(base_title "$TITLE"); mkdir -p "$OPS/queue-hold"
  for f in "$OPS"/queue/*.task; do [ -f "$f" ] || continue
    t=$(grep -viE '^(unit|needs|scope|expected_min|card|issue|labels|branch|after|type|area):' "$f" | head -1)
    [ "$(base_title "$t")" = "$bt" ] && QW --force --mv "$f" "$OPS/queue-hold/" >/dev/null && echo "$(date '+%F %T') $SLUG: held retry $(basename "$f") (runaway guard)" >> "$OPS/logs/dispatch-chain.log"
  done; }
fail_guard() { local rc=$1 n k f="$CF/$(echo "$(base_title "$TITLE")" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-*//' | cut -c1-40 | sed 's/-$//')"
  for k in $(seq 1 50); do lock_take "$OPS/chain-state.lock" && break; sleep 0.1; done
  if [ "$rc" = 0 ]; then rm -f "$f"; lock_drop "$OPS/chain-state.lock"; return 0; fi
  [ "$STOP_CLASS" = run ] || { lock_drop "$OPS/chain-state.lock"; breaker "${f##*/}"; return 0; }
  n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 )); echo $n > "$f"; lock_drop "$OPS/chain-state.lock"
  FAST=""; [ $(( $(date +%s) - UNIT_T0 )) -lt "${LANE_CHAIN_MIN_S:-120}" ] && FAST=1
  { [ -n "$FAST" ] || [ $n -ge 2 ]; } && hold_retries
  [ -n "$FAST" ] && breaker "${f##*/}"; return 0; }
breaker() {  # $1 task key of a fast failure; trips PAUSE on N distinct fast-failing tasks within the window
  local now d FF="$OPS/fast-fails.tsv"; now=$(date +%s)
  for k in $(seq 1 50); do lock_take "$OPS/chain-state.lock" && break; sleep 0.1; done
  printf '%s\t%s\t%s\n' "$now" "$1" "$STOP_CLASS" >> "$FF"
  awk -F'\t' -v c=$(( now - ${LANE_BREAKER_WIN_S:-900} )) '$1>=c' "$FF" > "$FF.tmp" && mv "$FF.tmp" "$FF"
  d=$(awk -F'\t' '$3=="run"{print $2}' "$FF" | sort -u | grep -c .); lock_drop "$OPS/chain-state.lock"
  [ "$d" -ge "${LANE_BREAKER_N:-3}" ] || return 0
  [ -f "$OPS/PAUSE" ] || { echo "run-lane $(date '+%F %T'): breaker: $d distinct tasks failed fast within ${LANE_BREAKER_WIN_S:-900}s ($(cut -f2 "$FF" | sort -u | tr '\n' ' '))" > "$OPS/PAUSE"
    echo "$(date '+%F %T') $SLUG: BREAKER: $d distinct tasks failed fast within ${LANE_BREAKER_WIN_S:-900}s (systemic fault? login, fetch, disk); chaining paused via $OPS/PAUSE; last log ${LOG:-}" >> "$OPS/NEEDS_CODY"
    echo "$(date '+%F %T') $SLUG: breaker tripped ($d distinct fast failures) -> PAUSE" >> "$OPS/logs/dispatch-chain.log"; }; }
free_lane() {  # $1 lane now free; non-blocking
  { [ -n "${LANE_NO_CHAIN:-}" ] || [ ! -x "$LANE_GUARD" ]; } && return 0
  local fl=""; { "$LANE_GUARD" --help 2>&1 </dev/null || true; } | out_has -- '--free-lane' && fl="--free-lane $1"
  nohup bash -c '. "$1"; sleep "$5"; for k in $(seq 1 100); do lock_take "$2" && break; [ $k = 100 ] && { echo "$(date "+%F %T") $4: refill of lane $3 skipped: $2 busy for ~10 s (pid $(lock_holder "$2"))"; exit 0; }; sleep 0.1; done
    trap "lock_drop \"$2\"" EXIT; shift 5; "$@"' _ \
    "$SD/lanelib.sh" "$OPS/dispatch-chain.lock" "$1" "$SLUG" "${LANE_CHAIN_DEBOUNCE_S:-3}" "$LANE_GUARD" --dispatch $fl >> "$OPS/logs/dispatch-chain.log" 2>&1 </dev/null &
  echo "$(date '+%F %T') $SLUG: lane $1 free -> dispatch${fl:+ $fl}" >> "$OPS/logs/dispatch-chain.log"; return 0; }
next_dispatch() { [ -n "$SIGNALED" ] && { echo "$(date '+%F %T') $SLUG rc=$1: not chaining (killed by signal: a stop never restarts work; the 600 s tick is the backstop)" >> "$OPS/logs/dispatch-chain.log"; return 0; }
  [ "$1" = 10 ] && { echo "$(date '+%F %T') $SLUG rc=10: not chaining (infra: missing toolchain; every card would hit it)" >> "$OPS/logs/dispatch-chain.log"; return 0; }
  fail_guard "$1"
  [ -f "$OPS/PAUSE" ] && { echo "$(date '+%F %T') $SLUG rc=$1: not chaining (PAUSE set)" >> "$OPS/logs/dispatch-chain.log"; return 0; }
  free_lane "$FREED"; }
refusal() {  # $1 rc: refused before claiming the unit; still refill the lane unless refusals are storming
  [ -n "$CHECK" ] && return 0
  [ -n "$SIGNALED" ] && { echo "$(date '+%F %T') $SLUG rc=$1: not chaining (killed by signal before the claim; a stop never restarts work)" >> "$OPS/logs/dispatch-chain.log"; return 0; }
  local now n RF="$OPS/refusals.tsv"; now=$(date +%s)
  for k in $(seq 1 50); do lock_take "$OPS/chain-state.lock" && break; sleep 0.1; done
  printf '%s\t%s\t%s\n' "$now" "$SLUG" "$1" >> "$RF"
  awk -F'\t' -v c=$(( now - ${LANE_STORM_WIN_S:-60} )) '$1>=c' "$RF" > "$RF.tmp" && mv "$RF.tmp" "$RF"   # trim to the window on every write
  n=$(wc -l < "$RF" | tr -d ' '); lock_drop "$OPS/chain-state.lock"
  if [ "$n" -ge "${LANE_STORM_N:-3}" ]; then
    echo "$(date '+%F %T') $SLUG rc=$1: STORM: $n refusals in a row within ${LANE_STORM_WIN_S:-60}s; not refilling (600 s tick is the backstop)" >> "$OPS/logs/dispatch-chain.log"
    echo "$(date '+%F %T') $ID: dispatch storm: $n units refused in a row within ${LANE_STORM_WIN_S:-60}s (last: '$TITLE' rc=$1); see $RF" >> "$OPS/NEEDS_CODY"; return 0; fi
  [ -f "$OPS/PAUSE" ] && { echo "$(date '+%F %T') $SLUG rc=$1: refused; not chaining (PAUSE set)" >> "$OPS/logs/dispatch-chain.log"; return 0; }
  echo "$(date '+%F %T') $SLUG rc=$1: refused; refilling lane $LANE" >> "$OPS/logs/dispatch-chain.log"; free_lane "$LANE"; }
# Lane cap (max_concurrent): a run = a held unit lock with a LIVE pid on this lane (the lock's lane file, else its
# latest events.tsv row), i.e. the unit locks lane-guard counts, minus dead ones. A killed/crashed run's lock has a
# dead pid and never holds a slot. Count + unit-lock take happen under a per-lane mutex, so two starts can't both pass.
lane_live() { local d p l n=0; for d in "$OPS"/units/*.lock; do [ -d "$d" ] || continue; p=$(lock_holder "$d")
    { [ -n "$p" ] && kill -0 "$p" 2>/dev/null; } || continue
    l=$(cat "$d/lane" 2>/dev/null); [ -n "$l" ] || l=$(awk -F'\t' -v u="$(basename "$d" .lock)" '{s=$2; sub(/^[0-9]+-/,"",s); gsub(/^-+|-+$/,"",s)} s==u{l=$4} END{print l}' "$EV" 2>/dev/null)
    [ "$l" = "$1" ] && n=$((n+1)); done; echo $n; }
# --check: run only the refusal rules (lane usable/main key above, dispatch guard, stop rule, unit lock,
# lane max_concurrent cap) and exit 0 = would start,
# else the same refusal code; no claim, no events, no intake row, no chain. lane-guard --dispatch uses it.
if [ -n "$CHECK" ]; then DISPATCH_INTAKE=/dev/null bash "$SD/dispatch-guard.sh" "$UNIT" "$TARGET" >/dev/null || { echo "refusing: dispatch-guard"; exit 4; }
else trap 'rc=$?; refusal $rc; exit $rc' EXIT; trap 'SIGNALED=1; exit 143' TERM; trap 'SIGNALED=1; exit 130' INT
  bash "$SD/dispatch-guard.sh" "$UNIT" "$TARGET" || exit 4; fi
# Stop rule: a brief that already failed twice goes to Cody, never straight back to an agent.
grep -qF "	$TITLE	" "$OPS/failures.tsv" 2>/dev/null && { echo "refusing: '$TITLE' already failed twice (see $OPS/failures.tsv); fix the brief"; exit 2; }
UL="$OPS/units/$SLUG.lock"; BLS=""
MC=$(cfg maxconc "$LANE"); CAPL="$OPS/lanes/$LANE.cap.lock"
if [ -n "$CHECK" ]; then h=$(lock_holder "$UL"); [ -n "$h" ] && kill -0 "$h" 2>/dev/null && { echo "unit '$SLUG' already has a writer (pid $h)"; exit 3; }
  if [ "$MC" != 0 ]; then N=$(lane_live "$LANE"); [ "$N" -lt "$MC" ] || { echo "refusing: lane '$LANE' already has $N running (max_concurrent $MC)"; exit 5; }; fi
  echo "runnable: $SLUG"; exit 0; fi
G=$(guard --preflight "$LANE" "$TITLE" 2>&1) || { echo "lane-guard --preflight refused: $G"; exit 5; }
# One writer per unit and per branch.
# Cap: count + unit-lock take under the per-lane mutex, so two starts can't both pass (same rule as --check).
if [ "$MC" != 0 ]; then
  for k in $(seq 1 100); do lock_take "$CAPL" && break; sleep 0.1; done
  [ "$(lock_holder "$CAPL")" = $$ ] || { echo "refusing: lane '$LANE' cap mutex busy ($CAPL, pid $(lock_holder "$CAPL"))"; exit 5; }
  N=$(lane_live "$LANE"); [ "$N" -lt "$MC" ] || { lock_drop "$CAPL"; echo "refusing: lane '$LANE' already has $N running (max_concurrent $MC)"; exit 5; }
fi
lock_take "$UL" || { lock_drop "$CAPL" 2>/dev/null; echo "unit '$SLUG' already has a writer (pid $(lock_holder "$UL")); not starting"; exit 3; }
echo "$LANE" > "$UL/lane"; if [ "$MC" != 0 ]; then lock_drop "$CAPL"; fi
for k in $(seq 1 50); do lock_take "$OPS/chain-state.lock" && break; sleep 0.1; done
rm -f "$OPS/refusals.tsv"; lock_drop "$OPS/chain-state.lock"   # a unit started: the refusal streak is broken
OWN_WT=""; CLEANED=""
cleanup_unit() {
  [ -n "$CLEANED" ] && return 0
  CLEANED=1
  [ -n "$OWN_WT" ] && unit_free "$WT" "$SLUG" "$(cfg get lock_dir)" "$LOG"
  return 0
}
trap 'rc=$?; [ -n "${AP:-}" ] && stop_agent; [ -n "${WT:-}" ] && [ -n "${AP+x}" ] && reap_wt "$WT" "${LOG:-/dev/null}"; cleanup_unit; lock_drop "$UL"; for b in $BLS; do lock_drop "$b"; done; next_dispatch $rc; exit $rc' EXIT
trap 'SIGNALED=1; [ -n "${AP:-}" ] && stop_agent; [ -n "${WT:-}" ] && reap_wt "$WT" "${LOG:-/dev/null}"; AP=""; exit 143' TERM
trap 'SIGNALED=1; [ -n "${AP:-}" ] && stop_agent; [ -n "${WT:-}" ] && reap_wt "$WT" "${LOG:-/dev/null}"; AP=""; exit 130' INT
BU card "$SLUG" "${TASKF:-/dev/null}"; STARTED=""
ev queued "$LANE" "$TITLE (needs=$NEEDS, expected=${EXP}m)"
git -C "$REPO" fetch -q origin; TRIED=""
# No in-process failover (it stacked units onto busy lanes): one lane per run. On a first failure the
# brief goes back to $OPS/queue/ as "<title> (attempt 2)" and we exit; lane-guard --dispatch (chained
# at exit) starts it on a free lane. A failed attempt 2+ goes to failures.tsv + NEEDS_CODY.
# free_branch BRANCH WT: another worktree holding refs/heads/BRANCH makes `git worktree add` fail. If no live
# process has its cwd in it (lsof; missing/failing lsof = in use, fail closed) and lanelib in_use (cleanup.sh's
# rule: live verify lock / fresh marker, build slot, live unit lock, pgrep) says free, it is stale (.build/proof is
# archived to $OPS/proof-archive first): a clean one is removed, a dirty one is detached
# with its changes kept so the branch is free for this attempt. A local branch that has diverged from
# origin/BRANCH is kept as cody-stale/<branch>-<sha7> and the local branch is moved to origin/BRANCH.
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
    elif git -C "$p" switch -q --detach >> "$LOG" 2>&1; then   # dirty: detach (changes kept) frees $b for this attempt
      echo "detached stale dirty worktree $p (held $b; changes kept)" >> "$LOG"
    else echo "could not detach dirty worktree $p (held $b); leaving it" >> "$LOG"; fi
  fi
  git -C "$REPO" show-ref -q "refs/heads/$b" && git -C "$REPO" show-ref -q "refs/remotes/origin/$b" || return 0
  git -C "$REPO" merge-base --is-ancestor "refs/heads/$b" "refs/remotes/origin/$b" && return 0   # behind or equal: fine
  git -C "$REPO" merge-base --is-ancestor "refs/remotes/origin/$b" "refs/heads/$b" && return 0   # only ahead: unpushed work, keep
  sha=$(git -C "$REPO" rev-parse --short=7 "refs/heads/$b")
  git -C "$REPO" worktree list --porcelain | out_has -x "branch refs/heads/$b" && { echo "branch $b diverged but is still checked out; leaving it" >> "$LOG"; return 0; }
  git -C "$REPO" branch -q "cody-stale/$b-$sha" "refs/heads/$b" && git -C "$REPO" branch -q -f "$b" "refs/remotes/origin/$b" &&
    echo "local $b diverged from origin; kept as cody-stale/$b-$sha, $b now at origin/$b" >> "$LOG"; }
IDLE_S=${LANE_IDLE_S:-$(( ${LANE_IDLE_MIN:-12} * 60 ))}; RS=${LANE_RETRY_SLEEP:-1}   # RS: retry backoff multiplier (tests: 0)
# The agent runs in its own process group (set -m: background job gets pgid = its pid). stop_agent TERMs the
# whole group, waits up to LANE_KILL_WAIT (10) s, then KILLs it, and confirms nothing in the group survives.
# No-progress watchdog (Chief): stop a looping unit early and hand it to the OTHER agent once.
#  - no new commit for LANE_WD_NOCOMMIT_MIN (30) min since the start or the last commit, or
#  - the same test fails LANE_WD_TESTFAIL_N (3) times in this attempt's log (go "--- FAIL: X", swift "✘ Test X()
#    failed", XCTest "Test Case '-[C X]' failed", test-lanes/merge-queue "FAIL x", pytest "FAILED x").
# Then: stop_agent (opencode-aware teardown) and a retry brief with "agent: <other>" (codex <-> opencode;
# LANE_WD_ALT overrides) and a "## Watchdog" note. 0 disables a limit. Only attempt 1 is re-queued (stop rule).
WDOG=""; wd_failname() { [ -f "$LOG" ] || return 1; tail -c +"${LOG0:-1}" "$LOG" 2>/dev/null | perl -ne '
    if (/--- FAIL: (\S+)/) { print "$1\n" } elsif (/✘ Test (\S+?)\(?\)? .*failed/) { print "$1\n" }
    elsif (/Test Case .-\[\S+ (\S+?)\]. failed/) { print "$1\n" } elsif (/^FAIL +(\S.*?)\s*$/) { print "$1\n" }
    elsif (/^FAILED (\S+)/) { print "$1\n" }' | sort | uniq -c | sort -rn | awk -v n="$1" '$1>=n{ $1=""; sub(/^ /,""); print; exit}'; }
wd_check() {  # sets WDOG to the reason when a limit trips
  local nc=${LANE_WD_NOCOMMIT_MIN:-30} tf=${LANE_WD_TESTFAIL_N:-3} h t
  h=$(git -C "$WT" rev-parse HEAD 2>/dev/null); [ "$h" != "${WD_HEAD:-}" ] && { WD_HEAD=$h; WD_T=$(date +%s); }
  [ "${LANE_WD_NOCOMMIT_S:-$((nc * 60))}" -gt 0 ] && [ $(( $(date +%s) - ${WD_T:-$(date +%s)} )) -ge "${LANE_WD_NOCOMMIT_S:-$((nc * 60))}" ] && {
    WDOG="no new commit for $(( $(date +%s) - WD_T ))s (limit ${LANE_WD_NOCOMMIT_S:-$((nc * 60))}s)"; return 0; }
  [ "$tf" -gt 0 ] && t=$(wd_failname "$tf") && [ -n "$t" ] && { WDOG="test '$t' failed $tf+ times in this attempt"; return 0; }
  return 1; }
wd_alt() { [ -n "${LANE_WD_ALT:-}" ] && { echo "$LANE_WD_ALT"; return; }; case $(cfg lane "$L" agent) in opencode) echo codex;; *) echo opencode;; esac; }
# opencode lanes: "opencode run" attaches to the shared "opencode serve --service", so killing our process group
# leaves the SESSION running on the server (it keeps calling the model and tools). oc_capture records this
# attempt's session id (newest session whose directory is our worktree, created since the attempt began) in the
# log and $UL/oc_session; oc_end exports it next to the log, then ends it with "opencode session delete" (the
# CLI has no abort; delete stops it on the server). The serve itself is never restarted. LANE_OC_CMD: test hook.
OCS=""; ocli() { perl -e 'alarm shift; exec @ARGV' "${LANE_OC_TIMEOUT:-20}" "${LANE_OC_CMD:-$(cfg lane "$L" cmd)}" "$@"; }
oc_capture() { [ -z "$OCS" ] && [ "$(cfg lane "$L" agent 2>/dev/null)" = opencode ] && [ -n "${WT:-}" ] || return 0
  OCS=$( (cd "$WT" && ocli session list --format json -n 20) 2>/dev/null | python3 -c '
import json,os,sys
wt,since=sys.argv[1],int(sys.argv[2])*1000-5000; ds={wt,os.path.realpath(wt)}
try: ss=json.load(sys.stdin)
except Exception: sys.exit(0)
ss=[x for x in ss if isinstance(x,dict) and x.get("directory") in ds and int(x.get("created",0))>=since]
ss.sort(key=lambda x:-int(x.get("created",0)))
print(ss[0]["id"] if ss else "")' "$WT" "${T0:-0}")
  [ -n "$OCS" ] && { echo "opencode session: $OCS" >> "$LOG"; echo "$OCS" > "$UL/oc_session" 2>/dev/null; }; return 0; }
oc_end() { oc_capture; [ -n "$OCS" ] || return 0
  ocli session export "$OCS" > "$LOG.oc-$OCS.json" 2>/dev/null
  if ocli session delete "$OCS" >> "$LOG" 2>&1; then echo "opencode session $OCS ended on the shared serve (transcript: $LOG.oc-$OCS.json)" >> "$LOG"
  else echo "warn: could not end opencode session $OCS on the shared serve" >> "$LOG"; fi
  rm -f "$UL/oc_session"; OCS=""; }
stop_agent() { local k; oc_end; kill -TERM -- -"$AP" 2>/dev/null
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
  OWN_WT=1
  if ! git -C "$WT" symbolic-ref -q HEAD >/dev/null; then
    git -C "$WT" checkout -q "$B" >> "$LOG" 2>&1 || { ev failed "$L" "branch attach failed"; continue; }
  elif [ "$(git -C "$WT" symbolic-ref --short HEAD)" != "$B" ]; then
    OWN_WT=""; ev failed "$L" "worktree holds another branch"; continue
  fi
  if git -C "$REPO" show-ref -q "refs/remotes/origin/$B" && [ "$(git -C "$WT" rev-parse HEAD)" != "$(git -C "$REPO" rev-parse "origin/$B")" ]; then
    if git -C "$WT" merge-base --is-ancestor HEAD "origin/$B"; then   # local branch behind origin: fast-forward, never reset
      git -C "$WT" merge -q --ff-only "origin/$B" >> "$LOG" 2>&1 && echo "fast-forwarded $B to origin/$B" >> "$LOG" || { ev failed "$L" "fast-forward of $B failed"; continue; }
    elif ! git -C "$REPO" merge-base --is-ancestor "origin/$B" "$(git -C "$WT" rev-parse HEAD)"; then
      ev failed "$L" "local $B and origin/$B have diverged; not force-pushing"; continue; fi
  fi
  [ -n "${LANE_SKIP_SETUP:-}" ] || (cd "$WT" && bash "$SD/wt-setup.sh") >> "$LOG" 2>&1
  START=$(git -C "$WT" rev-parse HEAD)   # branch head at unit start: size, trailer and no-commit checks measure only this run's work
  OCS=""; WDOG=""; WD_HEAD=""; WD_T=""; LOG0=$(( $(wc -c < "$LOG" 2>/dev/null || echo 0) + 1 )); set -m; run_agent "$L" "$WT" "$LOG" < /dev/null & AP=$!; set +m; LAST=$(date +%s); SIG=""; T0=$LAST; IDLE=""
  while kill -0 $AP 2>/dev/null; do sleep "${LANE_POLL:-30}"   # liveness = new commit/push/change, not log mtime
    oc_capture
    wd_check && { ev watchdog "$L" "$WDOG; stopping, retry on $(wd_alt)"; echo "watchdog: $WDOG" >> "$LOG"; stop_agent; break; }
    S=$(git -C "$WT" rev-parse HEAD; git -C "$WT" ls-remote origin "$B" 2>/dev/null; git -C "$WT" status --porcelain | shasum)
    [ "$S" != "$SIG" ] && { SIG=$S; LAST=$(date +%s); started; }
    if [ $(( $(date +%s) - LAST )) -gt $((EXP * 60)) ]; then ev STUCK "$L" "no commit/push/change for ${EXP}m; requeue"
      stop_agent; break; fi
    # Fast-fail: no commit and no file change at all since start for LANE_IDLE_MIN (12) min -> stop now, not at EXP.
    if [ "$(git -C "$WT" rev-parse HEAD)" = "$START" ] && [ -z "$(git -C "$WT" status --porcelain)" ] && \
       [ $(( $(date +%s) - T0 )) -gt $IDLE_S ]; then IDLE=1
      echo "fast-fail: no commit or file change after ${IDLE_S}s" >> "$LOG"; stop_agent; break; fi
  done; wait $AP; rc=$?; started
  # Whatever the outcome, end the session: the agent's group, then anything still running in the worktree
  # (a shared "opencode serve" spawns MCP servers and tools outside our group). A dead attempt must not keep running.
  pgrep -g "$AP" >/dev/null 2>&1 && stop_agent; reap_wt "$WT" "$LOG"; AP=""
  [ -n "$WDOG" ] && { ev failed "$L" "watchdog: $WDOG"; continue; }
  [ -n "$IDLE" ] && { ev failed "$L" "no commit (fast-fail: idle ${IDLE_S}s)"; continue; }
  if [ $rc -ne 0 ]; then ev failed "$L" "agent rc=$rc"; continue; fi
  [ -n "$(git -C "$WT" log --oneline "$START"..HEAD)" ] || { echo "agent made no commit" >> "$LOG"; ev failed "$L" "no commit"; continue; }
  NT=$(git -C "$WT" log --format='%H%x09%(trailers:key=Lane,valueonly,separator=%x2C)' "$START"..HEAD | awk -F'\t' '$2==""' | wc -l | tr -d ' ')
  [ "$NT" = 0 ] || echo "warn: $NT lane commit(s) without a 'Lane:' trailer (committer name still says $L)" | tee -a "$LOG"
  CH=$(git -C "$WT" diff --shortstat "$START"..HEAD | awk '{print $4+$6}')
  if [ "${CH:-0}" -gt "${SIZE_CAP:-300}" ]; then echo "warn: $CH changed lines > ${SIZE_CAP:-300}" | tee -a "$LOG"
    git -C "$WT" log --format=%B "$START"..HEAD | out_has '^Size-reason: *[^ ]' || { STOP_CLASS=scope; ev failed "$L" "size $CH > cap, no Size-reason"; continue; }; fi
  [ -n "${LANE_DRY:-}" ] && { ev dry "$L" "checks passed; stopping before verify/push"; echo "DRY-OK $L"; exit 0; }
  (cd "$WT" && if [ -n "${LANE_VERIFY_CMD:-}" ]; then bash -c "$LANE_VERIFY_CMD"; else VERIFY_TARGETS=affected TI_BASE=$BASE VERIFY_SCOPE="$SCOPE" VERIFY_NEEDS="$NEEDS" bash "$SD/verify.sh"; fi) >> "$LOG" 2>&1; VRC=$?   # LANE_VERIFY_CMD: test hook
  if [ $VRC = 10 ]; then   # infra error (verify.sh toolchain preflight): not a task failure, no PAUSE count, no failover
    MISS=$(sed -n 's/^verify: INFRA missing toolchain: *//p' "$LOG" | tail -1)
    printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" infra "$L" "missing toolchain: ${MISS:-?} (task: $SLUG)" "$LOG" >> "$OPS/failures.tsv"
    echo "$(date '+%F %T') $ID: INFRA missing toolchain on $HOST: ${MISS:-?} (lane $L, task '$TITLE' not failed) log $LOG" >> "$OPS/NEEDS_CODY"
    [ -n "$TASKF" ] && QW --no-check --dir "$OPS/queue-hold" --name "$ID-infra.task" "$TASKF" >/dev/null
    ev infra "$L" "missing toolchain: ${MISS:-?}"; BU verify "$SLUG" blocked; echo "INFRA: missing toolchain: ${MISS:-?} -> $OPS/NEEDS_CODY"; exit 10; fi
  [ "$VRC" = 0 ] || { grep -q '^verify: allowed-files FAIL' "$LOG" && STOP_CLASS=scope; }
  [ -x "$LANE_GUARD" ] && { "$LANE_GUARD" --task-end "$L" "$ID" "$VRC" "$LOG" "$STOP_CLASS" >> "$LOG" 2>&1 || true; }  # Carl's hook; non-fatal
  [ $VRC = 0 ] || { ev failed "$L" "verify failed"; continue; }
  git -C "$WT" push -q -u origin "$B" >> "$LOG" 2>&1 || { ev failed "$L" "push failed"; continue; }
  BODY="Task: $TITLE"$'\n'"Lane: $L ($(cfg lane "$L" agent)/$(cfg lane "$L" account)), tried:$TRIED"$'\n\n'
  BODY+="$(cat "$WT/.build/proof/summary.md")"$'\n\n'"$(publish_proof "$WT" "$ID" 2>>"$LOG")"
  LV=$(cat "$WT/.build/proof/level" 2>/dev/null || echo build-only); DRAFT=""
  case $LV in UI-verified|unit-test-verified) ;; build-only) ;; *) ev failed "$L" "level $LV"; continue;; esac
  [ "$LV" = build-only ] && { DRAFT=--draft; BODY="**Verification level: build-only, so this is NOT ready for review (draft).**"$'\n\n'"$BODY"; }
  [ -n "$PR_WARNING" ] && { ev warning "$L" "$PR_WARNING"; BODY+=$'\n\n'"Warning: $PR_WARNING"; }
  [ -n "$PR_LINK" ] && BODY+=$'\n\n'"$PR_LINK"
  # gh_write (lanelib.sh) scrubs Notion URLs/page ids from every GitHub write
  BODY+=$'\n\n'"Release Notes:"$'\n\n'"- N/A"   # PR validator: body (and lane comments) end with this
  BODY=$(printf '%s' "$BODY" | plain_text)
  # Continuing an existing PR (--branch with an open PR): no new PR; comment the new head + summary on it.
  EX=$(cd "$WT" && gh pr list -R "$SLUG_REPO" --head "$B" --state open --json url -q '.[0].url' 2>>"$LOG") ||
    { ev failed "$L" "gh pr list failed (pushed $B; no PR created or commented)"; continue; }
  if [ -n "$EX" ]; then URL=$EX; NH=$(git -C "$WT" rev-parse HEAD)
    (cd "$WT" && gh_write pr comment "$URL" -R "$SLUG_REPO" --body "Lane update: new head $NH (from $START)"$'\n\n'"$BODY") >> "$LOG" 2>&1 ||
      echo "warn: comment on existing PR $URL failed (push succeeded)" | tee -a "$LOG"
    [ -n "$DRAFT" ] && { (cd "$WT" && gh pr ready --undo "$URL" -R "$SLUG_REPO") >> "$LOG" 2>&1 ||
      echo "warn: could not mark existing PR $URL as draft (build-only)" | tee -a "$LOG"; }
  else
    URL=""; for ptry in 1 2 3; do   # pushed already: retry the API call only, never the agent
      URL=$(cd "$WT" && gh_write pr create $DRAFT -R "$SLUG_REPO" --head "$B" --base main --label "$LABELS" --title "$PR_TITLE" --body "$BODY" 2>>"$LOG") && [ -n "$URL" ] && break
      sleep $((ptry * 10 * RS)); URL=$(cd "$WT" && gh pr list -R "$SLUG_REPO" --head "$B" --state open --json url -q '.[0].url' 2>>"$LOG"); [ -n "$URL" ] && break
      echo "gh pr create failed (try $ptry); retrying" >> "$LOG"; done
    [ -n "$URL" ] || { ev failed "$L" "gh pr create failed (3 tries; $B is pushed)"; continue; }
  fi
  basename "$WT" > "$OPS/cards/$SLUG.wt"; BU pr "$SLUG" "$URL"   # .wt: exact worktree name for cleanup
  BU verify "$SLUG" "$LV" "$WT/.build/proof" "$(echo "$BODY" | grep -oE "https://github.com/$SLUG_REPO/raw/proof-media/[^/) ]+" | head -1)"
  ev pr "$L" "$URL level=$LV"; printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$ID" "$URL" "$(git -C "$WT" rev-parse HEAD)" "$LV${PR_WARNING:+; $PR_WARNING}" >> "$OPS/results.tsv"
  cleanup_unit
  echo "$URL ($LV)"; exit 0
done
BT=$(base_title "$TITLE"); AT=$(echo "$TITLE" | sed -nE 's/.* \(attempt ([0-9]+)\)$/\1/p'); AT=${AT:-1}
if [ "$AT" -lt 2 ]; then   # first failure: back to the queue for lane-guard to place on a free lane
  QD="$OPS/queue"; mkdir -p "$QD"; DUP=""
  for f in "$QD"/*.task; do [ -f "$f" ] || continue   # lane-guard --task-end may already have re-queued it
    [ "$(base_title "$(grep -viE '^(unit|needs|scope|expected_min|card|issue|labels|branch|after|type|area):' "$f" | head -1)")" = "$BT" ] && DUP=$f; done
  for f in "$QD"/*.task "$OPS"/deferred/*.task; do [ -f "$f" ] || continue   # lane-guard --task-end may already have written the retry
    t=$(grep -vE '^(unit|needs|scope|expected_min|card|branch|after):' "$f" | head -1)
    case $f in "$OPS"/deferred/*) echo "$t" | grep -qE ' \(attempt [0-9]+\)$' || continue;; esac   # deferred/: only retries, not the parked brief
    [ "$(base_title "$t")" = "$BT" ] && DUP=$f; done
  DEF=$(deferred_hit "$BT" "$SLUG") && QD="$OPS/deferred"   # deferred by policy: park the retry beside it, never back in queue/
  if [ -z "$DUP" ]; then Q="$QD/$(date +%m%d%H%M%S)-$SLUG-retry.task"
    QB=$(mktemp); { echo "$BT (attempt 2)"; echo "needs: ${NEEDS:-none}"; echo "expected_min: $EXP"   # title first (queue-write rule)
      [ -n "$TASKF" ] && grep -iE '^(unit|scope|card|issue|labels|after|type|area):' "$TASKF"; [ "$BRANCH" != "agent/$SLUG" ] && echo "branch: $BRANCH"
      [ -n "$WDOG" ] && echo "agent: $(wd_alt)"
      echo "$TASK" | tail -n +2
      [ -n "$WDOG" ] && printf '\n## Watchdog (attempt 1 on %s/%s stopped)\n%s. The previous agent looped; take a different approach.\nLast log lines:\n```\n%s\n```\n' "$L" "$(cfg lane "$L" agent)" "$WDOG" "$(tail -n 20 "$LOG" | sed 's/```//g')"; } > "$QB"
    sleep 1   # file newer than our events (lane-guard drop rule)
    if [ -n "$DEF" ]; then
      if QW --dir "$QD" --name "$(basename "$Q")" "$QB" >/dev/null 2>"$QB.err"; then ev deferred "$L" "failed on $L; unit is deferred ($(basename "$DEF")), retry parked in deferred/ ($Q)"
        echo "$(date '+%F %T') $SLUG: retry parked in deferred/ ($(basename "$Q")), matches $(basename "$DEF")" >> "$OPS/logs/dispatch-chain.log"
      else ev failed "$L" "deferred retry write rejected: $(tr '\n' ' ' < "$QB.err" | cut -c1-200)"; fi
    elif QW --name "$(basename "$Q")" "$QB" >/dev/null 2>"$QB.err"; then ev requeued "$L" "failed on $L; brief back in queue ($Q)"
    else ev failed "$L" "requeue rejected: $(tr '\n' ' ' < "$QB.err" | cut -c1-200)"
      echo "$(date '+%F %T') $ID: requeue of '$BT' rejected by queue-write: $(tr '\n' ' ' < "$QB.err")" >> "$OPS/NEEDS_CODY"; fi
    rm -f "$QB" "$QB.err"
  else ev requeued "$L" "failed on $L; already re-queued ($DUP)"; fi
  [ -n "$DEF" ] && { echo "DEFERRED after: $L -> $QD (unit is deferred by policy; not re-queued)"; exit 1; }
  echo "REQUEUED after: $L -> $OPS/queue (lane-guard dispatches it to a free lane)"; exit 1; fi
ERR=$(tail -n 5 "$LOG" | tr '\t\n' '  ')
printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$TITLE" "${TRIED# }" "$ERR" "$LOG" >> "$OPS/failures.tsv"
echo "$(date '+%F %T') $ID: $TITLE (lanes:$TRIED) log $LOG" >> "$OPS/NEEDS_CODY"
BU verify "$SLUG" failed; BU drop "$SLUG" "abandoned: failed on$TRIED"; ev needs_cody "${TRIED# }" "$LOG"; echo "FAILED after:$TRIED -> $OPS/NEEDS_CODY"; exit 1
