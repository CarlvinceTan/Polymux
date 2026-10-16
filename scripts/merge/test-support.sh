#!/bin/bash
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
. "$ROOT/scripts/merge/support.sh"
PASS=0
FAILS=0
check() {
  if eval "$2"; then PASS=$((PASS+1)); echo "ok   $1"
  else FAILS=$((FAILS+1)); echo "FAIL $1"
  fi
}

SHA=$(printf '%040d' 0)
NOTION_ID=3f60dbb6e05381518ce5c571f278c93d
cat > "$T/notion.md" <<TEXT
Summary ok
Migrated from Notion card: https://www.notion.so/$NOTION_ID
board https://app.notion.com/p/x
Notion page 3f60dbb6-e053-8151-8ce5-c571f278c93d
head $SHA
TEXT
SCRUBBED=$(notion_scrub < "$T/notion.md")
check "Notion links and page IDs are scrubbed" 'grep -q "Summary ok" <<< "$SCRUBBED" && grep -qx "Migrated from Notion card: \[Notion link removed\]" <<< "$SCRUBBED" && grep -qx "Notion page \[id removed\]" <<< "$SCRUBBED" && grep -q "head $SHA" <<< "$SCRUBBED" && ! notion_ref <<< "$SCRUBBED" && notion_ref < "$T/notion.md"'

UUID=6f1c2a9e-3b4d-4e5f-9a8b-7c6d5e4f3a2b
UDID=00008112-001A2C3E0E78801E
SIM=C07BB27B-B6BE-4566-9991-3DF89FD06E17
MD5=d41d8cd98f00b204e9800998ecf8427e
printf 'request %s\ndevice %s\nsim %s\nmd5 %s\n' "$UUID" "$UDID" "$SIM" "$MD5" > "$T/ids.md"
check "unrelated IDs pass through unchanged" '[ "$(notion_scrub < "$T/ids.md")" = "$(cat "$T/ids.md")" ] && ! notion_ref < "$T/ids.md"'

cat > "$T/gh" <<SCRIPT
#!/bin/bash
printf '%s\n' "\$@" > "$T/gh-args"
for argument; do [ -f "\$argument" ] && cat "\$argument" >> "$T/gh-args"; done
SCRIPT
chmod +x "$T/gh"
GH_CMD="$T/gh" gh_write pr comment 7 --body "$(cat "$T/notion.md")"
check "gh_write scrubs inline bodies" 'grep -q "Summary ok" "$T/gh-args" && ! notion_ref < "$T/gh-args"'
GH_CMD="$T/gh" gh_write issue create --body-file "$T/notion.md"
check "gh_write scrubs body files" 'grep -q "Summary ok" "$T/gh-args" && ! notion_ref < "$T/gh-args"'
GH_CMD="$T/gh" gh_write pr comment 7 --body "$(cat "$T/ids.md")"
check "gh_write preserves unrelated IDs" 'grep -q "$UUID" "$T/gh-args" && grep -q "$UDID" "$T/gh-args" && grep -q "$SIM" "$T/gh-args" && grep -q "$MD5" "$T/gh-args"'

git init -q "$T/repo"
git -C "$T/repo" remote add origin git@github.com:owner/project.git
check "repo_slug normalizes SSH origins" '[ "$(repo_slug "$T/repo")" = owner/project ]'

echo "test-support: $PASS passed, $FAILS failed"
[ $FAILS = 0 ]
