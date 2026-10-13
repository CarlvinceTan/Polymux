#!/bin/bash
# queue-write.sh: the one writer for the lane queue ($LANES_HOME/queue and its siblings).
# Every create, move or delete of a queue file goes through here, under one lock, so lane-guard,
# run-lane and Cody never interleave (no lost requeues, no half-written briefs, no stray .tmp).
#
#   queue-write.sh [--dir D] [--name N] [--force] [--no-check] [FILE|-]
#        validate a brief (FILE or stdin) and write it atomically (temp file + rename) as D/N.
#        D defaults to $LANES_HOME/queue; N defaults to FILE's name, else <mmddHHMMSS>-<slug>.task.
#        An existing D/N is never overwritten unless --force. --no-check skips validation and is
#        refused for the queue itself (meant for queue-hold/ copies of old-format briefs).
#   queue-write.sh --check FILE...   validate only (one line per problem, exit 2 if any is bad)
#   queue-write.sh --fix FILE...     in place, under the lock: move the "# title" line to the top
#                                    when only header lines (needs:, branch:, ...) come before it
#   queue-write.sh --mv SRC DEST     locked rename (DEST may be a directory)
#   queue-write.sh --rm FILE...      locked delete
# A valid brief: line 1 is "# <title>"; it has "needs: <x>" and "expected_min: <minutes>"; no
# "branch:" line above the title; "after:" refs are pr:<N> or branch-on-main:<branch> (or "none");
# a "pr:" line is <N>, #<N> or a github.com/.../pull/<N> URL.
# Lock: flock(1) on $LANES_HOME/queue.lock when flock exists (Homebrew path tried too, since launchd
# PATH lacks it), else a mkdir lock ($LANES_HOME/queue.lock.d, stale-pid reclaim from lanelib.sh).
# Exit: 0 ok, 1 usage/io, 2 invalid brief, 3 lock timeout (QUEUE_LOCK_WAIT, 30 s), 4 target exists,
# 5 source gone.
set -uo pipefail
SD=$(cd "$(dirname "$0")" && pwd)
OPS=${LANES_HOME:-$HOME/ops/lanes}; Q=$OPS/queue
LOCK=${QUEUE_LOCK:-$OPS/queue.lock}; WAIT=${QUEUE_LOCK_WAIT:-30}
die() { echo "queue-write: $1" >&2; exit "${2:-1}"; }
HDR='unit|needs|scope|expected_min|card|branch|after|pr|priority'

validate() {  # $1 file, $2 label -> problems on stdout, rc 1 if any
  awk -v L="$2" '
    function bad(m) { e[++n] = m }
    NR == 1 && !/^# [^ ]/ { bad("line 1 must be a \"# title\" (got \"" substr($0, 1, 60) "\")") }
    !t && /^# [^ ]/ { t = NR }
    !t && /^branch:/ { bad("branch: line " NR " comes before the title") }
    /^needs:/ { if ($0 ~ /^needs: *[^ ]/) nd = 1; else bad("needs: is empty (line " NR ")") }
    /^expected_min:/ { ex = 1; if ($0 !~ /^expected_min: *[0-9]+ *$/) bad("expected_min must be whole minutes (line " NR ")") }
    /^after:/ { s = $0; sub(/^after: */, "", s); m = split(s, a, /[ ,]+/); k = 0
      for (i = 1; i <= m; i++) { if (a[i] == "") continue; k++
        if (a[i] == "none") continue
        if (a[i] !~ /^pr:[0-9]+$/ && a[i] !~ /^branch-on-main:[A-Za-z0-9._\/-]+$/)
          bad("after: ref \"" a[i] "\" is not pr:<N> or branch-on-main:<branch> (line " NR ")") }
      if (!k) bad("after: is empty (line " NR ")") }
    /^pr:/ { s = $0; sub(/^pr: */, "", s); sub(/ +$/, "", s)
      if (s !~ /^#?[0-9]+$/ && s !~ /^https:\/\/github\.com\/[^\/ ]+\/[^\/ ]+\/pull\/[0-9]+$/)
        bad("pr: ref \"" s "\" is not <N>, #<N> or a PR URL (line " NR ")") }
    END { if (NR == 0) bad("empty brief")
      else { if (!nd) bad("missing needs: line"); if (!ex) bad("missing expected_min: line") }
      for (i = 1; i <= n; i++) print L ": " e[i]; exit n > 0 }' "$1"
}

FL=$(command -v flock 2>/dev/null || { for c in /opt/homebrew/bin/flock /usr/local/bin/flock; do [ -x "$c" ] && echo "$c" && break; done; })
[ -n "${QUEUE_LOCK_MKDIR:-}" ] && FL=""   # test hook: force the mkdir fallback
locked() {  # run "$@" under the queue lock
  [ -n "${QUEUE_LOCK_HELD:-}" ] && { "$@"; return; }   # caller already holds it
  mkdir -p "$(dirname "$LOCK")" || return 1
  if [ -n "$FL" ]; then
    ( "$FL" -w "$WAIT" 9 || die "queue lock $LOCK busy for ${WAIT}s" 3; QUEUE_LOCK_HELD=1 "$@" ) 9>>"$LOCK"; return; fi
  . "$SD/lanelib.sh"; local k=0 d="$LOCK.d" rc
  until lock_take "$d"; do k=$((k+1)); [ $k -ge $((WAIT*10)) ] && die "queue lock $d busy for ${WAIT}s (pid $(lock_holder "$d"))" 3; sleep 0.1; done
  ( QUEUE_LOCK_HELD=1 "$@" ); rc=$?; lock_drop "$d"; return $rc   # subshell: a die inside still drops the lock
}
put() {  # $1 content file, $2 dir, $3 name ('' = derive), $4 force
  local d=$2 n=$3 slug base i=1 tmp
  mkdir -p "$d" || return 1
  if [ -z "$n" ]; then slug=$(head -1 "$1" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-*//' | cut -c1-32 | sed 's/-*$//')
    base="$(date +%m%d%H%M%S)-${slug:-brief}"; n="$base.task"
    while [ -e "$d/$n" ]; do i=$((i+1)); n="$base-$i.task"; done; fi
  [ -e "$d/$n" ] && [ -z "$4" ] && die "$d/$n already exists (use --force to replace)" 4
  tmp=$(mktemp "$d/.queue-write.XXXXXX") || return 1   # dot name: never matched by *.task readers
  cat "$1" > "$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$d/$n" || { rm -f "$tmp"; die "write to $d/$n failed"; }
  echo "$d/$n"
}
move() { [ -e "$1" ] || die "$1 is gone (moved by someone else?)" 5
  local t=$2; [ -d "$t" ] && t="$t/$(basename "$1")"
  [ -e "$t" ] && [ -z "$FORCE" ] && die "$t already exists" 4
  mv -f "$1" "$t" && echo "$t"; }
remove() { local f rc=0; for f in "$@"; do [ -e "$f" ] || { echo "queue-write: $f is gone" >&2; rc=5; continue; }; rm -f "$f"; done; return $rc; }
fix_one() {  # move the title to the top when only header/blank lines precede it
  local f=$1 t tmp; validate "$f" "$f" >/dev/null && { echo "ok: $f"; return 0; }
  t=$(awk '/^# [^ ]/{print NR; exit}' "$f")
  [ -n "$t" ] && awk -v t="$t" -v h="^($HDR):" 'NR<t && $0!~h && $0!~/^[ \t]*$/{x=1} END{exit x}' "$f" ||
    { echo "not fixed (needs a human): $f"; validate "$f" "  $f"; return 2; }
  tmp=$(mktemp "$(dirname "$f")/.queue-write.XXXXXX") || return 1
  awk -v t="$t" -v h="^($HDR):" 'NR==t{print; for(i=1;i<=k;i++) print H[i]; next} NR<t{if($0~h) H[++k]=$0; next} {print}' "$f" > "$tmp"
  if validate "$tmp" "$f" >/dev/null; then touch -r "$f" "$tmp"; chmod 644 "$tmp"; mv -f "$tmp" "$f"; echo "fixed: $f"; return 0; fi   # keep mtime: lane-guard's drop rule compares it
  rm -f "$tmp"; echo "not fixed (still invalid after reorder): $f"; validate "$f" "  $f"; return 2; }
fix() { local f rc=0; for f in "$@"; do fix_one "$f" || rc=2; done; return $rc; }

DIR=$Q; NAME=""; FORCE=""; NOCHECK=""; MODE=write
while [ $# -gt 0 ]; do case $1 in
  --dir) DIR=$2; shift 2;; --name) NAME=$2; shift 2;; --force) FORCE=1; shift;; --no-check) NOCHECK=1; shift;;
  --check|--fix|--mv|--rm) MODE=${1#--}; shift; break;;
  -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
  --) shift; break;; -) break;; -*) die "unknown option $1 (see --help)";; *) break;; esac; done
case $MODE in
  check) [ $# -gt 0 ] || die "--check needs a file"; rc=0
    for f in "$@"; do validate "$f" "$f" || rc=2; done; exit $rc;;
  fix) [ $# -gt 0 ] || die "--fix needs a file"; locked fix "$@"; exit;;
  mv) [ $# = 2 ] || die "--mv SRC DEST"; locked move "$1" "$2"; exit;;
  rm) [ $# -gt 0 ] || die "--rm needs a file"; locked remove "$@"; exit;;
esac
[ $# -le 1 ] || die "one brief at a time"
SRC=${1:--}; IN=$(mktemp) || exit 1; trap 'rm -f "$IN"' EXIT
if [ "$SRC" = - ]; then cat > "$IN"; else [ -f "$SRC" ] || die "no such brief: $SRC"; cat "$SRC" > "$IN"; [ -n "$NAME" ] || NAME=$(basename "$SRC"); fi
case $NAME in */*) die "--name must be a plain file name";; esac
LABEL=${NAME:-${SRC/#-/stdin}}
if [ -n "$NOCHECK" ]; then
  [ -d "$DIR" ] && [ "$(cd "$DIR" && pwd -P)" = "$(cd "$Q" 2>/dev/null && pwd -P)" ] && die "--no-check is not allowed for $Q"
elif ! validate "$IN" "$LABEL" >&2; then echo "queue-write: rejected $LABEL (nothing written)" >&2; exit 2; fi
locked put "$IN" "$DIR" "$NAME" "$FORCE"
