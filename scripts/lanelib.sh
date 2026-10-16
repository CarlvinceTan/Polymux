#!/bin/bash
# Shared helpers for run-lane.sh / verify.sh (sourced, not run).
# lock_take DIR: writer lock. mkdir is atomic. A stale lock (dead pid) is reclaimed only by the
# holder of a short-lived gate DIR.reclaim, which re-checks the pid under the gate before replacing
# it, so with any number of racing reclaimers at most one wins and no live lock is ever moved or
# deleted. If anything changed, the reclaimer gives up (returns 1). A gate older than 60 s is a
# dead reclaimer and is cleared (the next attempt can then proceed).
# A lock with no pid file is being created; it counts as stale only after LOCK_GRACE seconds (10).
_mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }   # GNU first: GNU 'stat -f %m' prints '?'
_age() { echo $(( $(date +%s) - $(_mtime "$1") )); }
lock_take() {
  local d=$1 op cur g="$1.reclaim" rc=1
  mkdir -p "$(dirname "$d")"
  if mkdir "$d" 2>/dev/null; then echo $$ > "$d/pid"; return 0; fi
  op=$(cat "$d/pid" 2>/dev/null)
  if [ -z "$op" ]; then [ "$(_age "$d")" -lt "${LOCK_GRACE:-10}" ] && return 1
  elif kill -0 "$op" 2>/dev/null; then return 1; fi
  if ! mkdir "$g" 2>/dev/null; then
    [ "$(_age "$g")" -gt 60 ] && rm -rf "$g"; return 1; fi
  cur=$(cat "$d/pid" 2>/dev/null)
  if [ -d "$d" ] && [ "$cur" = "$op" ] && ! { [ -n "$cur" ] && kill -0 "$cur" 2>/dev/null; }; then
    rm -rf "$d" && mkdir "$d" 2>/dev/null && echo $$ > "$d/pid" && rc=0; fi
  rmdir "$g" 2>/dev/null; return $rc
}
# scope_check BASE "glob,glob": every changed (incl. deleted, nested) file must match one glob.
# set -f so patterns never expand against real files; case patterns match '/' with '*'.
scope_check() {
  local base=$1 bad=0 f g ok; local -a pats; IFS=, read -ra pats <<< "$2"
  set -f
  while IFS= read -r f; do [ -n "$f" ] || continue; ok=0
    for g in "${pats[@]}"; do g=${g# }; case "$f" in $g) ok=1; break;; esac; done
    [ $ok = 1 ] || { echo "outside scope: $f"; bad=1; }
  done < <(git diff --name-only --no-renames "$base"...HEAD)
  set +f; return $bad
}
lock_holder() { cat "$1/pid" 2>/dev/null; }
lock_drop() { [ "$(cat "$1/pid" 2>/dev/null)" = "$$" ] && rm -rf "$1"; return 0; }
# Reclaim through the same gate as lock_take; never delete another live holder.
lock_clear() {
  [ -d "$1" ] || return 0
  if [ "$(lock_holder "$1")" = "$$" ] || lock_take "$1"; then lock_drop "$1"; fi
  return 0
}
# unit_free WT CARD LOCKS LOG: detach with changes kept unless a verifier is live.
unit_free() {
  local wt=$1 card=$2 locks=$3 log=$4 status count d p pre=""
  status=$(git -C "$wt" status --porcelain -uall 2>/dev/null) || return 1
  if [ -n "$status" ]; then
    count=$(printf '%s\n' "$status" | wc -l | tr -d ' '); pre="dirty=$count; "
    printf '%s\t%s\twt_dirty\t%s\t%s dirty=%s\n' "$(date '+%F %T')" "$ID" "$card" "$wt" "$count" >> "$OPS/events.tsv"
  fi
  p=$(lock_holder "$wt/.build/verify.lock")
  if [ -n "$p" ] && [ "$p" != "$$" ] && kill -0 "$p" 2>/dev/null; then
    echo "unit-free: $card wt=$wt ${pre}live verifier pid=$p; kept" >> "$log"; return 0
  fi
  git -C "$wt" switch -q --detach >> "$log" 2>&1 || return 1
  rm -f "$wt/.build/verify-active" "$locks/active/polymux-$(basename "$wt")"
  if [ "$(cat "$OPS/cards/$card.wt" 2>/dev/null)" = "$(basename "$wt")" ]; then rm -f "$OPS/cards/$card.wt"; fi
  lock_clear "$wt/.build/verify.lock"
  for d in "$locks"/slot*; do
    [ "$(cat "$d/wt" 2>/dev/null)" = "$wt" ] && lock_clear "$d"
  done
  if [ -n "$pre" ]; then echo "unit-free: $card wt=$wt ${pre}detached (changes kept)" >> "$log"
  else echo "unit-free: $card wt=$wt detached" >> "$log"; fi
  return 0
}
# Lane scripts changed between BASE and HEAD in the current repo?
# out_has [grep -E opts] PATTERN: does stdin have a matching line? Reads ALL of stdin first, so the writer
# never gets SIGPIPE. (`cmd | grep -q` under pipefail returns 141 when grep exits early on a long output.)
out_has() { local s; s=$(cat); grep -qE "$@" <<< "$s"; }
lane_files_changed() { git diff --name-only "$1"...HEAD | out_has '^(scripts/(run-lane|verify|lanelib|cleanup|dispatch-guard|wt-setup|test-lanes|bootstrap-mac|board-update|test-board|approve-proof|merge-queue|test-merge-queue|review-verdict|queue-write|lane-guard|test-lane-guard)\.sh|scripts/(lanes|media-check|verdict|hold-release|test-hold-release)\.py|agents/lanes\.toml)$'; }
# test-lanes.sh to run: the checkout under test (a PR's own worktree in --verify-only), else ours.
lane_tests_path() { if [ -f "$1/scripts/test-lanes.sh" ]; then echo "$1/scripts/test-lanes.sh"; else echo "$2/test-lanes.sh"; fi; }
branch_lock_dir() { echo "${LANES_HOME:-$HOME/ops/lanes}/branches/$(echo "$1" | tr '/' '%').lock"; }
# owner/repo from origin (git@github.com:o/r.git | https://github.com/o/r[.git])
repo_slug() { git -C "${1:-.}" remote get-url origin | sed -E 's#^(git@[^:]+:|https?://[^/]+/)##; s#\.git$##'; }
# Carl's lane-guard hook; missing = skip, never fatal unless the caller checks rc.
LANE_GUARD=${LANE_GUARD:-$HOME/.local/bin/lane-guard}
guard() { [ -x "$LANE_GUARD" ] || return 0; "$LANE_GUARD" "$@"; }
# --- GitHub labels and Notion-free GitHub writes ---------------------------------------------------
# Shared label set: exactly one type, at least one area, plus dogfood / Flaky test. Priority is a
# Project field, never a label.
LANE_TYPES="feature bug infra test docs"; LANE_AREAS="pairing chat routines server ui lanes"
# brief_labels FILE [NAME] -> comma-separated labels for a gh issue/PR made from this brief.
# type:/area: headers win ("area: ui, server"; the "type:"/"area:" value prefix is optional). Else
# inferred: title with FIX or "bug" -> bug, else feature; needs: xcode -> ui; a server/ or .go path
# -> server; a scripts/ or lanes path -> lanes; nothing matched -> lanes (logged by the caller's gh).
# dogfood: NAME starts 00NN-- or the brief says dogfood. flake: the brief is a deflake task.
# gh_label type|area VALUE -> GitHub label name. Labels are plain title case with no prefix
# (Feature, Bug, Infra, UI, Lanes, ...).
gh_label() { local value allowed item found=""; value=$(printf '%s' "$2" | tr 'A-Z' 'a-z' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'); value=${value#"$1:"}
  value=$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
  case "$1" in type) allowed=$LANE_TYPES;; area) allowed=$LANE_AREAS;; esac
  if [ "$1" = type ] || [ "$1" = area ]; then
    for item in $allowed; do [ "$value" != "$item" ] || found=1; done
    [ -n "$found" ] || return 2
  fi
  case "$1:$value" in
  type:bug) echo Bug;; type:feature) echo Feature;; type:infra) echo Infra;; type:test) echo Test;; type:docs) echo Docs;;
  area:ui) echo UI;; area:*) echo "$value" | awk '{print toupper(substr($0,1,1)) substr($0,2)}';; *) echo "$2";; esac; }
label_list() {
  local item lower label out=""
  while IFS= read -r item; do
    item=$(printf '%s' "$item" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'); [ -n "$item" ] || continue
    lower=$(printf '%s' "$item" | tr 'A-Z' 'a-z')
    case "$lower" in
      type:*) label=$(gh_label type "${lower#type:}") || return 2;;
      area:*) label=$(gh_label area "${lower#area:}") || return 2;;
      feature|bug|infra|test|docs) label=$(gh_label type "$lower");;
      pairing|chat|routines|server|ui|lanes) label=$(gh_label area "$lower");;
      flake|flakytest|"flaky test") label="Flaky test";; dogfood) label=dogfood;;
      *) label=$item;;
    esac
    case ",$out," in *",$label,"*) ;; *) out="${out:+$out,}$label";; esac
  done < <(printf '%s\n' "$1" | tr ',' '\n')
  printf '%s\n' "$out"
}
brief_labels() {
  local f=$1 n=${2:-$(basename "$1")} t a title needs body x out labels
  labels=$(sed -n 's/^[Ll]abels: *//p' "$f" | head -1)
  if [ -n "$labels" ]; then label_list "$labels"; return; fi
  title=$(grep -m1 '^# ' "$f" | sed 's/^# *//'); [ -n "$title" ] || title=$(head -1 "$f")
  t=$(sed -n 's/^type: *//p' "$f" | head -1 | sed 's/^type://; s/[ ,]*$//')
  a=$(sed -n 's/^area: *//p' "$f" | head -1 | tr ',' ' ' | sed 's/area://g')
  needs=$(sed -n 's/^needs: *//p' "$f" | head -1 | tr 'A-Z' 'a-z')
  body=$(grep -vE '^(needs|type|area):' "$f")
  if [ -z "$t" ]; then
    if echo "$title" | grep -qE '(^|[^A-Za-z])FIX([^A-Za-z]|$)' || echo "$title" | grep -qiE '(^|[^a-z])bugs?([^a-z]|$)'; then t=bug; else t=feature; fi; fi
  if [ -z "$(echo $a)" ]; then a=""
    case ",$needs," in *xcode*) a="$a ui";; esac
    echo "$body" | grep -qE '(^|[^A-Za-z0-9_])(apps/)?server/|[A-Za-z0-9_]\.go([^A-Za-z]|$)' && a="$a server"
    echo "$body" | grep -qE '(^|[^A-Za-z0-9_])scripts/|(^|[^A-Za-z0-9_])lanes?([^A-Za-z0-9_]|$)' && a="$a lanes"
    [ -n "$a" ] || a=lanes; fi
  out=$(gh_label type "$t") || return 2; for x in $a; do x=$(gh_label area "$x") || return 2; case ",$out," in *",$x,"*) ;; *) out="$out,$x";; esac; done
  { echo "$n" | grep -qE '^00[0-9][0-9]--' || grep -qi 'dogfood' "$f"; } && out="$out,dogfood"
  grep -qiE 'de-?flake' "$f" && out="$out,Flaky test"
  echo "$out"; }
# Nothing written to GitHub may carry a Notion link or a Notion page id. Narrow on purpose:
#  - links: notion.so / notion.site / app.notion.com URLs (a markdown link keeps its text, a bare URL
#    becomes "[Notion link removed]");
#  - ids: 32-hex or dashed 8-4-4-4-12 ids ONLY when "notion" is within 40 characters on the same line.
#    Other UUIDs, device UDIDs, MD5s and git SHAs pass through untouched.
# Lines are never dropped and writes are never refused: only the link or id itself is scrubbed.
NOTION_PERL='
  my $H = qr/(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{32}|[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})(?![0-9A-Fa-f])/;
  my $U = qr{(?:https?://)?(?:[\w-]+\.)*(?:notion\.so|notion\.site)(?:/[^\s)\]>"`]*)?|(?:https?://)?app\.notion\.com(?:/[^\s)\]>"`]*)?}i;
  sub scrub { my $l = shift;
    $l =~ s{\[([^\]]*)\]\(\s*$U\s*\)}{$1}g;      # [text](notion url) -> text
    $l =~ s{$U}{[Notion link removed]}g;
    1 while $l =~ s{(notion.{0,40}?)$H}{$1\[id removed\]}is;   # id after "notion" (case-insensitive)
    1 while $l =~ s{$H(?=.{0,40}?notion)}{[id removed]}is;     # id before "notion"
    return $l; }'
notion_ref() { perl -e "$NOTION_PERL"'; my $hit = 0; while (my $l = <STDIN>) { $hit = 1 if scrub($l) ne $l } exit($hit ? 0 : 1)'; }   # stdin has a Notion link/id?
notion_scrub() { perl -e "$NOTION_PERL"'; while (my $l = <STDIN>) { print scrub($l) }'; }   # stdin -> stdout, only links/ids replaced
# gh_write <gh args...>: the only way lane scripts write to GitHub. Every argument and any --body-file
# text is scrubbed (notion_scrub) and the write always goes ahead. GH_CMD: test hook.
gh_write() { local -a a=(); local v tmp=""
  while [ $# -gt 0 ]; do case $1 in
    -F|--body-file) tmp=$(mktemp); if [ "$2" = - ]; then notion_scrub; else notion_scrub < "$2"; fi > "$tmp"; a+=("$1" "$tmp"); shift 2;;
    *) v=$(printf '%s\n' "$1" | notion_scrub); a+=("$v"); shift;; esac; done
  ${GH_CMD:-gh} "${a[@]}"; local rc=$?; [ -n "$tmp" ] && rm -f "$tmp"; return $rc; }
# HMAC key for signed review verdicts (verdict.py). VERDICT_KEY_CMD: test hook.
verdict_key() { if [ -n "${VERDICT_KEY_CMD:-}" ]; then bash -c "$VERDICT_KEY_CMD"; else
  vault get "${VERDICT_KEY_TITLE:-Polymux review verdict HMAC}" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])'; fi; }
# Worktree in-use checks (cleanup.sh, run-lane.sh free_branch): live verify lock or fresh verify marker,
# a build slot naming it, a live unit lock for it, or any process with the path in its args.
fresh() { [ -e "$1" ] && [ $(( $(date +%s) - $(_mtime "$1") )) -lt $(( ${VERIFY_FRESH_MIN:-120} * 60 )) ]; }
verify_active() {  # $1 worktree path or "" ; $2 sim name
  local p; if [ -n "$1" ]; then p=$(cat "$1/.build/verify.lock/pid" 2>/dev/null)
    [ -n "$p" ] && kill -0 "$p" 2>/dev/null && return 0; fresh "$1/.build/verify-active" && return 0; fi
  fresh "$LOCKS/active/$2"; }
in_use() {  # $1 worktree path. Needs LOCKS (lanes.toml lock_dir) and OPS; same rule as cleanup.sh
  verify_active "$1" "polymux-$(basename "$1")" && return 0
  grep -qsF "$1" "${LOCKS:-/nonexistent}"/slot*/wt && return 0
  for u in "${OPS:-$HOME/ops/lanes}"/units/*.lock; do [ -d "$u" ] && [ "$(cat "$u/pid" 2>/dev/null)" != "$$" ] && kill -0 "$(cat "$u/pid" 2>/dev/null)" 2>/dev/null && \
    [[ "$1" == *"$(basename "$u" .lock)"* ]] && return 0; done
  pgrep -f "$1" >/dev/null
}
# cwd_in_use PATH: 0 = a process has its cwd in PATH, 1 = none, 2 = can't tell (lsof missing/failed): callers fail closed.
cwd_in_use() { local out rc r; command -v lsof >/dev/null 2>&1 || return 2
  out=$(lsof -d cwd -Fn 2>/dev/null); rc=$?; [ $rc != 0 ] && [ -z "$out" ] && return 2
  r=$(cd "$1" 2>/dev/null && pwd -P); printf '%s\n' "$out" | out_has "^n($1|${r:-$1})(/|\$)" && return 0; return 1; }
# wt_pids PATH: pids whose cwd is PATH or below (lsof -d cwd), one per line; never this shell or its parent.
wt_pids() { local r; r=$(cd "$1" 2>/dev/null && pwd -P); command -v lsof >/dev/null 2>&1 || return 2
  lsof -d cwd -Fpn 2>/dev/null | awk -v a="$1" -v b="${r:-$1}" -v me="$$" -v pp="$PPID" '
    /^p/ { pid = substr($0, 2) } /^n/ { n = substr($0, 2)
      if (pid != me && pid != pp && (n == a || n == b || index(n, a "/") == 1 || index(n, b "/") == 1)) print pid }' | sort -u; }
# reap_wt PATH [LOG]: TERM every process whose cwd is in the worktree (agent leftovers outside its process group, e.g.
# MCP servers or verify.sh started by a shared "opencode serve"), wait LANE_KILL_WAIT (10) s, then KILL survivors.
reap_wt() { local p k left; p=$(wt_pids "$1") || return 0; [ -n "$p" ] || return 0
  echo "reap: TERM leftover pids with cwd in $1: $(echo $p)" >> "${2:-/dev/null}"; kill -TERM $p 2>/dev/null
  for k in $(seq 1 $(( ${LANE_KILL_WAIT:-10} * 10 ))); do left=""; for x in $p; do kill -0 "$x" 2>/dev/null && left="$left $x"; done
    [ -z "$left" ] && return 0; sleep 0.1; done
  kill -KILL $left 2>/dev/null; echo "reap: KILL after ${LANE_KILL_WAIT:-10}s:$left" >> "${2:-/dev/null}"; }

plain_text() { perl -pe 's/\e\][^\a\e]*(?:\a|\e\\)//g; s/\e\[[0-?]*[ -\/]*[@-~]//g'; }
# Preserve the brief and effective branch; a watchdog may replace the requested agent.
retry_brief() {
  local file=$1 title=$2 needs=$3 exp=$4 branch=$5 wt=$6 agent=${7:-} head
  printf '%s (attempt 2)\nneeds: %s\nexpected_min: %s\n' "$title" "${needs:-none}" "${exp:-60}"
  [ -n "$branch" ] && printf 'branch: %s\n' "$branch"
  [ -n "$agent" ] && printf 'agent: %s\n' "$agent"
  if [ -f "$file" ]; then
    awk -v title="$title" -v agent="$agent" '
      !removed && $0==title { removed=1; next }
      /^(needs|expected_min|branch):/ { next }
      agent!="" && /^agent:/ { next }
      { print }' "$file"
  fi
  head=$(git -C "$wt" rev-list -1 HEAD --not --remotes=origin 2>/dev/null)
  [ -n "$head" ] && printf '\n## Previous attempt work\nUnpushed head: %s\nBranch: %s\nWorktree: %s\n' "$head" "$branch" "$wt"
  return 0
}
brief_title() {
  plain_text < "$1" | awk '/^# / { print; found=1; exit } NR==1 { first=$0 } END { if (!found) print first }' |
    sed -E 's/^#+[[:space:]]*//; s/[[:space:]]*\(attempt [0-9]+\)[[:space:]]*$//; s/[[:space:]]+att[0-9]+[[:space:]]*$//; s/^[A-Z]+[0-9]+:[[:space:]]*//; s/[[:space:]]+$//'
}
brief_link() {
  local issue verb=Closes
  issue=$(sed -nE 's/^[Ii]ssue:[[:space:]]*#?([0-9]+)[[:space:]]*$/\1/p' "$1" | head -1)
  [ -n "$issue" ] || return 0
  grep -qiE '^partial:[[:space:]]*(true|yes|1|slice)[[:space:]]*$|^slice:[[:space:]]*partial[[:space:]]*$|\bpartial slice\b' "$1" && verb=Refs
  printf '%s #%s\n' "$verb" "$issue"
}
