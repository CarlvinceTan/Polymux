#!/bin/bash
# board-update.sh [--dry-run] <event> <unit> [arg...]   Polymux GitHub Project 3 (users/CarlvinceTan/projects/3),
# written by the lanes with `gh api graphql`. Event-driven only: one call per lane event, no polling.
#   card   <unit> <task-file>   map the unit to an issue: the brief's "issue: N" header, else its legacy
#          "card:" id looked up in the local map $BOARD_MAP (id<TAB>issue<TAB>issue-node; built from
#          board-migration.json, lives on cvmini only, never written to GitHub). Stored in $OPS/cards/<unit>.
#   issue  <unit>               print the unit's issue number (no network); run-lane adds "Closes #N".
#   start  <unit>               Status -> "In progress", only from Backlog/Proposals/empty
#   pr     <unit> <pr-url>      the PR becomes a Project item (Status "In review"); the issue item gets the
#          PR text field and Status "In review". A unit with no issue is tracked through its PR item.
#   verify <unit> <level> [..]  Verification (exact option: UI-verified|unit-test-verified|build-only|blocked|failed)
#   review <unit>               Status -> "In review" (approved, in the merge queue)
#   requeued <unit>             Status -> "In progress" (post-approval re-verify failed; fix attempt)
#   merged <unit>               Status -> "Done" (caller confirms mergedAt first)
#   drop   <unit> [reason]      forget an abandoned unit (mapping + shared-issue ledger rows)
# Shared issues: several units on one issue; merged/verify write only once every unit got there, and
# Verification is the weakest level. Ledger $OPS/board/card-<issue>.tsv, per-issue lock.
# Kill switch: live only while $OPS/BOARD_LIVE exists (rm it = dry run, the exact write is logged).
# Reads: only what finds the item (issue/PR node id when not in the map). addProjectV2ItemById is
# idempotent and returns the item's current Status, so "start never moves backwards" costs no extra read.
# Guard: Notion URLs and Notion page ids are scrubbed from every value sent (notion_scrub, lanelib.sh, shared with gh_write).
# Always exits 0; errors become board_error events (events.tsv + stdout for the lane log). Auth: gh's own.
set -uo pipefail
SD=$(cd "$(dirname "$0")" && pwd); . "$SD/lanelib.sh"
OPS=${LANES_HOME:-$HOME/ops/lanes}; mkdir -p "$OPS/cards" "$OPS/board"
BOARD_MAP=${BOARD_MAP:-$OPS/board-map.tsv}; REPO_SLUG=${BOARD_REPO:-CarlvinceTan/polymux}
PROJ=${BOARD_PROJECT_ID:-PVT_kwHOCDGEdM4Bmy5s}
: ${F_STATUS:=PVTSSF_lAHOCDGEdM4Bmy5szhlabM8}; : ${F_VER:=PVTSSF_lAHOCDGEdM4Bmy5szhlabeg}; : ${F_PR:=PVTF_lAHOCDGEdM4Bmy5szhlabjc}
opt() { case $1 in Proposals) echo 5acdac3d;; Backlog) echo 483c23c2;; "In progress") echo 65b9edf8;; "In review") echo abdef12c;; Done) echo c1f2c7d6;;
  UI-verified) echo f9b24fa7;; unit-test-verified) echo 38201913;; build-only) echo 0f2c4aa2;; blocked) echo b8e8ce46;; failed) echo 77449e23;; esac; }
DRY=0; DA=""; [ "${1:-}" = --dry-run ] && { DRY=1; DA=--dry-run; shift; }
[ -f "$OPS/BOARD_LIVE" ] || DRY=1
EVT=${1:-}; UNIT=${2:-}; shift 2 2>/dev/null || true
_ev() { local m; m=$(printf '%s' "$2" | tr '\t\n' '  ')
  printf '%s board %s %s: %s\n' "$(date '+%F %T')" "$UNIT" "$EVT" "$m" >> "$OPS/board.log"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%F %T')" "$UNIT" "$1" "$EVT" "$m" >> "$OPS/events.tsv"; }
log() { _ev board "$*"; }
err() { _ev board_error "$*"; echo "board_error: $UNIT $EVT: $*"; }
[ -n "$EVT" ] && [ -n "$UNIT" ] || { echo "usage: board-update.sh [--dry-run] card|issue|start|pr|verify|review|requeued|merged|drop <unit> [arg]" >&2; exit 0; }
legacy_id() { echo "${1%%\?*}" | grep -oiE '[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}' | tail -1 | tr -d - | tr A-F a-f; }
map_issue() { [ -n "$1" ] && awk -F'\t' -v k="$1" '$1==k{print $2; exit}' "$BOARD_MAP" 2>/dev/null; }
# issue_of UNIT: issue number from cards/<unit> (a number; a legacy id there is translated through the map)
issue_of() { local v; v=$(cat "$OPS/cards/$1" 2>/dev/null); case $v in ""|*[!0-9]*) map_issue "$(legacy_id "$v")";; *) echo "$v";; esac; }
if [ "$EVT" = card ]; then
  N=$(sed -n 's/^[Ii]ssue: *#\{0,1\}\([0-9][0-9]*\).*/\1/p' "${1:-/dev/null}" 2>/dev/null | head -1)
  [ -n "$N" ] || N=$(map_issue "$(legacy_id "$(sed -n 's/^card: *//p' "${1:-/dev/null}" 2>/dev/null | head -1)")")
  if [ -n "$N" ]; then echo "$N" > "$OPS/cards/$UNIT"; log "issue #$N"; else rm -f "$OPS/cards/$UNIT"; log "skip: no issue: header (or mapped card:) in brief"; fi
  exit 0; fi
[ "$EVT" = issue ] && { issue_of "$UNIT"; exit 0; }
ISSUE=$(issue_of "$UNIT"); PRNODE=$(cat "$OPS/cards/$UNIT.pr" 2>/dev/null)
archived() { local f; for f in "$OPS"/queue/archive/*.task; do [ -f "$f" ] || continue
  case ${f##*/} in *-"$1".task) return 0;; esac; grep -qx "unit: *$(printf '%s' "$1" | sed 's/[][\\.*^$]/\\&/g')" "$f" && return 0; done; return 1; }
forget() { awk -F'\t' -v u="$1" '$1!=u' "$CLED" > "$CLED.tmp" && mv "$CLED.tmp" "$CLED"; rm -f "$OPS/cards/$1" "$OPS/cards/$1.pr"; }  # caller holds the card lock
if [ "$EVT" = drop ]; then
  [ -n "$ISSUE" ] || { rm -f "$OPS/cards/$UNIT.pr"; log "skip: unit has no issue"; exit 0; }
  CL="$OPS/board/card-$ISSUE.lock"; CLED="$OPS/board/card-$ISSUE.tsv"; n=0
  until lock_take "$CL"; do n=$((n+1)); [ $n -ge "${BOARD_LOCK_TRIES:-10}" ] && { err "card lock busy (pid $(lock_holder "$CL")); not dropped"; exit 0; }; sleep 1; done
  touch "$CLED"; forget "$UNIT"; RE=$(awk -F'\t' '$2=="merged"||$2=="verify"{print $2"\t"$1"\t"$3}' "$CLED" | sort -u -k1,1); lock_drop "$CL"
  log "dropped from issue #$ISSUE (${1:-abandoned}); it no longer waits for this unit"
  while IFS=$'\t' read -r e u v; do [ -n "$u" ] && [ -f "$OPS/cards/$u" ] || continue
    if [ "$e" = merged ]; then bash "$0" $DA merged "$u"; else bash "$0" $DA verify "$u" "$v"; fi; done <<< "$RE"
  exit 0; fi
PRURL=""
case $EVT in
  start|requeued) FID=$F_STATUS; VAL="In progress";;
  review) FID=$F_STATUS; VAL="In review";;
  merged) FID=$F_STATUS; VAL=Done;;
  pr)     FID=$F_STATUS; VAL="In review"; PRURL=${1:-}; [ -n "$PRURL" ] || { err "no PR url given"; exit 0; };;
  verify) FID=$F_VER; VAL=${1:-}
          case $VAL in UI-verified|unit-test-verified|build-only|blocked|failed) ;;
            *) err "level '$VAL' is not a board option; not written"; exit 0;; esac;;
  *) err "unknown event"; exit 0;;
esac
[ -n "$ISSUE" ] || [ -n "$PRNODE" ] || [ -n "$PRURL" ] || { log "skip: no issue for unit (brief had no issue: header or mapped card:)"; exit 0; }
[ -n "$PRURL" ] && PRURL=$(printf '%s\n' "$PRURL" | notion_scrub)   # scrub, never refuse
rank() { case $1 in UI-verified) echo 3;; unit-test-verified) echo 2;; build-only) echo 1;; *) echo 0;; esac; }
if [ -n "$ISSUE" ] && { [ "$EVT" = merged ] || [ "$EVT" = verify ]; }; then
  CL="$OPS/board/card-$ISSUE.lock"; CLED="$OPS/board/card-$ISSUE.tsv"; n=0
  until lock_take "$CL"; do n=$((n+1)); [ $n -ge "${BOARD_LOCK_TRIES:-10}" ] && { err "card lock busy (pid $(lock_holder "$CL")); not written"; exit 0; }; sleep 1; done
  touch "$CLED"; { awk -F'\t' -v u="$UNIT" -v e="$EVT" '!($1==u&&$2==e)' "$CLED"; printf '%s\t%s\t%s\n' "$UNIT" "$EVT" "$VAL"; } > "$CLED.tmp" && mv "$CLED.tmp" "$CLED"
  WAITU=""; LOW=""; MEM=()
  for f in "$OPS"/cards/*; do case $f in *.wt|*.pr) continue;; esac; [ -f "$f" ] || continue; m=${f##*/}
    [ "$(issue_of "$m")" = "$ISSUE" ] || continue
    if [ "$m" != "$UNIT" ] && archived "$m"; then forget "$m"; log "dropped archived unit $m from issue #$ISSUE"; continue; fi; MEM+=("$m"); done
  for m in "${MEM[@]}"; do v=$(awk -F'\t' -v u="$m" -v e="$EVT" '$1==u&&$2==e{print $3}' "$CLED")
    if [ -z "$v" ]; then WAITU="$WAITU $m"; elif [ -z "$LOW" ] || [ "$(rank "$v")" -lt "$(rank "$LOW")" ]; then LOW=$v; fi; done
  lock_drop "$CL"
  if [ -n "$WAITU" ]; then log "hold: not written; issue #$ISSUE waits for unit(s):$WAITU"; exit 0
  elif [ "$EVT" = verify ] && [ "$LOW" != "$VAL" ]; then log "issue #$ISSUE shared by ${#MEM[@]} units: Verification '$LOW' (weakest), not '$VAL'"; VAL=$LOW; FID=$F_VER; fi
fi
L="$OPS/board/$UNIT.lock"; n=0
until lock_take "$L"; do n=$((n+1)); [ $n -ge "${BOARD_LOCK_TRIES:-10}" ] && { err "unit lock busy (pid $(lock_holder "$L")); not written"; exit 0; }; sleep 1; done
trap 'lock_drop "$L"' EXIT
gql() { gh api graphql "$@"; }
# add_item NODE -> "<item-id>\t<Status>" (idempotent: an existing item is returned as is)
add_item() { gql -f query='mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}' \
  -f p="$PROJ" -f c="$1" --jq '.data.addProjectV2ItemById.item | "\(.id)\t\(.fieldValueByName.name // "")"'; }
set_select() { gql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}' \
  -f p="$PROJ" -f i="$1" -f f="$2" -f o="$3" >/dev/null; }
set_text() { local t; t=$(printf '%s\n' "$3" | notion_scrub)   # scrub Notion links/ids, never refuse
  gql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$t:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{text:$t}}){projectV2Item{id}}}' \
  -f p="$PROJ" -f i="$1" -f f="$2" -f t="$t" >/dev/null; }
content_node() { case $1 in ""|null|PVTI_*) return 1;; *) return 0;; esac; }
issue_node() { local n; n=$(awk -F'\t' -v k="$1" '$2==k && $3!=""{print $3; exit}' "$BOARD_MAP" 2>/dev/null)
  content_node "$n" || n=$(cat "$OPS/board/issue-$1.node" 2>/dev/null)
  content_node "$n" || { n=$(gql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}' \
    -f o="${REPO_SLUG%%/*}" -f r="${REPO_SLUG#*/}" -F n="$1" --jq .data.repository.issue.id) && content_node "$n" && echo "$n" > "$OPS/board/issue-$1.node"; }
  content_node "$n" && echo "$n"; }
NAME="the issue #$ISSUE item"; [ -n "$ISSUE" ] || NAME="the PR item"
if [ $DRY = 1 ]; then
  [ -n "$PRURL" ] && log "DRY-RUN would add PR $PRURL to project 3 (Status 'In review')${ISSUE:+; PR field of #$ISSUE = $PRURL}"
  if [ "$EVT" = start ]; then log "DRY-RUN would set Status of $NAME -> '$VAL' (only from Backlog/Proposals/empty)"
  else log "DRY-RUN would set $([ "$FID" = "$F_VER" ] && echo Verification || echo Status) of $NAME -> '$VAL'"; fi
  exit 0; fi
if [ -n "$PRURL" ]; then
  PN=$(gh pr view "$PRURL" --json id -q .id 2>/dev/null) && [ -n "$PN" ] || { err "PR node lookup failed ($PRURL); nothing written"; exit 0; }
  echo "$PN" > "$OPS/cards/$UNIT.pr"; PRNODE=$PN
  R=$(add_item "$PN") || { err "adding the PR to project 3 failed"; exit 0; }
  [ "${R#*$'\t'}" = "In review" ] || set_select "${R%%$'\t'*}" "$F_STATUS" "$(opt "In review")" || err "PR item Status write failed"
  log "PR item ${R%%$'\t'*} on project 3"
  [ -n "$ISSUE" ] || exit 0; fi
if [ -n "$ISSUE" ]; then NODE=$(issue_node "$ISSUE") || { err "issue #$ISSUE node lookup failed; nothing written"; exit 0; }
else NODE=$PRNODE; fi
R=$(add_item "$NODE") || { err "adding $NAME to project 3 failed; nothing written"; exit 0; }
ITEM=${R%%$'\t'*}; CUR=${R#*$'\t'}
[ -n "$PRURL" ] && { set_text "$ITEM" "$F_PR" "$PRURL" && log "wrote PR field: $PRURL" || err "PR field write failed"; }
if [ "$FID" = "$F_STATUS" ] && [ "$CUR" = "$VAL" ]; then log "skip: Status already '$VAL'"
elif [ "$EVT" = start ] && case $CUR in Backlog|Proposals|"") false;; *) true;; esac; then
  log "skip: Status is '$CUR'; start only moves items out of Backlog/Proposals, never backwards"
elif set_select "$ITEM" "$FID" "$(opt "$VAL")"; then log "wrote $([ "$FID" = "$F_VER" ] && echo Verification || echo Status) of $NAME: '$VAL'"
else err "write '$VAL' failed"; fi
exit 0
