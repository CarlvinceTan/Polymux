# test-board.sh: board-update.sh cases, sourced by test-lanes.sh (uses its check/T/HOME/LANES_HOME/RL).
# Stub vault + curl (+ gh); no network. Each case would fail on the d2969c4 version.
B="$T/bb"; mkdir -p "$B" "$T/gl"; BLOG="$LANES_HOME/board.log"; BU="bash scripts/board-update.sh"
export GOAL_LOOP_HOME="$T/gl" BOARD_T="$T"; BP="$B:$T/bin:$PATH"
cp "$SRC"/scripts/{board-update.sh,media-check.py} scripts/
command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || check "test-board needs ffmpeg + ffprobe (run scripts/bootstrap-mac.sh)" false
printf '#!/bin/sh\necho "{\\"password\\":\\"SECRET-TOK\\"}"\n' > "$B/vault"
printf '#!/bin/sh\ncase "$*" in "pr view"*) echo 2026-10-13T01:00:00Z;; esac\nexit 0\n' > "$B/gh"
cat > "$B/curl" <<'STUB'
#!/bin/bash
cat > /dev/null; echo "$*" >> "$BOARD_T/curl.log"; S=$BOARD_T
case "$*" in
  *"-X GET"*pages/*) [ -f $S/readfail ] && exit 22
    printf '{"properties":{"Status":{"type":"select","select":{"name":"%s"}},"PR":{"type":"url","url":"%s"},"Verification":{"type":"select","select":null}}}' "$(cat $S/cur)" "$(cat $S/prurl 2>/dev/null)";;
  *"-X GET"*start_cursor=c2*) [ -f $S/blockfail ] && exit 22; printf '{"results":[%s],"has_more":false}' "$(cat $S/blocks 2>/dev/null)";;
  *"-X GET"*blocks/*) printf '{"results":[],"has_more":true,"next_cursor":"c2"}';;
  *"-X PATCH"*) [ -f $S/fail ] && exit 22; echo '{}';; esac
STUB
chmod +x "$B"/*; : > "$T/curl.log"; NP() { grep -c "X PATCH.*$1" "$T/curl.log"; }
printf 'needs: none\ncard: https://app.notion.com/p/Fake-0123456789abcdef0123456789abcdef\nFake unit\n' > "$T/c.task"
printf 'needs: none\nNo card unit\n' > "$T/nc.task"
PATH=$BP $BU card fake-unit "$T/c.task"; PATH=$BP $BU card nocard "$T/nc.task"; PATH=$BP $BU start nocard >/dev/null; R0=$?
check "board: missing card: line -> skip + log, exit 0" '[ $R0 = 0 ] && grep -q "nocard start: skip: no card for unit" "$BLOG"'
echo Backlog > "$T/cur"; PATH=$BP $BU start fake-unit
check "board: dry-run without BOARD_LIVE logs the exact write, no PATCH" 'grep -q "DRY-RUN would PATCH pages/01234567-89ab-cdef-0123-456789abcdef Status: .Backlog. -> .In Progress." "$BLOG" && [ "$(NP .)" = 0 ]'
touch "$LANES_HOME/BOARD_LIVE"; OUT=$(PATH=$BP $BU start fake-unit)
check "board: live refused without RELAY_HOLD (board_error, no read/write)" '[ "$(NP .)" = 0 ] && grep -q "board_error	start	refusing live write" "$LANES_HOME/events.tsv" && echo "$OUT" | grep -q "^board_error:"'
touch "$T/gl/RELAY_HOLD"; echo "In Progress" > "$T/cur"; PATH=$BP $BU start fake-unit
check "board: idempotent skip when equal" 'grep -q "start: skip: Status already .In Progress." "$BLOG" && [ "$(NP .)" = 0 ]'
for s in Review Completed; do echo $s > "$T/cur"; PATH=$BP $BU start fake-unit; done
check "board: start never moves Review/Completed backwards" '[ "$(NP .)" = 0 ] && [ "$(grep -c "never backwards" "$BLOG")" = 2 ]'
touch "$T/readfail"; echo Backlog > "$T/cur"; PATH=$BP $BU start fake-unit >/dev/null; PATH=$BP $BU pr fake-unit https://x/pull/1 >/dev/null; rm "$T/readfail"
check "board: failed read skips the write (property)" '[ "$(NP .)" = 0 ] && [ "$(grep -c "board_error	.*read of .* failed; write skipped" "$LANES_HOME/events.tsv")" = 2 ]'
echo Review > "$T/cur"; PATH=$BP $BU merged fake-unit
check "board: live merged = one PATCH to Completed; token never in argv/logs" '[ "$(NP pages)" = 1 ] && grep -q "wrote Status: .Review. -> .Completed." "$BLOG" && ! grep -q SECRET-TOK "$T/curl.log" "$BLOG" "$LANES_HOME/events.tsv"'
: > "$T/prurl"; PATH=$BP $BU pr fake-unit https://github.com/o/r/pull/9; echo https://github.com/o/r/pull/9 > "$T/prurl"; PATH=$BP $BU pr fake-unit https://github.com/o/r/pull/9
check "board: PR url written once, then skipped" '[ "$(NP pages)" = 2 ] && grep -q "\"url\": \"https://github.com/o/r/pull/9\"" "$T/curl.log" && grep -q "pr: skip: PR already" "$BLOG"'
mkdir -p "$LANES_HOME/board/fake-unit.lock"; echo $$ > "$LANES_HOME/board/fake-unit.lock/pid"
PATH=$BP BOARD_LOCK_TRIES=1 $BU verify fake-unit build-only >/dev/null; R1=$?; rm -rf "$LANES_HOME/board/fake-unit.lock"
check "board: lock contention -> board_error, no write, exit 0" '[ $R1 = 0 ] && grep -q "board_error	verify	unit lock busy" "$LANES_HOME/events.tsv" && [ "$(NP .)" = 2 ]'
P1="$T/proof1"; P2="$T/proof2"; mkdir -p "$P1" "$P2"
HOME=$(eval echo ~"$(id -un)") python3 -c 'import random,sys; from PIL import Image; r=random.Random(1); im=Image.new("RGB",(200,100))
im.putdata([(r.randrange(256),r.randrange(256),r.randrange(256)) for _ in range(20000)]); im.save(sys.argv[1]+"/ready-a.png")
Image.new("RGB",(200,100),"white").save(sys.argv[1]+"/blank.png")' "$P1"; cp "$P1/ready-a.png" "$P2/"
printf 'ready-a.png\nblank.png\n' | tee "$P1/approved" "$P1/uploaded" "$P2/uploaded" > "$P2/approved"
SHA=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$P1/ready-a.png")
rm "$LANES_HOME/BOARD_LIVE"; PATH=$BP $BU verify fake-unit UI-verified "$P1" https://github.com/o/r/raw/proof-media/run1
check "board: dry-run media line carries sha256; blank image held" 'grep -q "DRY-RUN would append .*run1/ready-a.png sha256=$SHA" "$BLOG" && grep -q "held media (pre-publish check failed: mostly empty space.*blank.png" "$BLOG" && [ "$(NP blocks)" = 0 ]'
touch "$LANES_HOME/BOARD_LIVE"; touch "$T/blockfail"; PATH=$BP $BU verify fake-unit UI-verified "$P1" https://github.com/o/r/raw/proof-media/run1 >/dev/null; rm "$T/blockfail"
check "board: failed (paged) blocks read -> no append, board_error" '[ "$(NP blocks)" = 0 ] && grep -q "start_cursor=c2" "$T/curl.log" && grep -q "board_error	verify	blocks read failed" "$LANES_HOME/events.tsv"'
PATH=$BP $BU verify fake-unit UI-verified "$P1" https://github.com/o/r/raw/proof-media/run1; PATH=$BP $BU verify fake-unit UI-verified "$P2" https://github.com/o/r/raw/proof-media/run2
check "board: same proof across two runs (new refs) appended once (sha ledger)" '[ "$(NP blocks)" = 1 ] && grep -qx "$SHA" "$LANES_HOME/board/fake-unit.media" && grep -q "already published" "$BLOG"'
rm "$LANES_HOME/board/fake-unit.media"; printf '{"type":"image","image":{"caption":[{"plain_text":"proof sha256:%s ready-a.png"}]}}' "$SHA" > "$T/blocks"
PATH=$BP $BU verify fake-unit UI-verified "$P2" https://github.com/o/r/raw/proof-media/run3
check "board: proof already on card (caption sha, page 2) not re-appended" '[ "$(NP blocks)" = 1 ] && grep -q "already on card" "$BLOG"'
# approved-list + uploaded gates: unlisted file, .mov, no approved list, approved but not uploaded -> no append (live)
P3="$T/proof3"; P4="$T/proof4"; P5="$T/proof5"; mkdir -p "$P3" "$P4" "$P5"
HOME=$(eval echo ~"$(id -un)") python3 -c 'import random,sys; from PIL import Image; r=random.Random(2); im=Image.new("RGB",(200,100))
im.putdata([(r.randrange(256),r.randrange(256),r.randrange(256)) for _ in range(20000)]); im.save(sys.argv[1]+"/fresh.png")' "$P3"; cp "$P3/fresh.png" "$P4/"; cp "$P3/fresh.png" "$P5/"
FF() { ffmpeg -v error -f lavfi -i "$1" -t "$2" -pix_fmt yuv420p "$3"; }
FF testsrc=size=320x240:rate=10 1 "$P3/clip.mov"; echo clip.mov | tee "$P3/approved" > "$P3/uploaded"; echo fresh.png > "$P5/approved"; : > "$BLOG"
for n in 3 4 5; do PATH=$BP $BU verify fake-unit UI-verified "$T/proof$n" https://github.com/o/r/raw/proof-media/run$n; done
check "board: unlisted file, .mov, or no approved list -> no append" '[ "$(NP blocks)" = 1 ] && grep -q "not in $P3/approved): fresh.png" "$BLOG" && grep -q "pre-publish check failed: .mov is not uploaded.*clip.mov" "$BLOG" && grep -q "not in $P4/approved): fresh.png" "$BLOG"'
check "board: approved but not uploaded by publish_proof -> no append" '[ "$(NP blocks)" = 1 ] && grep -q "not uploaded by publish_proof, $P5/uploaded): fresh.png" "$BLOG"'
# media-check: video length, sampled frames, .mov, loud failure when Pillow/ffmpeg are missing
V="$T/vid"; mkdir -p "$V"; FF testsrc=size=320x240:rate=10 1 "$V/ok.mp4"; FF testsrc=size=320x240:rate=10 0.2 "$V/short.mp4"
FF color=c=white:size=320x240:rate=10 1 "$V/solid.mp4"; FF testsrc=size=320x240:rate=10 1 "$V/m.mov"; MCO=$(python3 scripts/media-check.py "$V")
check "media-check: video length (1 s passes, 0.2 s too short)" 'grep -q "^PASS.*ok.mp4" <<< "$MCO" && grep -q "^FAIL	too short	short.mp4" <<< "$MCO"'
check "media-check: solid-colour video fails on sampled frames" 'grep -q "^FAIL	frame 1 at .*mostly empty space.*solid.mp4" <<< "$MCO"'
check "media-check: .mov rejected" 'grep -q "^FAIL	.mov is not uploaded.*m.mov" <<< "$MCO"'
MC_FFPROBE=/nonexistent/ffprobe PATH=$BP $BU verify fake-unit UI-verified "$V" https://github.com/o/r/raw/proof-media/run6 >/dev/null
MC_NOPIL=1 PATH=$BP $BU verify fake-unit UI-verified "$P5" https://github.com/o/r/raw/proof-media/run7 >/dev/null
check "board: missing ffprobe / Pillow -> loud board_error, no append" '[ "$(NP blocks)" = 1 ] && grep -q "board_error	verify	media-check failed (rc=3): media-check: ffprobe/ffmpeg missing" "$LANES_HOME/events.tsv" && grep -q "board_error	verify	media-check failed (rc=3): media-check: Pillow missing" "$LANES_HOME/events.tsv"'
rm "$LANES_HOME/BOARD_LIVE"; echo Backlog > "$T/cur"; : > "$BLOG"
printf 'needs: none\nexpected_min: 5\ncard: 11111111222233334444555555555555\nBoard fails\n' > "$T/bf.task"
PATH=$BP LANE_FORCE_FAIL="laneA laneB" $RL laneA "$T/bf.task" >/dev/null 2>&1
check "run-lane: no start without work; final failure -> Verification failed only" '! grep -q "board-fails start" "$BLOG" && grep -q "board-fails verify: DRY-RUN .*Verification: .. -> .failed." "$BLOG"'
printf 'needs: none\nexpected_min: 5\ncard: 11111111222233334444555555555555\nBoard works\n' > "$T/bw.task"
PATH=$BP LANE_DRY=1 LANE_STUB_CMD="sleep 2; grep -q \"board-works start\" \"$BLOG\" && echo early > \"$T/bw.seen\"; $STUB_OK" $RL laneA "$T/bw.task" >/dev/null 2>&1
check "run-lane: start not written before the agent works, written after its first commit" '[ ! -f "$T/bw.seen" ] && grep -q "board-works start: DRY-RUN .*-> .In Progress." "$BLOG"'
# approve-proof.sh: reviewer approves viewed files; then the board append runs (dry: no BOARD_LIVE)
AW="$HOME/code/wt/laneA-approve-me"; AP="$AW/.build/proof"; mkdir -p "$AP"; cp "$P5/fresh.png" "$AP/"; echo fresh.png > "$AP/uploaded"
echo https://github.com/o/r/raw/proof-media/run8 > "$AP/url-base"; echo UI-verified > "$AP/level"; echo laneA-approve-me > "$LANES_HOME/cards/approve-me.wt"; echo 11111111-2222-3333-4444-666666666666 > "$LANES_HOME/cards/approve-me"
cp "$SRC/scripts/approve-proof.sh" scripts/; rm -f "$LANES_HOME/BOARD_LIVE"; : > "$BLOG"
PATH=$BP bash scripts/approve-proof.sh "$AW" nope.png >/dev/null 2>&1; A1=$?; PATH=$BP bash scripts/approve-proof.sh "$AW" fresh.png >/dev/null 2>&1; A2=$?
check "approve-proof: unknown file refused, viewed file approved and board append runs" '[ $A1 != 0 ] && [ $A2 = 0 ] && [ "$(cat "$AP/approved")" = fresh.png ] && grep -q "approve-me verify: DRY-RUN would append .*run8/fresh.png" "$BLOG"'
cp "$AP/fresh.png" "$AP/second.png"; mkdir -p "$AP/sub"; cp "$AP/fresh.png" "$AP/sub/x.png"; cp "$AP/fresh.png" "$AP/.hid.png"
printf 'fresh.png\nsecond.png\nsub/x.png\n.hid.png\n' > "$AP/uploaded"
PATH=$BP bash scripts/approve-proof.sh "$AW" second.png >/dev/null 2>&1
check "approve-proof: merges into the existing approved list" '[ "$(cat "$AP/approved")" = "$(printf "fresh.png\nsecond.png")" ]'
PATH=$BP bash scripts/approve-proof.sh "$AW" sub/x.png >/dev/null 2>&1; A3=$?; PATH=$BP bash scripts/approve-proof.sh "$AW" .hid.png >/dev/null 2>&1; A4=$?
check "approve-proof: refuses names with / or a leading ." '[ $A3 != 0 ] && [ $A4 != 0 ] && ! grep -q "sub/x.png\|.hid.png" "$AP/approved"'
touch "$LANES_HOME/BOARD_LIVE"; echo Review > "$T/cur"; : > "$T/curl.log"; : > "$BLOG"; C=$LANES_HOME/cards
echo 11111111-2222-3333-4444-777777777777 > "$C/board-done"; echo 11111111-2222-3333-4444-888888888888 > "$C/done"; echo laneA-board-done > "$C/board-done.wt"; echo other > "$C/done.wt"
printf '2026-10-13 11:00:00\t10131100-board-done\thttps://github.com/o/r/pull/7\tabc\tUI-verified\n' >> "$LANES_HOME/results.tsv"
git worktree add -q --detach "$HOME/code/wt/laneA-board-done" main
PATH=$BP bash scripts/cleanup.sh >/dev/null 2>&1
check "cleanup dry run: no board write" '[ "$(NP .)" = 0 ] && ! grep -q merged "$BLOG"'
PATH=$BP bash scripts/cleanup.sh --apply >/dev/null 2>&1
check "cleanup --apply: exact worktree + gh mergedAt -> one Completed write" '[ "$(NP pages)" = 1 ] && grep -q "board-done merged: wrote Status: .Review. -> .Completed." "$BLOG" && ! grep -q " done merged" "$BLOG"'
# shared card: two units on one card. start/pr write on the first unit; merged/verify wait for all,
# Verification = weakest level across the units.
SC=22222222-3333-4444-5555-666666666666; echo $SC | tee "$C/sa1-shared" > "$C/sa2-shared"; echo Backlog > "$T/cur"; : > "$T/prurl"; : > "$T/curl.log"; : > "$BLOG"
PATH=$BP $BU start sa1-shared; PATH=$BP $BU pr sa1-shared https://github.com/o/r/pull/11
check "shared card: start + pr written on the first unit" '[ "$(NP pages/$SC)" = 2 ] && grep -q "sa1-shared start: wrote Status" "$BLOG"'
echo Review > "$T/cur"; : > "$T/curl.log"; PATH=$BP $BU merged sa1-shared; PATH=$BP $BU verify sa1-shared UI-verified
check "shared card: first unit merged/verified -> no write, hold logged" '[ "$(NP .)" = 0 ] && grep -q "sa1-shared merged: hold: Status not written; card $SC waits for unit(s): sa2-shared" "$BLOG" && grep -q "sa1-shared verify: hold: Verification .* sa2-shared" "$BLOG"'
PATH=$BP $BU merged sa2-shared; PATH=$BP $BU verify sa2-shared unit-test-verified
check "shared card: last unit merged -> one Completed write" '[ "$(grep -c "X PATCH.*pages/$SC.*Completed" "$T/curl.log")" = 1 ] && grep -q "sa2-shared merged: wrote Status: .Review. -> .Completed." "$BLOG"'
check "shared card: Verification = weakest level (unit-test < UI)" '[ "$(grep -c "X PATCH.*pages/$SC.*Verification" "$T/curl.log")" = 1 ] && grep -q "X PATCH.*pages/$SC.*\"name\":\"unit-test-verified\"" "$T/curl.log" && grep -q "weakest" "$BLOG"'
: > "$T/curl.log"; PATH=$BP $BU verify sa1-shared failed
check "shared card: a unit re-verified as failed lowers the card to failed" 'grep -q "X PATCH.*pages/$SC.*\"name\":\"failed\"" "$T/curl.log"'
check "shared card: ledger tracks both units" '[ "$(cut -f1,2 "$LANES_HOME/board/card-$SC.tsv" | sort -u | wc -l | tr -d " ")" = 4 ]'
# unit name keeps its prefix: "# SA9: ..." -> sa9-..., never "-sa9-..."
rm -f "$LANES_HOME/BOARD_LIVE"; printf 'needs: none\nexpected_min: 5\ncard: 33333333444455556666777777777777\n# SA9: Prefix kept\n' > "$T/pk.task"
PATH=$BP LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$T/pk.task" >/dev/null 2>&1
check "unit name keeps its number prefix (no leading -)" '[ -f "$C/sa9-prefix-kept" ] && ! ls "$C" | grep -q "^-" && grep -q "	[0-9]*-sa9-prefix-kept	queued" "$LANES_HOME/events.tsv" && [ -d "$LANES_WT/laneA-sa9-prefix-kept" ]'
rm -f "$LANES_HOME/BOARD_LIVE"
