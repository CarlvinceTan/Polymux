#!/bin/bash
# lane-guard: failure rules for the Polymux local-lanes flow (Cody's scripts/run-lane.sh; plan section 6). No LLM.
#   lane-guard --task-end <lane> <task-id> <rc> <log>  hook after verify.sh (Cody adds it, non-fatal). rc 0 = ok.
#     1st failure of a task -> re-queue: $OPS/queue/<task-id>.task = brief (title " (attempt 2)", so run-lane's failures.tsv stop rule
#     doesn't refuse it) + "## Previous attempt failed" + last 60 log lines, secrets redacted. 2nd failure -> no re-queue, alert Chief once.
#     Breaker: 3 failures with one signature, or >30% of 5+ tasks failing -> $OPS/PAUSE + alert once.
#   lane-guard --preflight <lane> <task>   before a task starts: PAUSE -> no; lane-gate rc 1/2 -> defer (logged, not a failure).
#   lane-guard --dispatch --free-lane <l>  prefer lane <l> (skips the busy check unless a unit lock is held on it), else rotate.
#   max_concurrent (lanes.toml, default 1): a lane is busy, and --preflight/--free-lane refuse it, only once it holds that many unit locks.
#   task header 'after: none' or an empty 'after:' = no dependency. 'after: pr:N branch-on-main:<b> ...': task stays queued until PR N is MERGED / a merged PR has head <b> (squash+delete) or <b> is in origin/main (errors = unmet, logged).
#   lane-guard --dispatch [lane]           run-lane unit end (event-driven, any exit) + launchd lane-dispatch (600 s backstop); dispatch.lock (busy -> one queued re-run);
#                                          skips (leaves queued, tries the next card) units in queue-hold, at the retry cap (2 failures), refused
#                                          recently or by 'run-lane.sh --check', with unmet after:, or whose unit lock is held; 3 refusals in a
#                                          row within 60 s ($O/refusals.tsv) = storm: stop + log; rotates lanes.py order over free lanes;
#                                          passes --branch from a 'branch:' line; card -> starting/ -> started/ only once lock/events row seen (20s), else back to queue; drops queue entries whose task passed/started/is running (events.tsv, units/*.lock),
#                                          else preflights (PAUSE, lane-gate) and starts ONE via run-lane.sh <lane> <file> (nohup), as Cody does.
#   lane-guard --deps <task-file>...     dry check of after: deps (MET/UNMET), no dispatch.
#   lane-guard --stall                     launchd 30 min: exits unless active (queue/ or a unit lock, no PAUSE); alerts once if no PR in 3h.
#   lane-guard --queued | --progress
# Ledger: $ST/tasks.tsv (epoch lane task rc sig log); only rows after $ST/cutoff (set on first run) count: fresh window.
# run-lane.sh has no global pause; $OPS/PAUSE is honoured by --preflight/--dispatch. Alerts via alert-mail (email) -> ~/ops/events/lane-guard.jsonl.
# Test overrides: LANES_HOME LANE_GUARD_EVENTS LANE_GUARD_STATE LANE_GUARD_NOW LANE_GUARD_PROGRESS LANE_GATE RUN_LANE.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/code/agents/bin"
O=${LANES_HOME:-$HOME/ops/lanes}; LANES_REPO=${LANES_REPO:-$HOME/code/proj/Polymux}; Q=$O/queue; EV=${LANE_GUARD_EVENTS:-$HOME/ops/events}/lane-guard.jsonl
ST=${LANE_GUARD_STATE:-$HOME/.local/state/lane-guard}; NOW=${LANE_GUARD_NOW:-$(date +%s)}; RL="$HOME/.local/bin/runlog"; [ -n "$LANE_GUARD_STATE" ] && RL=:
HX='vault read failed|worktree add failed|push failed|aborted by operator|unknown agent|Terminated|no build slot'
mkdir -p "$ST" "$Q"; touch "$ST/keys" "$ST/tasks.tsv"; [ -s "$ST/cutoff" ] || echo "$NOW" > "$ST/cutoff"; CUT=$(cat "$ST/cutoff")
once(){ grep -qxF "$1" "$ST/keys" && return 1; echo "$1" >> "$ST/keys"; }
alert(){ alert-mail "$EV" "$@"; }
log(){ echo "$(date '+%F %T') $*" >> "$ST/lane-guard.log"; echo "$*"; }
queued(){ ls "$Q"/*.task >/dev/null 2>&1; }
deferred_hit(){ # $1 base title, $2 task id: print the $O/deferred/*.task (parked by policy) that is this unit; title or slug match
  local f t st sl; sl=$(echo "$2" | sed -E 's/^[0-9]+-+//; s/-retry(-[0-9]+)?$//'); for f in "$O"/deferred/*.task; do [ -f "$f" ] || continue
    st=$(basename "$f" .task | sed -E 's/^[0-9]+-+//; s/-retry(-[0-9]+)?$//')
    t=$(grep -viE '^(unit|needs|scope|expected_min|card|issue|labels|branch|after|type|area|queue-note):' "$f" | head -1 | sed -E 's/ \(attempt [0-9]+\)$//')
    { [ "$t" = "$1" ] || [ "$st" = "$sl" ]; } && { echo "$f"; return 0; }; done; return 1; }
# Queue writes go through Polymux scripts/queue-write.sh (one lock shared with run-lane; atomic; briefs validated).
QWH=${QUEUE_WRITE:-$LANES_REPO/scripts/queue-write.sh}
qmv(){ if [ -f "$QWH" ]; then bash "$QWH" --force --mv "$1" "$2" >/dev/null; else mv "$1" "$2"; fi; }
# Briefs with no "needs:" line get a default inserted (logged) and are dispatched, instead of being refused by run-lane.
# Polymux brief mentioning macOS/iOS/Swift/SwiftUI/Xcode, or touching apps/ios|apps/macos -> xcode,swift; else from paths
# (apps/server -> go); Polymux fallback xcode,swift (other repos: none). Written via queue-write.sh, else temp + mv; mtime kept.
infer_needs(){ local p poly=""; echo "${LANES_REPO##*/}" | grep -qi polymux && poly=1
  p=$( { sed -n 's/^scope: *//p' "$1"; grep -oE 'apps/[A-Za-z0-9_.-]+' "$1"; } | tr ',' '\n')
  echo "$p" | grep -qiE 'apps/(ios|macos)' && { echo xcode,swift; return; }
  [ -n "$poly" ] && grep -qiE '(^|[^a-z])(macos|ios|swift|swiftui|xcode)([^a-z]|$)' "$1" && { echo xcode,swift; return; }
  echo "$p" | grep -qE 'apps/server' && { echo go; return; }
  [ -n "$poly" ] && echo xcode,swift || echo none; }
ensure_needs(){ local f=$1 n tmp ref; grep -qE '^needs:' "$f" && return 0; n=$(infer_needs "$f")
  tmp=$(mktemp "$ST/needs.XXXXXX"); ref=$(mktemp "$ST/needs-ref.XXXXXX"); touch -r "$f" "$ref"
  awk -v n="$n" 'NR==1{print; print "needs: " n; next} 1' "$f" > "$tmp" || { rm -f "$tmp" "$ref"; return 1; }
  if [ -f "$QWH" ]; then bash "$QWH" --dir "$(dirname "$f")" --name "$(basename "$f")" --force "$tmp" >/dev/null || { rm -f "$tmp" "$ref"; return 1; }; rm -f "$tmp"
  else mv "$tmp" "$f.needs-tmp" && mv "$f.needs-tmp" "$f"; fi
  touch -r "$ref" "$f"; rm -f "$ref"; log "dispatch: $(basename "$f" .task): no needs: line; inserted default 'needs: $n'"; }
qrm(){ if [ -f "$QWH" ]; then bash "$QWH" --rm "$1"; else rm -f "$1"; fi; }
progress(){ [ -n "$LANE_GUARD_PROGRESS" ] && { echo "$LANE_GUARD_PROGRESS"; return; }
  gh pr list -R CarlvinceTan/polymux --state all --author @me --limit 30 --json createdAt,mergedAt | jq '[.[]|.createdAt,.mergedAt|select(.)|fromdateiso8601]|max//0' | grep -E '^[1-9][0-9]+$'; }
redact(){ sed -E 's/(sk-|ghp_|gho_|github_pat_|xox[bp]-|crsr_|key_)[A-Za-z0-9_-]{8,}/[REDACTED]/g; s/((api[_-]?key|token|secret|password|authorization|bearer)[=: "]{1,3})[^ "]+/\1[REDACTED]/Ig'; }
slug(){ echo "$1" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-*//' | cut -c1-32 | sed 's/-*$//'; }   # = run-lane.sh SLUG after Polymux #64
slugo(){ echo "$1" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | cut -c1-32 | sed 's/^-*//; s/-*$//'; }   # pre-#64 form ('-mj-...' with dash stripped)
strip(){ echo "$1" | sed 's/^-*//; s/-*$//'; }
# Unit names are compared dash-stripped; locks are checked as units/<n>.lock and units/-<n>.lock (pre-#64), so both forms match.
# A lock counts as held only while its holder is alive (same rule as Polymux run-lane #72): a lock whose pid file
# names a dead process (SIGKILL, crash) is stale and holds nothing. No pid file yet = a run mid-claim: held.
lk(){ local c d p; for c in $C; do for d in "$c" "-$c"; do [ -d "$O/units/$d.lock" ] || continue
  p=$(cat "$O/units/$d.lock/pid" 2>/dev/null); [ -n "$p" ] && ! kill -0 "$p" 2>/dev/null && continue
  echo "units/$d.lock"; return 0; done; done; return 1; }
evm(){ awk -F'\t' -v C=" $C " '{s=$2;sub(/^[0-9]+-/,"",s);gsub(/^-+|-+$/,"",s)} index(C," "s" ")' "$@"; }   # events.tsv rows for any name in $C
title(){ awk -F'\t' -v i="$1" '$2==i&&$3=="queued"{t=$5}END{n="";e="";k=index(t," (needs=");if(k){m=substr(t,k+8);t=substr(t,1,k-1);c=index(m,", expected=");n=substr(m,1,c-1);e=substr(m,c+11);sub(/m\)$/,"",e)}print t"\t"n"\t"e}' "$O/events.tsv" 2>/dev/null; }
maxc(){ local v; v=$(python3 "$LANES_REPO/scripts/lanes.py" lane "$1" max_concurrent 2>/dev/null); case $v in ''|*[!0-9]*|0) echo 1;; *) echo "$v";; esac; }   # lanes.toml max_concurrent, default 1
lane_count(){ # $1 lane -> number of unit locks held by units whose LATEST events.tsv row is on that lane (keyed like lane_held)
  awk -F'\t' '$2~/^[0-9]+-/{u=$2;sub(/^[0-9]+-/,"",u);gsub(/^-+|-+$/,"",u);ln[u]=$4} END{for(u in ln) print u"\t"ln[u]}' "$O/events.tsv" 2>/dev/null |
    while IFS=$'\t' read -r u l; do [ "$l" = "$1" ] || continue; C=$u; lk; done | sort -u | wc -l | tr -d ' '; }
lane_held(){ # $1 lane -> prints the unit lock held by a unit whose latest events.tsv row is on that lane (guard until Polymux #69)
  # Locks are named by unit (units/<slug>.lock), not by lane, and one unit can run under many ids (<ts>-<slug>) on
  # different lanes. Key on the dash-stripped unit name so only the unit's LATEST row decides its lane: an older
  # lane4 attempt of repo-1 must not make lane3's live repo-1.lock count against lane4.
  awk -F'\t' '$2~/^[0-9]+-/{u=$2;sub(/^[0-9]+-/,"",u);gsub(/^-+|-+$/,"",u);ln[u]=$4} END{for(u in ln) print u"\t"ln[u]}' "$O/events.tsv" 2>/dev/null |
    while IFS=$'\t' read -r u l; do [ "$l" = "$1" ] || continue; C=$u; lk && break; done; }
deps_ok(){ # $1 task file: every 'after:' ref must be met; gh results cached per run; a check error counts as unmet (logged)
  local r n st; for r in $(sed -n 's/^after: *//p' "$1"); do case $r in
    none|NONE|-) continue;;   # 'after: none' (and an empty after:) = no dependency
    pr:*) n=${r#pr:}; st=$(awk -v n="$n" '$1==n{print $2}' "$DC")
      if [ -z "$st" ]; then st=$(gh pr view "$n" -R CarlvinceTan/polymux --json state -q .state 2>/dev/null) || st=ERROR; echo "$n ${st:-ERROR}" >> "$DC"; fi
      [ "$st" = ERROR ] && log "dispatch: $(basename "$1"): gh pr view $n failed; treating as unmet" >&2
      [ "$st" = MERGED ] || { echo "$r ($st)"; return 1; };;
    branch-on-main:*) n=${r#branch-on-main:}; h=${n#origin/}; st=$(awk -v n="b:$h" '$1==n{print $2}' "$DC")   # squash-merged + deleted: a merged PR with head <b> counts
      if [ -z "$st" ]; then st=$(gh pr list -R CarlvinceTan/polymux --state merged --head "$h" --json number --limit 1 -q '.[0].number // "none"' 2>/dev/null) || st=ERROR; echo "b:$h ${st:-ERROR}" >> "$DC"; fi
      [ "$st" = ERROR ] && log "dispatch: $(basename "$1"): gh merged-PR lookup for $h failed; trying ancestry" >&2
      case $st in ''|none|ERROR) ;; *) continue;; esac
      [ -f "$DC.f" ] || { git -C "$LANES_REPO" fetch -q origin 2>/dev/null || log "dispatch: git fetch failed" >&2; : > "$DC.f"; }
      git -C "$LANES_REPO" merge-base --is-ancestor "$n" origin/main 2>/dev/null; st=$?
      [ $st -gt 1 ] && log "dispatch: $(basename "$1"): merge-base check for $n failed (rc $st); treating as unmet" >&2
      [ $st = 0 ] || { echo "$r"; return 1; };;
    *) log "dispatch: $(basename "$1"): unknown after ref '$r'; treating as unmet" >&2; echo "$r"; return 1;; esac; done; return 0; }
case $1 in
--deps) DC=$(mktemp); trap 'rm -f "$DC" "$DC.f"' EXIT; shift   # dry check: are the after: deps of these task files met? never dispatches
  for f; do if w=$(deps_ok "$f"); then echo "MET    $(basename "$f")"; else echo "UNMET  $(basename "$f"): $w"; fi; done; exit 0;;
-h|--help) sed -n '2,/^export PATH/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0;;
--queued) queued; exit;;
--progress) progress; exit;;
--preflight) [ -f "$O/PAUSE" ] && { log "preflight $2 ${3:-}: PAUSE set; not starting"; exit 1; }
  n=$(lane_count "$2"); mc=$(maxc "$2"); [ "${n:-0}" -ge "$mc" ] && { log "preflight $2 ${3:-}: lane already holds $n unit(s) (max_concurrent $mc; $(lane_held "$2")); not starting"; exit 1; }
  ${LANE_GATE:-lane-gate} >/dev/null 2>&1; g=$?
  case $g in 1|2) log "preflight $2 ${3:-}: lane-gate rc=$g; deferred (not a failure)"; exit 1;; esac; exit 0;;
--dispatch) [ -z "$LANE_GUARD_STATE" ] && "$HOME/.local/bin/slot-reaper" >> "$ST/lane-guard.log" 2>&1   # stale build slots/markers (no-op in tests)
  # launchd com.carlvince.lane-dispatch (10 min) and run-lane unit end (PR #56). One dispatch at a time (lock); a pass fills every free slot across lanes (up to max_concurrent each).
  # Event-driven: run-lane calls this (detached, debounced 3 s) the moment a unit exits; the 600 s tick is a backstop.
  # Lock busy -> leave $O/dispatch.pending; the holder re-runs one pass when it finishes, so a refill is never lost.
  DL=$O/dispatch.lock; PEND=$O/dispatch.pending
  if ! mkdir "$DL" 2>/dev/null; then kill -0 "$(cat "$DL/pid" 2>/dev/null)" 2>/dev/null && { touch "$PEND"; echo "dispatch already running; re-run queued"; exit 0; }
    rm -rf "$DL"; mkdir "$DL" 2>/dev/null || exit 0; fi; echo $$ > "$DL/pid"; rm -f "$PEND"; trap 'rm -rf "$DL"' EXIT
  fin(){ rm -rf "$DL" "$DC" "$DC.f"; [ -f "$PEND" ] && [ "${LG_RERUN:-0}" -lt 5 ] && { rm -f "$PEND"; log "dispatch: re-run for a refill that arrived during this pass"
    LG_RERUN=$(( ${LG_RERUN:-0} + 1 )) nohup "$0" --dispatch >/dev/null 2>&1 </dev/null & }; return 0; }
  # Storm guard: run-lane appends each refusal to $O/refusals.tsv (cleared when a unit takes its lock).
  RF=$O/refusals.tsv; SN=${LANE_STORM_N:-3}; SW=${LANE_STORM_WIN_S:-60}
  storm(){ [ "$(awk -F'\t' -v c=$((NOW-SW)) '$1>=c' "$RF" 2>/dev/null | wc -l | tr -d ' ')" -ge "$SN" ]; }
  storm && { log "dispatch: STORM: $SN+ units refused in a row within ${SW}s ($(cut -f2,3 "$RF" | tail -3 | tr '\t\n' ': ')); not dispatching until it clears (600 s tick)"; exit 0; }
  shift; LN=""; FREE=""; while [ $# -gt 0 ]; do case $1 in --free-lane) FREE=${2:-}; shift; shift;; *) LN=$1; shift;; esac; done
  DC=$(mktemp); FETCHED=""; trap fin EXIT
  RLB=${RUN_LANE:-$LANES_REPO/scripts/run-lane.sh}; RCK=""; grep -q -- '--check' "$RLB" 2>/dev/null && RCK=1   # run-lane's own refusal rules, side-effect free
  RCF=$ST/refused-cards   # "<epoch> <id>": a card whose child run-lane refused is skipped for SW s
  held_titles=$(for h in "$O"/queue-hold/*.task; do [ -f "$h" ] && grep -vE '^(unit|needs|scope|expected_min|branch|after|card):' "$h" | head -1 | sed -E 's/ \(attempt [0-9]+\)$//'; done)
  busy=$(for l in $(python3 "$LANES_REPO/scripts/lanes.py" order 2>/dev/null); do [ "$(lane_count "$l")" -ge "$(maxc "$l")" ] && echo "$l"; done | sort -u)   # busy only at max_concurrent; same count as --preflight
  ORD=$(python3 "$LANES_REPO/scripts/lanes.py" order 2>/dev/null); ORD=${ORD:-lane1}; last=$(cat "$ST/last-lane" 2>/dev/null)
  rot=$(echo $ORD | tr ' ' '\n' | awk -v l="$last" '{a[NR]=$0; if($0==l)k=NR} END{for(n=1;n<=NR;n++) print a[(k+n-1)%NR+1]}')
  if [ -z "$LN" ] && [ -n "$FREE" ]; then   # --free-lane: caller says this lane is free; trust it unless it is at max_concurrent
    held=""; [ "$(lane_count "$FREE")" -ge "$(maxc "$FREE")" ] && held=$(lane_held "$FREE")
    if [ -z "$held" ]; then LN=$FREE; else log "dispatch: --free-lane $FREE ignored, lock held ($held)"; fi; fi
  PIN=""; [ -z "$FREE" ] && PIN=$LN; NSTART=0; NOLANE=""   # PIN: explicit lane argument -> fill only that lane's slots
  # pick_lane: next lane with a free slot (count < max_concurrent, recounted live) that preflight hasn't ruled out this pass
  pick_lane(){ local l; for l in ${PIN:-$FREE $rot}; do echo "$NOLANE" | grep -qxF "$l" && continue
      [ "$(lane_count "$l")" -lt "$(maxc "$l")" ] && { LN=$l; return 0; }; done; LN=""; return 1; }
  if [ -z "$LN" ]; then for l in $rot; do echo "$busy" | grep -qxF "$l" || { LN=$l; break; }; done; fi
  [ -n "$LN" ] || { log "dispatch: all lanes busy"; exit 0; }
  for f in "$Q"/*.task; do [ -f "$f" ] || continue; id=$(basename "$f" .task); t=$(grep -vE '^(unit|needs|scope|expected_min|branch|after):' "$f" | head -1)
    b=$(echo "$t" | sed -E 's/ \(attempt [0-9]+\)$//'); C=$(for x in "$b" "$t"; do echo "$(slug "$x") $(slugo "$x")"; done; echo "$(strip "${id#*-}")"); C=$(echo $C | tr ' ' '\n' | sort -u | tr '\n' ' '); m=$(date -r "$f" '+%Y%m%d%H%M%S')
    why=$(evm "$O/events.tsv" 2>/dev/null | awk -F'\t' -v m="$m" '{
        if($3=="pr"||$3=="dry"){print "already passed ("$2" "$3")";exit} if($3=="requeued"||$3=="superseded"||$3=="board")next; ts=$1;gsub(/[-: ]/,"",ts); if(ts>=m){print "attempt already started ("$2" "$3")";exit}}')
    [ -z "$why" ] && awk -F'\t' -v b="$b" '$7==b&&$4==0{f=1}END{exit !f}' "$ST/tasks.tsv" && why="passed (lane-guard ledger)"
    if [ -n "$why" ]; then mkdir -p "$Q/dropped"; qmv "$f" "$Q/dropped/"; log "dispatch: dropped $id: $why"; continue; fi
    # Skip (leave in queue, try the next card in this pass) anything run-lane would refuse or must not start.
    skip(){ log "dispatch: skip $id: $*; trying next"; }
    u=$(lk) && { skip "unit lock held ($u)"; continue; }
    [ -n "$held_titles" ] && echo "$held_titles" | grep -qxF "$b" && { skip "in queue-hold"; continue; }
    nf=$(awk -F'\t' -v c="$CUT" -v b="$b" '$1>=c&&$7==b&&$4!=0' "$ST/tasks.tsv" | wc -l | tr -d ' ')
    { [ "$nf" -ge 2 ] || awk -F'\t' -v t="$t" -v b="$b" '$2==t||$2==b||$2==b" (attempt 2)"{f=1}END{exit !f}' "$O/failures.tsv" 2>/dev/null; } && { skip "at retry cap (failed twice)"; continue; }
    awk -v c=$((NOW-SW)) -v i="$id" '$1>=c&&$2==i{f=1}END{exit !f}' "$RCF" 2>/dev/null && { skip "refused by run-lane <${SW}s ago"; continue; }
    w=$(deps_ok "$f") || { log "dispatch: $id waits: after $w unmet; left in queue"; continue; }
    ensure_needs "$f" || log "dispatch: $id: could not insert default needs: line"
    [ -n "$RCK" ] && { r=$("$RLB" --check "$LN" "$f" 2>&1 </dev/null); rc=$?; [ $rc = 0 ] || { skip "run-lane preflight refuses (rc $rc: $(echo "$r" | tail -1 | cut -c1-120))"; continue; }; }
    while ! "$0" --preflight "$LN" "$id"; do   # lane-level (PAUSE, max_concurrent, lane-gate): no card can start on this lane
      [ -f "$O/PAUSE" ] && exit 0; NOLANE="$NOLANE"$'\n'"$LN"; pick_lane || { log "dispatch: no free slot left (started $NSTART this pass)"; exit 0; }; done
    br=$(sed -n 's/^branch: *//p' "$f" | head -1); mkdir -p "$Q/starting" "$Q/started" "$O/logs"; qmv "$f" "$Q/starting/" || exit 1; sf=$Q/starting/$id.task
    ev0=$(wc -l < "$O/events.tsv" 2>/dev/null || echo 0); rf0=$(cat "$RF" 2>/dev/null | wc -l | tr -d ' '); DLOG=$O/logs/dispatch-$id.log
    nohup "$RLB" "$LN" "$sf" ${br:+--branch "$br"} >> "$DLOG" 2>&1 </dev/null & pid=$!
    ok=""; for k in $(seq 1 ${DISPATCH_WAIT:-20}); do sleep 1
      u=$(lk) && ok="lock $u"
      [ -z "$ok" ] && tail -n +$((ev0+1)) "$O/events.tsv" 2>/dev/null | evm | grep -q . && ok="events row"
      [ -n "$ok" ] && break; kill -0 $pid 2>/dev/null || break; done
    if [ -n "$ok" ]; then qmv "$sf" "$Q/started/"; echo "$LN" > "$ST/last-lane"
      log "dispatch: started $id on $LN${br:+ --branch $br} (pid $pid, confirmed by $ok, log $DLOG)"; $RL carl-lane-dispatch ok "$id" 0 n "$LN"
    else kill $pid 2>/dev/null; qmv "$sf" "$Q/"; log "dispatch: $id NOT confirmed within ${DISPATCH_WAIT:-20}s (child $(kill -0 $pid 2>/dev/null && echo alive || echo dead)); card put back in queue, log $DLOG; trying next"
      $RL carl-lane-dispatch failed "$id" 0 n "child not confirmed"; echo "$NOW $id" >> "$RCF"
      [ "$(cat "$RF" 2>/dev/null | wc -l | tr -d ' ')" -gt "$rf0" ] || printf '%s\t%s\t%s\n' "$NOW" "$id" unconfirmed >> "$RF"   # run-lane logs its own refusals
      storm && { log "dispatch: STORM: $SN units refused in a row within ${SW}s; stopping this pass"; exit 1; }; continue; fi
    # Fill EVERY free slot: after a confirmed start, move on to the next lane slot (same lane while it is under
    # max_concurrent, then the rotation) and keep going through the queue. Ends when no slot or no runnable card is left.
    NSTART=$((NSTART+1)); pick_lane || { log "dispatch: all slots filled (started $NSTART this pass)"; exit 0; }
  done; exit 0;;
--stall) { [ -f "$O/PAUSE" ] || { ! queued && ! ls -d "$O"/units/*.lock >/dev/null 2>&1; }; } && { echo "idle: paused or nothing queued/running"; exit 0; }
  p=$(progress) || { $RL carl-lane-guard failed stall 0 n "gh failed"; exit 1; }
  if [ $((NOW-p)) -gt 10800 ]; then once "stall:$p" && { alert no_progress "Polymux lanes: no PR opened or merged for $(( (NOW-p)/3600 ))h while tasks are queued/running"; exit 0; }
    echo "stall already alerted"; else echo "ok: last PR activity $(( (NOW-p)/60 ))m ago"; fi; exit 0;;
--task-end) [ "$NOW" -lt "$CUT" ] && { log "task-end $3: before fresh-window cutoff, ignored"; exit 0; };;
*) echo "usage: lane-guard --task-end <lane> <task-id> <rc> <log> | --preflight <lane> <task> | --dispatch [lane | --free-lane <lane>] | --stall | --queued | --progress" >&2; exit 2;;
esac
LN=$2 ID=$3 RC=$4 LG=$5; IFS=$'\t' read -r T NEEDS EXP <<< "$(title "$ID")"; T=${T:-$ID}; BASE=$(echo "$T" | sed -E 's/ \(attempt [0-9]+\)$//')
S=$(tail -n 40 "$LG" 2>/dev/null | grep -iE 'error|fail|fatal' | tail -1 | redact | sed -E 's#(https?:|/)[^ ):]*##g; s/[0-9]+/N/g; s/ +/ /g' | cut -c1-120); S=${S:-rc=$RC}
if [ "$RC" != 0 ] && grep -qE "$HX" <(tail -n 40 "$LG" 2>/dev/null); then log "task-end $ID rc=$RC: harness/env failure, not counted"; exit 0; fi
awk -F'\t' -v i="$ID" '$3==i{f=1}END{exit !f}' "$ST/tasks.tsv" && { log "task-end $ID: already recorded (idempotent)"; exit 0; }
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$NOW" "$LN" "$ID" "$RC" "$S" "$LG" "$BASE" >> "$ST/tasks.tsv"
W(){ awk -F'\t' -v c="$CUT" '$1>=c' "$ST/tasks.tsv"; }
[ "$RC" = 0 ] && for q in "$Q"/*.task; do [ -f "$q" ] && grep -qxF "$BASE (attempt 2)" "$q" && qrm "$q" && log "task-end $ID ok: dropped stale re-queue $(basename "$q")"; done
if [ "$RC" != 0 ]; then n=$(W | awk -F'\t' -v b="$BASE" '$7==b&&$4!=0' | wc -l | tr -d ' ')
  if [ "$n" = 1 ]; then f=$Q/$ID.task
    rq(){ echo "$BASE (attempt 2)"; echo "needs: ${NEEDS:-none}"; echo "expected_min: ${EXP:-60}"; echo; echo "## Previous attempt failed"   # title first
      echo "lane $LN, rc $RC, log $LG (last 60 lines, secrets redacted):"; tail -n 60 "$LG" 2>/dev/null | redact; }
    DEF=$(deferred_hit "$BASE" "$ID")
    if [ -n "$DEF" ]; then f=$O/deferred/$ID.task   # unit parked by policy (e.g. dogfood-first): retry goes beside it, never back to queue/
      if [ ! -f "$QWH" ]; then rq > "$f"; log "DEFERRED $ID -> $f (matches $(basename "$DEF")); not re-queued"
      elif err=$(rq | bash "$QWH" --dir "$O/deferred" --force --name "$ID.task" - 2>&1 >/dev/null); then log "DEFERRED $ID -> $f (matches $(basename "$DEF")); not re-queued"
      else log "DEFERRED $ID: write to deferred/ rejected by queue-write: $(echo "$err" | tr '\n' ' ')"; fi
    elif [ ! -f "$QWH" ]; then rq > "$f"; log "REQUEUE $ID -> $f"
    elif err=$(rq | bash "$QWH" --force --name "$ID.task" - 2>&1 >/dev/null); then log "REQUEUE $ID -> $f"
    else log "REQUEUE $ID rejected by queue-write: $(echo "$err" | tr '\n' ' ')"; once "rq:$ID" && alert lane_escalation "re-queue of '$BASE' rejected: $(echo "$err" | head -2 | paste -sd'|' -)" "$LN" "$ID"; fi
  elif [ "$n" -ge 2 ]; then once "esc:$BASE" && alert lane_escalation "task '$BASE' failed $n times: $(W | awk -F'\t' -v b="$BASE" '$7==b&&$4!=0{print $5" ("$6")"}' | tail -2 | paste -sd'|' -)" "$LN" "$ID"; fi
fi
s=$(W | awk -F'\t' '$4!=0{c[$5]++}END{for(k in c)if(c[k]>=3)print c[k]"\t"k}' | head -1)
[ -n "$s" ] && once "sig:${s#*	}" && { echo "lane-guard $(date '+%F %T'): ${s%%	*} x '${s#*	}'" > "$O/PAUSE"; log "PAUSE: 3 identical failures"; alert lane_pause "Polymux lanes paused: ${s%%	*} failures with '${s#*	}'" "$LN" "$ID"; }
set -- $(W | awk -F'\t' '{o[$7]=$4}END{for(k in o){n++;if(o[k]!=0)x++}print n+0,x+0}')
if [ "$1" -ge 5 ] && [ $(($2*10)) -gt $(($1*3)) ]; then once rate && { echo "lane-guard $(date '+%F %T'): $2/$1 failing" > "$O/PAUSE"; log "PAUSE: failure rate $2/$1"; alert lane_pause "Polymux lanes paused: $2 of $1 tasks failing (>30%)" "$LN" "$ID"; }
else sed -i '' '/^rate$/d' "$ST/keys" 2>/dev/null; fi
$RL carl-lane-guard ok "task-end rc=$RC" 0 n "$LN $ID"; exit 0
