# test-board.sh: board-update.sh cases (GitHub Project 3 via gh GraphQL), sourced by test-lanes.sh
# (uses its check/T/HOME/LANES_HOME/RL). Stub gh (+ tripwire vault/curl); no network.
B="$T/bb"; mkdir -p "$B"; BLOG="$LANES_HOME/board.log"; BU="bash scripts/board-update.sh"; C=$LANES_HOME/cards
export BOARD_T="$T" BOARD_MAP="$T/board-map.tsv"; BP="$B:$T/bin:$PATH"
cp "$SRC"/scripts/{board-update.sh,lanelib.sh,media-check.py} scripts/
command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || check "test-board needs ffmpeg + ffprobe (run scripts/bootstrap-mac.sh)" false
for x in vault curl; do printf '#!/bin/sh\necho "$0 $*" >> "%s/tripwire.log"\nexit 1\n' "$T" > "$B/$x"; done
cat > "$B/gh" <<'STUB'
#!/bin/bash
S=$BOARD_T; printf '%s\n' "$*" | tr '\n' ' ' >> "$S/ghb.log"; echo >> "$S/ghb.log"
case "$*" in
  "pr view"*"--json id"*) [ -f $S/prfail ] && exit 1; echo PRNODE_1;;
  "pr view"*) echo 2026-10-13T01:00:00Z;;
  "pr create"*) echo https://github.com/o/r/pull/100;;
  "api graphql"*addProjectV2ItemById*) [ -f $S/addfail ] && exit 1; c=$(printf '%s' "$*" | sed -n 's/.* c=\([^ ]*\).*/\1/p')
    printf 'ITEM_%s\t%s\n' "$c" "$(cat $S/cur 2>/dev/null)";;
  "api graphql"*updateProjectV2ItemFieldValue*) [ -f $S/fail ] && exit 1; echo '{}';;
  "api graphql"*"issue(number"*) [ -f $S/lookfail ] && exit 1; echo "LOOKED_$(printf '%s' "$*" | sed -n 's/.* n=\([0-9]*\).*/\1/p')";;
esac; exit 0
STUB
chmod +x "$B"/*; : > "$T/ghb.log"
NW() { grep -c "updateProjectV2ItemFieldValue${1:+.*$1}" "$T/ghb.log"; }   # field writes (optionally matching)
NA() { grep -c "addProjectV2ItemById${1:+.*$1}" "$T/ghb.log"; }
LID=0123456789abcdef0123456789abcdef
printf '%s\t42\tI_node42\n' "$LID" > "$BOARD_MAP"
printf 'needs: none\nIssue: 7\nFake unit\n' > "$T/i.task"
printf 'needs: none\ncard: https://example.invalid/p/Fake-%s\nMapped unit\n' "$LID" > "$T/c.task"
printf 'needs: none\ncard: ffffffffffffffffffffffffffffffff\nUnmapped unit\n' > "$T/u.task"
printf 'needs: none\nNo issue unit\n' > "$T/nc.task"
PATH=$BP $BU card hdr-unit "$T/i.task"; PATH=$BP $BU card fake-unit "$T/c.task"; PATH=$BP $BU card unmapped "$T/u.task"; PATH=$BP $BU card nocard "$T/nc.task"
check "board: Issue: header -> issue 7; legacy card id -> issue 42 via local map; unmapped/none -> no mapping" \
  '[ "$(cat "$C/hdr-unit")" = 7 ] && [ "$(cat "$C/fake-unit")" = 42 ] && [ ! -f "$C/unmapped" ] && [ ! -f "$C/nocard" ] && [ "$(PATH=$BP $BU issue fake-unit)" = 42 ]'
echo 3f70dbb6-e053-81b9-b0e0-f9992df9fa74 > "$C/legacy-unit"; printf '3f70dbb6e05381b9b0e0f9992df9fa74\t99\tI_node99\n' >> "$BOARD_MAP"
check "board: a legacy id already in cards/<unit> is translated through the map" '[ "$(PATH=$BP $BU issue legacy-unit)" = 99 ]'
PATH=$BP $BU start nocard >/dev/null; R0=$?
check "board: unit without an issue -> skip + log, exit 0, no gh call" '[ $R0 = 0 ] && grep -q "nocard start: skip: no issue for unit" "$BLOG" && [ ! -s "$T/ghb.log" ]'
echo Backlog > "$T/cur"; PATH=$BP $BU start fake-unit
check "board: no BOARD_LIVE -> dry run logs the write, zero gh calls" 'grep -q "fake-unit start: DRY-RUN would set Status of the issue #42 item -> .In progress." "$BLOG" && [ ! -s "$T/ghb.log" ]'
touch "$LANES_HOME/BOARD_LIVE"; PATH=$BP $BU start fake-unit
check "board: live start from Backlog = add issue item (map node, no lookup) + one Status write" \
  '[ "$(NA "c=I_node42")" = 1 ] && [ "$(NW "o=65b9edf8")" = 1 ] && [ "$(NW "f=PVTSSF_lAHOCDGEdM4Bmy5szhlabM8")" = 1 ] && ! grep -q "issue(number" "$T/ghb.log" && grep -q "p=PVT_kwHOCDGEdM4Bmy5s" "$T/ghb.log"'
: > "$T/ghb.log"; for s in "In review" Done; do echo "$s" > "$T/cur"; PATH=$BP $BU start fake-unit; done
check "board: start never moves In review/Done backwards (Status from the add result, no extra read)" '[ "$(NW)" = 0 ] && [ "$(NA)" = 2 ] && [ "$(grep -c "never backwards" "$BLOG")" = 2 ]'
echo Done > "$T/cur"; : > "$T/ghb.log"; PATH=$BP $BU merged fake-unit
check "board: idempotent skip when Status already equal" '[ "$(NW)" = 0 ] && grep -q "fake-unit merged: skip: Status already .Done." "$BLOG"'
echo "In review" > "$T/cur"; : > "$T/ghb.log"; PATH=$BP $BU merged fake-unit
check "board: merged -> Status Done (one write)" '[ "$(NW "o=c1f2c7d6")" = 1 ] && [ "$(NW)" = 1 ]'
echo Backlog > "$T/cur"; for e in review requeued; do PATH=$BP $BU $e fake-unit; done
check "board: review -> In review, requeued -> In progress" '[ "$(NW "o=abdef12c")" = 1 ] && [ "$(NW "o=65b9edf8")" = 1 ]'
echo Backlog > "$T/cur"; : > "$T/ghb.log"; PATH=$BP $BU pr fake-unit https://github.com/o/r/pull/9
check "board: pr adds the PR as an item, PR field + In review on the issue item" \
  '[ "$(NA "c=PRNODE_1")" = 1 ] && [ "$(NA "c=I_node42")" = 1 ] && [ "$(NW "t=https://github.com/o/r/pull/9")" = 1 ] && [ "$(NW "o=abdef12c")" = 2 ] && [ "$(cat "$C/fake-unit.pr")" = PRNODE_1 ]'
: > "$T/ghb.log"; PATH=$BP $BU verify fake-unit UI-verified; PATH=$BP $BU verify fake-unit bogus >/dev/null
check "board: Verification exact option; unknown level refused" '[ "$(NW "f=PVTSSF_lAHOCDGEdM4Bmy5szhlabeg.*o=f9b24fa7")" = 1 ] && [ "$(NW)" = 1 ] && grep -q "board_error	verify	level .bogus. is not a board option" "$LANES_HOME/events.tsv"'
for l in unit-test-verified:38201913 build-only:0f2c4aa2 blocked:b8e8ce46 failed:77449e23; do : > "$T/ghb.log"; PATH=$BP $BU verify fake-unit ${l%:*}
  [ "$(NW "o=${l#*:}")" = 1 ] || echo "level ${l%:*} wrong" >> "$T/lvbad"; done
check "board: every Verification level maps to its Project option" '[ ! -f "$T/lvbad" ]'
: > "$T/ghb.log"; PATH=$BP $BU start hdr-unit; PATH=$BP $BU merged hdr-unit
check "board: issue not in map -> one node lookup, cached for the next event" '[ "$(grep -c "issue(number" "$T/ghb.log")" = 1 ] && [ "$(NA "c=LOOKED_7")" = 2 ] && [ "$(cat "$LANES_HOME/board/issue-7.node")" = LOOKED_7 ]'
: > "$T/ghb.log"; touch "$T/addfail"; OUT=$(PATH=$BP $BU merged fake-unit); rm "$T/addfail"
touch "$T/lookfail"; echo 8 > "$C/look-unit"; PATH=$BP $BU start look-unit >/dev/null; rm "$T/lookfail"
check "board: failed add / lookup -> board_error, no field write, exit 0" '[ "$(NW)" = 0 ] && echo "$OUT" | grep -q "^board_error:" && grep -q "board_error	start	issue #8 node lookup failed" "$LANES_HOME/events.tsv"'
: > "$T/ghb.log"; PATH=$BP $BU card pronly "$T/nc.task"; PATH=$BP $BU pr pronly https://github.com/o/r/pull/12; PATH=$BP $BU verify pronly build-only
check "board: unit with no issue is tracked through its PR item" '[ "$(NA "c=PRNODE_1")" = 2 ] && [ "$(NW "i=ITEM_PRNODE_1.*o=0f2c4aa2")" = 1 ] && ! grep -q "t=https" "$T/ghb.log"'
mkdir -p "$LANES_HOME/board/fake-unit.lock"; echo $$ > "$LANES_HOME/board/fake-unit.lock/pid"; : > "$T/ghb.log"
PATH=$BP BOARD_LOCK_TRIES=1 $BU verify fake-unit build-only >/dev/null; R1=$?; rm -rf "$LANES_HOME/board/fake-unit.lock"
check "board: lock contention -> board_error, no write, exit 0" '[ $R1 = 0 ] && grep -q "board_error	verify	unit lock busy" "$LANES_HOME/events.tsv" && [ ! -s "$T/ghb.log" ]'
rm "$LANES_HOME/BOARD_LIVE"; : > "$T/ghb.log"; PATH=$BP $BU merged fake-unit; PATH=$BP $BU pr fake-unit https://github.com/o/r/pull/9
check "board: rm BOARD_LIVE is the kill switch (no gh call at all)" '[ ! -s "$T/ghb.log" ] && grep -q "pr: DRY-RUN would add PR" "$BLOG"'
touch "$LANES_HOME/BOARD_LIVE"
# Notion-reference guard (lanelib.sh): nothing written to GitHub may name Notion or carry a page id
. scripts/lanelib.sh
G=0; for s in "see https://www.notion.so/x" "notion.site/p" "https://app.notion.com/p/abc" "Notion page $LID here" "notion id 3f70dbb6-e053-81b9-b0e0-f9992df9fa74"; do notion_ref <<< "$s" || G=1; done
for s in "head 6a38594dce7c26dcd49c02517a2ca6bc424815a2" "Closes #42" "https://github.com/o/r/pull/9" "id $LID here" "3f70dbb6-e053-81b9-b0e0-f9992df9fa74"; do notion_ref <<< "$s" && G=1; done
check "guard (shared notion_ref): Notion URLs and ids next to Notion; bare ids, shas, plain text are not refs" '[ $G = 0 ]'
SN=$(printf 'Notion card [x](https://app.notion.com/p/Fake-%s)\nnotion id %s; sha 6a38594dce7c26dcd49c02517a2ca6bc424815a2\n' "$LID" 3f70dbb6-e053-81b9-b0e0-f9992df9fa74 | notion_scrub)
check "guard: notion_scrub removes the link and id, keeps the line, link text and sha" '! notion_ref <<< "$SN" && echo "$SN" | grep -qx "Notion card x" && echo "$SN" | grep -q "6a38594dce7c26dcd49c02517a2ca6bc424815a2" && echo "$SN" | grep -q "notion id \[id removed\]"'
: > "$T/ghb.log"; PATH=$BP $BU pr fake-unit "https://github.com/o/r/pull/9 https://www.notion.so/p/$LID" >/dev/null
check "guard: board scrubs a Notion link out of a value and still writes it" 'grep -q "pull/9" "$T/ghb.log" && ! notion_ref < "$T/ghb.log" && ! grep -q "refusing" "$BLOG"'
# media-check: video length, sampled frames, .mov, loud failure when Pillow/ffmpeg are missing
FF() { ffmpeg -v error -f lavfi -i "$1" -t "$2" -pix_fmt yuv420p "$3"; }
V="$T/vid"; mkdir -p "$V"; FF testsrc=size=320x240:rate=10 1 "$V/ok.mp4"; FF testsrc=size=320x240:rate=10 0.2 "$V/short.mp4"
FF color=c=white:size=320x240:rate=10 1 "$V/solid.mp4"; FF testsrc=size=320x240:rate=10 1 "$V/m.mov"; MCO=$(python3 scripts/media-check.py "$V")
check "media-check: video length (1 s passes, 0.2 s too short)" 'grep -q "^PASS.*ok.mp4" <<< "$MCO" && grep -q "^FAIL	too short	short.mp4" <<< "$MCO"'
check "media-check: solid-colour video fails on sampled frames" 'grep -q "^FAIL	frame 1 at .*mostly empty space.*solid.mp4" <<< "$MCO"'
check "media-check: .mov rejected" 'grep -q "^FAIL	.mov is not uploaded.*m.mov" <<< "$MCO"'
# run-lane: start only after work; failure -> Verification failed; PR body says Closes #N, no Notion refs
rm "$LANES_HOME/BOARD_LIVE"; : > "$BLOG"
printf 'needs: none\nexpected_min: 5\nissue: 31\nBoard fails (attempt 2)\n' > "$T/bf.task"
PATH=$BP LANE_FORCE_FAIL="laneA laneB" $RL laneA "$T/bf.task" >/dev/null 2>&1
check "run-lane: no start without work; final failure -> Verification failed only" '! grep -q "board-fails-attempt-2 start" "$BLOG" && grep -q "board-fails-attempt-2 verify: DRY-RUN would set Verification .* -> .failed." "$BLOG"'
printf 'needs: none\nexpected_min: 5\nissue: 31\nBoard works\n' > "$T/bw.task"
PATH=$BP LANE_DRY=1 LANE_STUB_CMD="sleep 2; grep -q \"board-works start\" \"$BLOG\" && echo early > \"$T/bw.seen\"; $STUB_OK" $RL laneA "$T/bw.task" >/dev/null 2>&1
check "run-lane: start not written before the agent works, written after its first commit" '[ ! -f "$T/bw.seen" ] && grep -q "board-works start: DRY-RUN .*-> .In progress." "$BLOG"'
VCN='mkdir -p .build/proof && printf "verified: see https://app.notion.com/p/'"$LID"'\n" > .build/proof/summary.md && echo unit-test-verified > .build/proof/level'
printf '# Closes issue\nneeds: none\nexpected_min: 5\nIssue: 42\nLabels: type:infra,area:lanes\n' > "$T/ci.task"; : > "$T/ghb.log"
OUT=$(PATH=$BP LANE_NO_CHAIN=1 LANE_RETRY_SLEEP=0 LANE_VERIFY_CMD="$VCN" LANE_STUB_CMD="$STUB_OK" $RL laneA "$T/ci.task" --branch test/closes 2>&1); RC=$?
PRB=$(sed -n '/^pr create/,$p' "$T/ghb.log" | head -1)
check "run-lane: PR body has Closes #42, ends with Release Notes, no Notion ref reaches gh" '[ $RC = 0 ] && echo "$PRB" | grep -q "Closes #42" && echo "$PRB" | grep -q "Release Notes:  - N/A" && echo "$PRB" | grep -q -- "--label type:infra,area:lanes" && ! notion_ref < "$T/ghb.log"'
check "run-lane: issue: header is not part of the brief/title" '! echo "$PRB" | grep -qi "issue: 42" && ! echo "$PRB" | grep -q "Labels:" && grep -q -- "--title # Closes issue" "$T/ghb.log"'
# approve-proof.sh + cleanup.sh route through the same board writer
AW="$HOME/code/wt/laneA-approve-me"; AP="$AW/.build/proof"; mkdir -p "$AP"; cp "$V/ok.mp4" "$AP/"; echo ok.mp4 > "$AP/uploaded"
echo UI-verified > "$AP/level"; echo laneA-approve-me > "$C/approve-me.wt"; echo 43 > "$C/approve-me"
cp "$SRC/scripts/approve-proof.sh" scripts/; : > "$BLOG"
PATH=$BP bash scripts/approve-proof.sh "$AW" nope.png >/dev/null 2>&1; A1=$?; PATH=$BP bash scripts/approve-proof.sh "$AW" ok.mp4 >/dev/null 2>&1; A2=$?
check "approve-proof: unknown file refused; approved file -> Verification write (dry)" '[ $A1 != 0 ] && [ $A2 = 0 ] && [ "$(cat "$AP/approved")" = ok.mp4 ] && grep -q "approve-me verify: DRY-RUN would set Verification .* -> .UI-verified." "$BLOG"'
touch "$LANES_HOME/BOARD_LIVE"; echo "In review" > "$T/cur"; : > "$T/ghb.log"; : > "$BLOG"
echo 55 > "$C/board-done"; echo 56 > "$C/done"; echo laneA-board-done > "$C/board-done.wt"; echo other > "$C/done.wt"
printf '2026-10-13 11:00:00\t10131100-board-done\thttps://github.com/o/r/pull/7\tabc\tUI-verified\n' >> "$LANES_HOME/results.tsv"
git worktree add -q --detach "$HOME/code/wt/laneA-board-done" main
PATH=$BP bash scripts/cleanup.sh >/dev/null 2>&1
check "cleanup dry run: no board write" '[ "$(NW)" = 0 ] && ! grep -q merged "$BLOG"'
PATH=$BP bash scripts/cleanup.sh --apply >/dev/null 2>&1
check "cleanup --apply: exact worktree + gh mergedAt -> one Done write" '[ "$(NW "i=ITEM_LOOKED_55.*o=c1f2c7d6")" = 1 ] && grep -q "board-done merged: wrote Status of the issue #55 item: .Done." "$BLOG" && ! grep -q " done merged" "$BLOG"'
# shared issue: two units on one issue; merged/verify wait for all, Verification = weakest
echo 60 | tee "$C/sa1-shared" > "$C/sa2-shared"; : > "$T/ghb.log"; : > "$BLOG"
PATH=$BP $BU merged sa1-shared; PATH=$BP $BU verify sa1-shared UI-verified
check "shared issue: first unit merged/verified -> no write, hold logged" '[ "$(NW)" = 0 ] && grep -q "sa1-shared merged: hold: not written; issue #60 waits for unit(s): sa2-shared" "$BLOG"'
PATH=$BP $BU merged sa2-shared; PATH=$BP $BU verify sa2-shared unit-test-verified
check "shared issue: last unit -> one Done write, Verification = weakest (unit-test)" '[ "$(NW "o=c1f2c7d6")" = 1 ] && [ "$(NW "o=38201913")" = 1 ] && [ "$(NW "o=f9b24fa7")" = 0 ]'
echo 61 | tee "$C/da1-drop" > "$C/da2-drop"; : > "$T/ghb.log"; PATH=$BP $BU merged da1-drop; PATH=$BP $BU drop da2-drop "abandoned: test"
check "drop: abandoned unit removed; held merged written once" '[ ! -f "$C/da2-drop" ] && [ "$(NW "o=c1f2c7d6")" = 1 ] && grep -q "da2-drop drop: dropped from issue #61" "$BLOG"'
echo 62 | tee "$C/aa1-arch" > "$C/aa2-arch"; : > "$T/ghb.log"
mkdir -p "$LANES_HOME/queue/archive"; printf 'unit: aa2-arch\nneeds: none\nArchived\n' > "$LANES_HOME/queue/archive/10131500--whatever.task"
PATH=$BP $BU merged aa1-arch
check "drop: archived unit auto-dropped, merged written" '[ ! -f "$C/aa2-arch" ] && [ "$(NW "o=c1f2c7d6")" = 1 ] && grep -q "dropped archived unit aa2-arch" "$BLOG"'
rm -f "$LANES_HOME/BOARD_LIVE"; printf 'needs: none\nexpected_min: 5\nissue: 63\n# SA9: Prefix kept\n' > "$T/pk.task"
PATH=$BP LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$T/pk.task" >/dev/null 2>&1
check "unit name keeps its number prefix (no leading -)" '[ -f "$C/sa9-prefix-kept" ] && ! ls "$C" | grep -q "^-" && grep -q "	[0-9]*-sa9-prefix-kept	queued" "$LANES_HOME/events.tsv" && [ -d "$LANES_WT/laneA-sa9-prefix-kept" ]'
check "board: no Notion token read, no Notion API call (vault/curl tripwires untouched)" '[ ! -f "$T/tripwire.log" ] && ! grep -qiE "api\.notion|Notion - Polymux|Notion-Version|NOTION_API" scripts/board-update.sh scripts/run-lane.sh scripts/cleanup.sh scripts/approve-proof.sh scripts/lanelib.sh'
check "board: no gh write ever carried a Notion reference" '! notion_ref < "$T/ghb.log"'
rm -f "$LANES_HOME/BOARD_LIVE"
