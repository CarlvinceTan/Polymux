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
# Lane scripts changed between BASE and HEAD in the current repo?
lane_files_changed() { git diff --name-only "$1"...HEAD | grep -qE '^(scripts/(run-lane|verify|lanelib|cleanup|dispatch-guard|wt-setup|test-lanes|bootstrap-mac|board-update|test-board|approve-proof|merge-queue|test-merge-queue|review-verdict|queue-write)\.sh|scripts/(lanes|media-check|verdict)\.py|agents/lanes\.toml)$'; }
# test-lanes.sh to run: the checkout under test (a PR's own worktree in --verify-only), else ours.
lane_tests_path() { if [ -f "$1/scripts/test-lanes.sh" ]; then echo "$1/scripts/test-lanes.sh"; else echo "$2/test-lanes.sh"; fi; }
branch_lock_dir() { echo "${LANES_HOME:-$HOME/ops/lanes}/branches/$(echo "$1" | tr '/' '%').lock"; }
# owner/repo from origin (git@github.com:o/r.git | https://github.com/o/r[.git])
repo_slug() { git -C "${1:-.}" remote get-url origin | sed -E 's#^(git@[^:]+:|https?://[^/]+/)##; s#\.git$##'; }
# Carl's lane-guard hook; missing = skip, never fatal unless the caller checks rc.
LANE_GUARD=${LANE_GUARD:-$HOME/.local/bin/lane-guard}
guard() { [ -x "$LANE_GUARD" ] || return 0; "$LANE_GUARD" "$@"; }
# --- GitHub labels and Notion-free GitHub writes ---------------------------------------------------
# Shared label set: exactly one type:*, at least one area:*, plus dogfood / flake. Priority is a
# Project field, never a label.
LANE_TYPES="feature bug infra test docs"; LANE_AREAS="pairing chat routines server ui lanes"
# brief_labels FILE [NAME] -> comma-separated labels for a gh issue/PR made from this brief.
# type:/area: headers win ("area: ui, server"; the "type:"/"area:" value prefix is optional). Else
# inferred: title with FIX or "bug" -> bug, else feature; needs: xcode -> ui; a server/ or .go path
# -> server; a scripts/ or lanes path -> lanes; nothing matched -> lanes (logged by the caller's gh).
# dogfood: NAME starts 00NN-- or the brief says dogfood. flake: the brief is a deflake task.
brief_labels() {
  local f=$1 n=${2:-$(basename "$1")} t a title needs body x out
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
  out="type:$t"; for x in $a; do case ",$out," in *",area:$x,"*) ;; *) out="$out,area:$x";; esac; done
  { echo "$n" | grep -qE '^00[0-9][0-9]--' || grep -qi 'dogfood' "$f"; } && out="$out,dogfood"
  grep -qiE 'de-?flake' "$f" && out="$out,flake"
  echo "$out"; }
# Nothing written to GitHub may reference Notion: no notion.so / notion.site / app.notion.com links,
# no "migrated from Notion" / "Notion card" lines, no Notion page ids (32 hex, dashed or not).
NOTION_RE='notion\.so|notion\.site|app\.notion\.com|[Mm]igrated from [Nn]otion|[Nn]otion card|(^|[^0-9a-fA-F])[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}([^0-9a-fA-F]|$)'
notion_ref() { grep -qE "$NOTION_RE"; }   # stdin has a Notion reference?
notion_scrub() {  # stdin -> stdout: drop lines with Notion links/notes, blank out bare page ids
  perl -ne 'next if /notion\.(so|site)|app\.notion\.com|migrated from notion|notion card/i;
    s/(?<![0-9a-f])[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}(?![0-9a-f])/[id removed]/gi; print'; }
# gh_write <gh args...>: the only way lane scripts write to GitHub. Scrubs --title/--body/--body-file
# text, then refuses (rc 6, nothing sent) if any argument still references Notion. GH_CMD: test hook.
gh_write() { local -a a=(); local v tmp=""
  while [ $# -gt 0 ]; do case $1 in
    -t|--title|-b|--body) v=$(printf '%s\n' "$2" | notion_scrub); a+=("$1" "$v"); shift 2;;
    -F|--body-file) tmp=$(mktemp); if [ "$2" = - ]; then notion_scrub; else notion_scrub < "$2"; fi > "$tmp"; a+=("$1" "$tmp"); shift 2;;
    *) a+=("$1"); shift;; esac; done
  v=$(printf '%s\n' "${a[@]}"; [ -z "$tmp" ] || cat "$tmp")   # no pipe into grep -q: SIGPIPE + pipefail would hide a match
  if notion_ref <<< "$v"; then
    echo "gh_write: refused, text still references Notion (nothing sent to GitHub)" >&2; [ -n "$tmp" ] && rm -f "$tmp"; return 6; fi
  ${GH_CMD:-gh} "${a[@]}"; local rc=$?; [ -n "$tmp" ] && rm -f "$tmp"; return $rc; }
