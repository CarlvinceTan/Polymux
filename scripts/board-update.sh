#!/bin/bash
# board-update.sh [--dry-run] <event> <unit> [arg...]   Polymux Notion board, written by the lanes.
#   start  <unit>                     Status   -> "In Progress"
#   pr     <unit> <pr-url>            PR (url) -> <pr-url>
#   verify <unit> <level> [media...]  Verification -> level (exact board option); media = verify.sh
#                                     proof URLs, appended to the card body as images (once each)
#   merged <unit>                     Status   -> "Completed"
#   card   <unit> <task-file>         remember the brief's "card:" line (URL or id) for <unit>
# Ships disabled: writes only when $OPS/BOARD_LIVE exists; otherwise (or with --dry-run) it logs the
# exact intended write. One write per event, read-before-write (skip if equal), per-unit lock.
# Never fails the caller: always exits 0; errors go to $OPS/board.log and events.tsv.
# Token: vault entry "Notion - Polymux integration token" (same as goal-loop relay.sh); it lives only
# in a shell variable and reaches curl through stdin (-K -), never argv, files or logs.
set -uo pipefail
SD=$(cd "$(dirname "$0")" && pwd); . "$SD/lanelib.sh"
OPS=${LANES_HOME:-$HOME/ops/lanes}; mkdir -p "$OPS/cards" "$OPS/board"
VAULT_ITEM=${BOARD_VAULT_ITEM:-"Notion - Polymux integration token"}
API=${NOTION_API:-https://api.notion.com/v1}; NV=2022-06-28
DRY=0; [ "${1:-}" = --dry-run ] && { DRY=1; shift; }
[ -f "$OPS/BOARD_LIVE" ] || DRY=1
EVT=${1:-}; UNIT=${2:-}; shift 2 2>/dev/null || true
log() { local m; m=$(printf '%s' "$*" | tr '\t\n' '  ')
  printf '%s board %s %s: %s\n' "$(date '+%F %T')" "$UNIT" "$EVT" "$m" >> "$OPS/board.log"
  printf '%s\t%s\tboard\t%s\t%s\n' "$(date '+%F %T')" "$UNIT" "$EVT" "$m" >> "$OPS/events.tsv"; }
[ -n "$EVT" ] && [ -n "$UNIT" ] || { echo "usage: board-update.sh [--dry-run] start|pr|verify|merged|card <unit> [arg]" >&2; exit 0; }
page_id() { echo "${1%%\?*}" | grep -oiE '[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}' | tail -1 | tr -d - | tr A-F a-f | sed -E 's/(.{8})(.{4})(.{4})(.{4})(.{12})/\1-\2-\3-\4-\5/'; }
if [ "$EVT" = card ]; then
  C=$(sed -n 's/^card: *//p' "${1:-/dev/null}" 2>/dev/null | head -1); P=$(page_id "$C")
  if [ -n "$P" ]; then echo "$P" > "$OPS/cards/$UNIT"; log "card $P"; else rm -f "$OPS/cards/$UNIT"; log "skip: no card: line in brief"; fi
  exit 0; fi
PAGE=$(cat "$OPS/cards/$UNIT" 2>/dev/null); MEDIA=()
[ -n "$PAGE" ] || { log "skip: no card for unit (brief had no card: line)"; exit 0; }
case $EVT in
  start)  PROP=Status; KIND=select; VAL="In Progress";;
  merged) PROP=Status; KIND=select; VAL=Completed;;
  pr)     PROP=PR; KIND=url; VAL=${1:-}; [ -n "$VAL" ] || { log "skip: no PR url"; exit 0; };;
  verify) PROP=Verification; KIND=select; VAL=${1:-}; shift || true
          case $VAL in UI-verified|unit-test-verified|build-only|blocked|failed) ;;
            *) log "error: level '$VAL' is not a board option; not written"; exit 0;; esac; MEDIA=("$@");;
  *) log "error: unknown event"; exit 0;;
esac
TOK=$(vault get "$VAULT_ITEM" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' 2>/dev/null) || TOK=""
api() {  # api METHOD PATH [curl args]; token via stdin config (-K -), body via --data (not secret)
  local m=$1 p=$2; shift 2
  printf 'header = "Authorization: Bearer %s"\n' "$TOK" | curl -sS -f -m 20 -K - -X "$m" \
    -H "Notion-Version: $NV" -H "Content-Type: application/json" "$@" "$API/$p"; }
L="$OPS/board/$UNIT.lock"; n=0
until lock_take "$L"; do n=$((n+1)); [ $n -ge "${BOARD_LOCK_TRIES:-10}" ] && { log "error: unit lock busy (pid $(lock_holder "$L")); not written"; exit 0; }; sleep 1; done
trap 'lock_drop "$L"' EXIT
CUR="?"; HAVE=""
if [ -n "$TOK" ]; then
  J=$(api GET "pages/$PAGE") && CUR=$(printf '%s' "$J" | python3 -c '
import json,sys; p=json.load(sys.stdin)["properties"][sys.argv[1]]
v=p.get("select") if p["type"]=="select" else p.get(p["type"])
print((v or {}).get("name","") if isinstance(v,dict) else (v or ""))' "$PROP" 2>/dev/null) || { CUR="?"; log "warn: read failed for $PROP"; }
  if [ ${#MEDIA[@]} -gt 0 ]; then HAVE=$(api GET "blocks/$PAGE/children?page_size=100" 2>/dev/null) || HAVE=""; fi
elif [ $DRY = 0 ]; then log "error: vault read failed ($VAULT_ITEM); not written"; exit 0; fi
if [ "$KIND" = select ]; then BODY="{\"properties\":{\"$PROP\":{\"select\":{\"name\":\"$VAL\"}}}}"
else BODY=$(python3 -c 'import json,sys; print(json.dumps({"properties":{sys.argv[1]:{"url":sys.argv[2]}}}))' "$PROP" "$VAL"); fi
if [ "$CUR" = "$VAL" ]; then log "skip: $PROP already '$VAL'"
elif [ $DRY = 1 ]; then log "DRY-RUN would PATCH pages/$PAGE $PROP: '$CUR' -> '$VAL' body=$BODY"
else api PATCH "pages/$PAGE" --data "$BODY" >/dev/null && log "wrote $PROP: '$CUR' -> '$VAL'" || log "error: write $PROP='$VAL' failed"; fi
NEW=(); for u in ${MEDIA[@]+"${MEDIA[@]}"}; do case $u in https://*) ;; *) log "skip media (not a verify.sh proof URL): $u"; continue;; esac
  printf '%s' "$HAVE" | grep -qF "$u" && { log "skip media: already on card: $u"; continue; }; NEW+=("$u"); done
[ ${#NEW[@]} -gt 0 ] || exit 0
MB=$(python3 -c 'import json,sys
b=[{"type":"image","image":{"type":"external","external":{"url":u}}} if u.split("?")[0].endswith(".png") else
   {"type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":u,"link":{"url":u}}}]}} for u in sys.argv[1:]]
print(json.dumps({"children":b}))' "${NEW[@]}")
if [ $DRY = 1 ]; then log "DRY-RUN would PATCH blocks/$PAGE/children append ${#NEW[@]} proof item(s): ${NEW[*]}"
else api PATCH "blocks/$PAGE/children" --data "$MB" >/dev/null && log "appended ${#NEW[@]} proof item(s)" || log "error: proof append failed"; fi
exit 0
