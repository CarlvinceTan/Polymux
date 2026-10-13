#!/bin/bash
# board-update.sh [--dry-run] <event> <unit> [arg...]   Polymux Notion board, written by the lanes.
#   card   <unit> <task-file>          remember the brief's "card:" line (Notion URL or page id)
#   start  <unit>                      Status -> "In Progress", only from Backlog/Proposals/Not started/empty
#   pr     <unit> <pr-url>             PR (url)
#   verify <unit> <level> [proof-dir url-base]   Verification (exact option) + proof media: files in
#          proof-dir that pass media-check.py, deduped by sha256 (ledger $OPS/board/<unit>.media and
#          a "proof sha256:" caption on the card), appended as image/video blocks at url-base/<file>.
#          Only files listed (one name per line) in proof-dir/approved are appended; no list = no media;
#          .mov is never appended; only files publish_proof uploaded (proof-dir/uploaded) are appended.
#          media-check exit != 0 (missing Pillow/ffmpeg) -> board_error, nothing appended.
#   merged <unit>                      Status -> "Completed" (caller confirms mergedAt first)
# merged/verify on a card shared by several units wait for all of them (see "Shared cards" below).
# Ships disabled: live only when $OPS/BOARD_LIVE exists AND $GOAL_LOOP_HOME/RELAY_HOLD exists (old relay
# held, so never two writers); otherwise logs the exact intended write. Read-before-write: a failed read
# skips the write. One write per event, per-unit lanelib lock. Always exits 0; errors become board_error
# events (events.tsv + stdout for the lane log). Token: vault "Notion - Polymux integration token" (as
# goal-loop relay.sh), held in a shell variable and given to curl on stdin (-K -), never argv/files/logs.
set -uo pipefail
SD=$(cd "$(dirname "$0")" && pwd); . "$SD/lanelib.sh"
OPS=${LANES_HOME:-$HOME/ops/lanes}; GL=${GOAL_LOOP_HOME:-$HOME/ops/goal-loop}; mkdir -p "$OPS/cards" "$OPS/board"
VAULT_ITEM=${BOARD_VAULT_ITEM:-"Notion - Polymux integration token"}
API=${NOTION_API:-https://api.notion.com/v1}; NV=2022-06-28
DRY=0; [ "${1:-}" = --dry-run ] && { DRY=1; shift; }
[ -f "$OPS/BOARD_LIVE" ] || DRY=1
EVT=${1:-}; UNIT=${2:-}; shift 2 2>/dev/null || true
_ev() { local m; m=$(printf '%s' "$2" | tr '\t\n' '  ')
  printf '%s board %s %s: %s\n' "$(date '+%F %T')" "$UNIT" "$EVT" "$m" >> "$OPS/board.log"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$UNIT" "$1" "$EVT" "$m" >> "$OPS/events.tsv"; }
log() { _ev board "$*"; }
err() { _ev board_error "$*"; echo "board_error: $UNIT $EVT: $*"; }
[ -n "$EVT" ] && [ -n "$UNIT" ] || { echo "usage: board-update.sh [--dry-run] card|start|pr|verify|merged <unit> [arg]" >&2; exit 0; }
page_id() { echo "${1%%\?*}" | grep -oiE '[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}' | tail -1 | tr -d - | tr A-F a-f | sed -E 's/(.{8})(.{4})(.{4})(.{4})(.{12})/\1-\2-\3-\4-\5/'; }
if [ "$EVT" = card ]; then
  C=$(sed -n 's/^card: *//p' "${1:-/dev/null}" 2>/dev/null | head -1); P=$(page_id "$C")
  if [ -n "$P" ]; then echo "$P" > "$OPS/cards/$UNIT"; log "card $P"; else rm -f "$OPS/cards/$UNIT"; log "skip: no card: line in brief"; fi
  exit 0; fi
PAGE=$(cat "$OPS/cards/$UNIT" 2>/dev/null); PDIR=""; PBASE=""
[ -n "$PAGE" ] || { log "skip: no card for unit (brief had no card: line)"; exit 0; }
case $EVT in
  start)  PROP=Status; KIND=select; VAL="In Progress";;
  merged) PROP=Status; KIND=select; VAL=Completed;;
  pr)     PROP=PR; KIND=url; VAL=${1:-}; [ -n "$VAL" ] || { err "no PR url given"; exit 0; };;
  verify) PROP=Verification; KIND=select; VAL=${1:-}; PDIR=${2:-}; PBASE=${3:-}
          case $VAL in UI-verified|unit-test-verified|build-only|blocked|failed) ;;
            *) err "level '$VAL' is not a board option; not written"; exit 0;; esac;;
  *) err "unknown event"; exit 0;;
esac
# Shared cards: several units can map to one card (cards/<unit> holds the same page id). 'merged' and
# 'verify' write only once every unit on the card has reached that state, and Verification is the
# weakest level (failed/blocked < build-only < unit-test-verified < UI-verified). 'start'/'pr' write
# on the first unit. Ledger: $OPS/board/card-<page>.tsv (unit<TAB>event<TAB>value), per-card lock.
rank() { case $1 in UI-verified) echo 3;; unit-test-verified) echo 2;; build-only) echo 1;; *) echo 0;; esac; }
HOLD=""
if [ "$EVT" = merged ] || [ "$EVT" = verify ]; then
  CL="$OPS/board/card-$PAGE.lock"; CLED="$OPS/board/card-$PAGE.tsv"; n=0
  until lock_take "$CL"; do n=$((n+1)); [ $n -ge "${BOARD_LOCK_TRIES:-10}" ] && { err "card lock busy (pid $(lock_holder "$CL")); not written"; exit 0; }; sleep 1; done
  touch "$CLED"; { awk -F'\t' -v u="$UNIT" -v e="$EVT" '!($1==u&&$2==e)' "$CLED"; printf '%s\t%s\t%s\n' "$UNIT" "$EVT" "$VAL"; } > "$CLED.tmp" && mv "$CLED.tmp" "$CLED"
  WAITU=""; LOW=""; MEM=()
  for f in "$OPS"/cards/*; do case $f in *.wt) continue;; esac; [ -f "$f" ] && [ "$(cat "$f")" = "$PAGE" ] && MEM+=("${f##*/}"); done
  for m in "${MEM[@]}"; do v=$(awk -F'\t' -v u="$m" -v e="$EVT" '$1==u&&$2==e{print $3}' "$CLED")
    if [ -z "$v" ]; then WAITU="$WAITU $m"; elif [ -z "$LOW" ] || [ "$(rank "$v")" -lt "$(rank "$LOW")" ]; then LOW=$v; fi; done
  lock_drop "$CL"
  if [ -n "$WAITU" ]; then HOLD=1; log "hold: $PROP not written; card $PAGE waits for unit(s):$WAITU"
    [ "$EVT" = verify ] && [ -n "$PDIR" ] || exit 0
  elif [ "$EVT" = verify ] && [ "$LOW" != "$VAL" ]; then log "card $PAGE shared by ${#MEM[@]} units: Verification '$LOW' (weakest), not '$VAL'"; VAL=$LOW; fi
fi
[ $DRY = 0 ] && [ ! -f "$GL/RELAY_HOLD" ] && { err "refusing live write: $GL/RELAY_HOLD is missing (old relay may be writing)"; exit 0; }
TOK=$(vault get "$VAULT_ITEM" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' 2>/dev/null) || TOK=""
[ -n "$TOK" ] || { err "vault read failed ($VAULT_ITEM); nothing read or written"; exit 0; }
api() {  # api METHOD PATH [curl args]; token via stdin config (-K -), body via --data (not secret)
  local m=$1 p=$2; shift 2
  printf 'header = "Authorization: Bearer %s"\n' "$TOK" | curl -sS -f -m 20 -K - -X "$m" \
    -H "Notion-Version: $NV" -H "Content-Type: application/json" "$@" "$API/$p"; }
blocks() { local cur="" j; while :; do   # every child block, following next_cursor; rc 1 on any failure
  j=$(api GET "blocks/$PAGE/children?page_size=100${cur:+&start_cursor=$cur}") || return 1; printf '%s\n' "$j"
  cur=$(printf '%s' "$j" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("next_cursor") or "" if d.get("has_more") else "")') || return 1
  [ -n "$cur" ] || return 0; done; }
L="$OPS/board/$UNIT.lock"; n=0
until lock_take "$L"; do n=$((n+1)); [ $n -ge "${BOARD_LOCK_TRIES:-10}" ] && { err "unit lock busy (pid $(lock_holder "$L")); not written"; exit 0; }; sleep 1; done
trap 'lock_drop "$L"' EXIT
if [ -z "$HOLD" ]; then
CUR=$(api GET "pages/$PAGE" | python3 -c '
import json,sys; p=json.load(sys.stdin)["properties"][sys.argv[1]]
v=p.get("select") if p["type"]=="select" else p.get(p["type"])
print((v or {}).get("name","") if isinstance(v,dict) else (v or ""))' "$PROP" 2>/dev/null) || { err "read of $PROP failed; write skipped"; exit 0; }
if [ "$KIND" = select ]; then BODY="{\"properties\":{\"$PROP\":{\"select\":{\"name\":\"$VAL\"}}}}"
else BODY=$(python3 -c 'import json,sys; print(json.dumps({"properties":{sys.argv[1]:{"url":sys.argv[2]}}}))' "$PROP" "$VAL"); fi
if [ "$CUR" = "$VAL" ]; then log "skip: $PROP already '$VAL'"
elif [ "$EVT" = start ] && case $CUR in Backlog|Proposals|"Not started"|"") false;; *) true;; esac; then
  log "skip: Status is '$CUR'; start only moves cards out of Backlog/Proposals, never backwards"
elif [ $DRY = 1 ]; then log "DRY-RUN would PATCH pages/$PAGE $PROP: '$CUR' -> '$VAL' body=$BODY"
else api PATCH "pages/$PAGE" --data "$BODY" >/dev/null && log "wrote $PROP: '$CUR' -> '$VAL'" || err "write $PROP='$VAL' failed"; fi
fi
[ -n "$PDIR" ] || exit 0
[ -d "$PDIR" ] && case $PBASE in https://*) true;; *) false;; esac || { log "no proof media (dir '$PDIR', base '$PBASE')"; exit 0; }
LED="$OPS/board/$UNIT.media"; touch "$LED"; CAND=()
MC=$(python3 "$SD/media-check.py" "$PDIR" 2>&1); MRC=$?
[ $MRC = 0 ] || { err "media-check failed (rc=$MRC): $(echo "$MC" | tail -1); no media appended"; exit 0; }
while IFS=$'\t' read -r st x f; do [ -n "$f" ] || continue
  if [ "$st" != PASS ]; then log "held media (pre-publish check failed: $x): $f"; continue; fi
  case $f in *.[mM][oO][vV]) log "held media (.mov is not uploaded by publish_proof): $f"; continue;; esac
  grep -qxF "$f" "$PDIR/approved" 2>/dev/null || { log "held media (not in $PDIR/approved): $f"; continue; }
  grep -qxF "$f" "$PDIR/uploaded" 2>/dev/null || { log "held media (not uploaded by publish_proof, $PDIR/uploaded): $f"; continue; }
  grep -qx "$x" "$LED" && { log "skip media: sha256 $x already published ($f)"; continue; }
  CAND+=("$x $f"); done <<< "$MC"
[ ${#CAND[@]} -gt 0 ] || exit 0
HAVE=$(blocks) || { err "blocks read failed; media skipped (nothing appended)"; exit 0; }
NEW=(); for c in "${CAND[@]}"; do printf '%s' "$HAVE" | grep -qF "proof sha256:${c%% *}" && { log "skip media: sha256 ${c%% *} already on card"; continue; }; NEW+=("$c"); done
[ ${#NEW[@]} -gt 0 ] || exit 0
MB=$(python3 -c 'import json,sys
base=sys.argv[1]; out=[]
for c in sys.argv[2:]:
  sha,f=c.split(" ",1); t="video" if f.lower().endswith((".mp4",".mov")) else "image"
  out.append({"type":t,t:{"type":"external","external":{"url":base+"/"+f},"caption":[{"type":"text","text":{"content":"proof sha256:"+sha+" "+f}}]}})
print(json.dumps({"children":out}))' "$PBASE" "${NEW[@]}")
if [ $DRY = 1 ]; then for c in "${NEW[@]}"; do log "DRY-RUN would append to blocks/$PAGE/children $PBASE/${c#* } sha256=${c%% *}"; done
elif api PATCH "blocks/$PAGE/children" --data "$MB" >/dev/null; then
  for c in "${NEW[@]}"; do echo "${c%% *}" >> "$LED"; done; log "appended ${#NEW[@]} proof item(s): ${NEW[*]}"
else err "proof append failed"; fi
exit 0
