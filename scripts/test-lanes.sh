#!/bin/bash
# test-lanes.sh: hermetic tests for the lane scripts (no agents, no Xcode, no network, no vault).
# Uses the run-lane hooks LANE_DRY / LANE_FORCE_FAIL / LANE_STUB_CMD / LANE_SKIP_SETUP in a temp
# repo with a local bare origin. Usage: bash scripts/test-lanes.sh   (exit 0 = all passed)
set -uo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd); T=$(cd "$(mktemp -d)" && pwd -P); trap 'rm -rf "$T"' EXIT
PASS=0; FAILS=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "ok   $1"; else FAILS=$((FAILS+1)); echo "FAIL $1"; fi; }
git init -q --bare "$T/origin.git"; git init -q -b main "$T/repo"; cd "$T/repo"
git config user.name "Lane Test"; git config user.email lane@test.invalid
mkdir -p scripts agents; cp "$SRC"/scripts/{run-lane,verify,lanelib,dispatch-guard,cleanup,wt-setup,board-update}.sh "$SRC"/scripts/lanes.py scripts/
cat > agents/lanes.toml <<'TOML'
max_builds = 1
lock_dir = "~/ops/lanes/locks"
sim_template = "polymux-template"
mac_hosts = ["testmac"]
[laneA]
agent = "opencode"
cmd = "true"
[laneB]
agent = "codex"
cmd = "true"
TOML
echo base > README; git add -A; git commit -qm base; git remote add origin "$T/origin.git"; git push -q origin main
export HOME="$T/home" LANES_HOME="$T/home/ops/lanes" LANES_WT="$T/home/code/wt" LANE_SKIP_SETUP=1 LANE_TARGET=testmac
export LANE_STAGGER=0 LANE_POLL=1 LANE_GUARD="$T/no-lane-guard" DISPATCH_INTAKE="$T/intake.jsonl"
mkdir -p "$HOME/code/wt" "$LANES_HOME"
task() { printf 'needs: none\nexpected_min: 5\n%s\n' "$1" > "$T/$2.task"; echo "$T/$2.task"; }
STUB_OK='echo $RANDOM >> f.txt && git add f.txt && git commit -qm "stub change" -m "Lane: $LANE/$AGENT"'
RL="bash scripts/run-lane.sh"
# 1 happy path (dry): commit with trailer, lane identity in committer, locks released
OUT=$(LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Happy path' t1)" --branch test/happy 2>&1); RC=$?
check "dry happy path exits 0" '[ $RC = 0 ] && echo "$OUT" | grep -q "DRY-OK laneA"'
check "lane trailer present" 'git -C "$LANES_WT/laneA-happy-path" log -1 --format=%B | grep -q "^Lane: laneA/opencode"'
check "committer names lane" 'git -C "$LANES_WT/laneA-happy-path" log -1 --format=%cn | grep -q "(laneA/opencode)"'
check "unit + branch locks released" '! ls -d "$LANES_HOME"/units/*.lock "$LANES_HOME"/branches/*.lock 2>/dev/null | grep -q .'
# 2 forced failure on both lanes -> failover -> NEEDS_CODY + failures.tsv
OUT=$(LANE_FORCE_FAIL="laneA laneB" $RL laneA "$(task 'Always fails' t2)" 2>&1); RC=$?
check "forced failure exits 1 after failover" '[ $RC = 1 ] && echo "$OUT" | grep -q "FAILED after: laneA laneB"'
check "NEEDS_CODY + failures.tsv written" 'grep -q "Always fails" "$LANES_HOME/NEEDS_CODY" && grep -q "Always fails" "$LANES_HOME/failures.tsv"'
# 3 stop rule
$RL laneA "$(task 'Always fails' t3)" >/dev/null 2>&1; RC=$?
check "stop rule refuses a twice-failed brief (exit 2)" '[ $RC = 2 ]'
# 4 unit lock contention (live holder) and stale reclaim (dead holder)
mkdir -p "$LANES_HOME/units/unit-busy.lock"; echo $$ > "$LANES_HOME/units/unit-busy.lock/pid"
$RL laneA "$(task 'Unit busy' t4)" >/dev/null 2>&1; RC=$?
check "unit lock contention exits 3" '[ $RC = 3 ]'
echo 999999 > "$LANES_HOME/units/unit-busy.lock/pid"
OUT=$(LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Unit busy' t5)" 2>&1); RC=$?
check "stale unit lock is reclaimed" '[ $RC = 0 ]'
# 5 branch lock: same branch, different title -> laneA refused on the branch, laneB uses its own branch
BL="$LANES_HOME/branches/test%shared.lock"; mkdir -p "$BL"; echo $$ > "$BL/pid"
OUT=$(LANE_DRY=1 LANE_STUB_CMD="$STUB_OK" $RL laneA "$(task 'Other title' t6)" --branch test/shared 2>&1); RC=$?
check "branch lock blocks a second writer" 'grep -q "branch test/shared has another writer" "$LANES_HOME/events.tsv"'
check "failover lane writes its own branch" '[ $RC = 0 ] && echo "$OUT" | grep -q "DRY-OK laneB"'
rm -rf "$BL"
# 6 missing trailer is flagged
OUT=$(LANE_DRY=1 LANE_STUB_CMD='echo n >> g.txt && git add g.txt && git commit -qm "no trailer"' $RL laneA "$(task 'No trailer' t7)" 2>&1)
check "missing Lane trailer warned" 'echo "$OUT" | grep -q "without a .Lane:. trailer"'
# 7 dispatch guard: Swift scope refused on a non-Mac host, allowed on a mac_hosts entry
printf 'needs: swift\nscope: apps/Polymux/**\nSwift unit\n' > "$T/sw.task"
bash scripts/dispatch-guard.sh "$T/sw.task" linuxbox >/dev/null; R1=$?; bash scripts/dispatch-guard.sh "$T/sw.task" testmac >/dev/null; R2=$?
check "dispatch-guard uses mac_hosts" '[ $R1 = 4 ] && [ $R2 = 0 ]'
# 10 two reclaimers at once on a stale lock: exactly one wins, every round
WINS_BAD=0; for i in $(seq 1 15); do D="$T/race.lock"; rm -rf "$D" "$T"/race.lock.stale.*; mkdir "$D"; echo 999999 > "$D/pid"
  for k in 1 2; do bash -c '. "$1"; lock_take "$2" && echo win' _ scripts/lanelib.sh "$D" > "$T/w$k" & done; wait
  [ "$(cat "$T/w1" "$T/w2" | grep -c win)" = 1 ] || WINS_BAD=$((WINS_BAD+1)); done
check "concurrent stale reclaim: one winner per round" '[ $WINS_BAD = 0 ]'
# 11 scope check: nested + deleted files, patterns never glob against real files
git checkout -q -b scope-test main; mkdir -p apps/x/y docs; echo s > apps/x/y/z.swift; echo d > docs/n.md; echo top > TOP.md
git add -A; git rm -q README; git commit -qm scope
SC() { bash -c '. "$1"; scope_check main "$2"' _ scripts/lanelib.sh "$1" 2>&1; }
check "scope: nested + deleted inside scope pass" 'SC "apps/**,*.md,README" >/dev/null'
check "scope: deleted file outside scope fails" '! SC "apps/**,*.md" >/dev/null && grep -q "outside scope: README" <<< "$(SC "apps/**,*.md")"'
check "scope: *.md matches nested docs/n.md despite TOP.md existing" '! grep -q docs/n.md <<< "$(SC "apps/**,*.md,README")"'
git checkout -q main
# 12 verify-only: rerun gets its own proof branch; failed fetch stops
mkdir -p "$T/bin"; printf '#!/bin/sh\nexit 0\n' > "$T/bin/gh"; chmod +x "$T/bin/gh"
git push -q origin main:refs/heads/vo/one
VC='mkdir -p .build/proof && date +%s%N > .build/proof/a.png && echo "## ok" > .build/proof/summary.md'
PATH="$T/bin:$PATH" LANE_VERIFY_CMD="$VC" $RL --verify-only vo/one >/dev/null 2>&1; R1=$?
PATH="$T/bin:$PATH" LANE_VERIFY_CMD="$VC" $RL --verify-only vo/one >/dev/null 2>&1; R2=$?
check "verify-only rerun succeeds" '[ $R1 = 0 ] && [ $R2 = 0 ]'
check "each run has its own proof branch" '[ "$(git ls-remote origin "refs/heads/proof-media/verify-vo-one-*" | wc -l | tr -d " ")" = 2 ]'
PATH="$T/bin:$PATH" LANE_VERIFY_CMD="$VC" $RL --verify-only no/such-branch >/dev/null 2>&1; R3=$?
check "verify-only stops when fetch fails" '[ $R3 = 1 ] && [ ! -d "$LANES_WT/verify-no-such-branch" ]'
# 13 four racers: never two winners, and the winner's lock is never deleted
BAD=0; for i in $(seq 1 15); do D="$T/r4.lock"; rm -rf "$D" "$T"/r4.lock.stale.*; mkdir "$D"; echo 999999 > "$D/pid"
  for k in 1 2 3 4; do bash -c '. "$1"; lock_take "$2" 2>/dev/null && echo "win $$"' _ scripts/lanelib.sh "$D" > "$T/v$k" & done; wait
  W=$(cat "$T"/v? | awk '/win/{print $2}'); N=$(echo "$W" | grep -c .)
  if [ "$N" -gt 1 ]; then BAD=$((BAD+1)); elif [ "$N" = 1 ]; then
    [ "$(cat "$D/pid" "$T"/r4.lock.stale.*/pid 2>/dev/null | grep -cx "$W")" -ge 1 ] || BAD=$((BAD+1)); fi; done
check "4 racing reclaimers: <=1 winner, winner lock kept" '[ $BAD = 0 ]'
# 14 test-lanes comes from the checkout under test when it has one
mkdir -p "$T/pr/scripts"; touch "$T/pr/scripts/test-lanes.sh"
check "lane tests run from the PR worktree" '[ "$(. scripts/lanelib.sh; lane_tests_path "$T/pr" /infra/scripts)" = "$T/pr/scripts/test-lanes.sh" ] && [ "$(. scripts/lanelib.sh; lane_tests_path "$T/none" /infra/scripts)" = /infra/scripts/test-lanes.sh ]'
# 15 proof-media branches: old ones (>14d) pruned, dry run by default
OLD=$(GIT_COMMITTER_DATE="$(( $(date +%s) - 20*86400 )) +0000" git commit-tree "$(git write-tree)" -m old-proof)
git push -q origin "$OLD:refs/heads/proof-media/old-run"
# 8 cleanup dry run: dirty and unpushed kept, merged removable, nothing deleted
git worktree add -q -b c/dirty "$HOME/code/wt/dirty" main && echo x > "$HOME/code/wt/dirty/README"
git worktree add -q -b c/unpushed "$HOME/code/wt/unpushed" main && (cd "$HOME/code/wt/unpushed" && echo y > u && git add u && git commit -qm u)
git worktree add -q --detach "$HOME/code/wt/merged" main
git worktree add -q --detach "$HOME/code/wt/localonly" scope-test
OUT=$(PATH="$T/bin:$PATH"; mkdir -p "$T/bin"; printf '#!/bin/sh\n[ "$3" = devices ] && echo "{\\"devices\\":{}}"; exit 0\n' > "$T/bin/xcrun"; chmod +x "$T/bin/xcrun"; bash scripts/cleanup.sh 2>&1)
check "cleanup keeps dirty" 'echo "$OUT" | grep -q "keep: $HOME/code/wt/dirty (uncommitted"'
check "cleanup keeps unpushed" 'echo "$OUT" | grep -q "keep: $HOME/code/wt/unpushed (unpushed"'
check "cleanup keeps detached HEAD not on a remote" 'echo "$OUT" | grep -q "keep: $HOME/code/wt/localonly (detached HEAD not on any remote"'
check "cleanup would prune old proof branch only" 'echo "$OUT" | grep -q "would: .*--delete proof-media/old-run" && ! echo "$OUT" | grep -q "delete proof-media/verify-vo-one"'
check "dry run kept the old proof branch" 'git ls-remote --exit-code origin refs/heads/proof-media/old-run >/dev/null'
check "cleanup would remove merged" 'echo "$OUT" | grep -q "remove: $HOME/code/wt/merged (merged=1"'
check "cleanup dry run deleted nothing" '[ -d "$HOME/code/wt/merged" ] && echo "$OUT" | grep -q "dry run"'
PATH="$T/bin:$PATH" bash scripts/cleanup.sh --apply >/dev/null 2>&1
check "--apply prunes old proof branch, keeps recent" '! git ls-remote --exit-code origin refs/heads/proof-media/old-run >/dev/null && [ "$(git ls-remote origin "refs/heads/proof-media/verify-vo-one-*" | wc -l | tr -d " ")" = 2 ]'
# 9 lanes.py per-host override
printf '[l]\nkey = "neutral"\nkey@hostx = "special"\n' > "$T/o.toml"
check "lanes.py host override" '[ "$(LANES_TOML=$T/o.toml LANES_HOST=hostx python3 scripts/lanes.py lane l key)" = special ] && [ "$(LANES_TOML=$T/o.toml LANES_HOST=y python3 scripts/lanes.py lane l key)" = neutral ]'
# 16 board-update.sh: stub vault + curl (no network); token never reaches curl argv
B="$T/bb"; mkdir -p "$B"; BLOG="$LANES_HOME/board.log"; BU="bash scripts/board-update.sh"
printf '#!/bin/sh\necho "{\\"password\\":\\"SECRET-TOK\\"}"\n' > "$B/vault"
cat > "$B/curl" <<'STUB'
#!/bin/bash
cat > /dev/null; echo "$*" >> "$BOARD_T/curl.log"
case "$*" in *"-X GET"*pages/*) printf '{"properties":{"Status":{"type":"select","select":{"name":"%s"}}}}' "$(cat "$BOARD_T/cur")";;
  *"-X PATCH"*) [ -f "$BOARD_T/fail" ] && exit 22; echo '{}';; *) echo '{"results":[]}';; esac
STUB
chmod +x "$B/vault" "$B/curl"; export BOARD_T="$T"; BP="$B:$PATH"; : > "$T/curl.log"
printf 'needs: none\ncard: https://app.notion.com/p/Fake-0123456789abcdef0123456789abcdef\nFake unit\n' > "$T/c.task"
printf 'needs: none\nNo card unit\n' > "$T/nc.task"
PATH=$BP $BU card fake-unit "$T/c.task"; PATH=$BP $BU card nocard "$T/nc.task"; PATH=$BP $BU start nocard; R0=$?
check "board: missing card: line -> skip + log, exit 0" '[ $R0 = 0 ] && grep -q "nocard card: skip: no card: line" "$BLOG" && grep -q "nocard start: skip: no card for unit" "$BLOG" && grep -q "	nocard	board	start" "$LANES_HOME/events.tsv"'
echo Backlog > "$T/cur"; PATH=$BP $BU start fake-unit
check "board: dry-run when BOARD_LIVE absent (logs exact write, no PATCH)" 'grep -q "DRY-RUN would PATCH pages/01234567-89ab-cdef-0123-456789abcdef Status: .Backlog. -> .In Progress." "$BLOG" && ! grep -q PATCH "$T/curl.log"'
touch "$LANES_HOME/BOARD_LIVE"; echo "In Progress" > "$T/cur"; PATH=$BP $BU start fake-unit
check "board: idempotent skip when value already equal" 'grep -q "fake-unit start: skip: Status already .In Progress." "$BLOG" && ! grep -q PATCH "$T/curl.log"'
echo Review > "$T/cur"; PATH=$BP $BU merged fake-unit
check "board: live write is one PATCH to Completed" '[ "$(grep -c "X PATCH" "$T/curl.log")" = 1 ] && grep -q "wrote Status: .Review. -> .Completed." "$BLOG"'
check "board: token never in curl argv or logs" '! grep -q SECRET-TOK "$T/curl.log" "$BLOG" "$LANES_HOME/events.tsv"'
mkdir -p "$LANES_HOME/board/fake-unit.lock"; echo $$ > "$LANES_HOME/board/fake-unit.lock/pid"
PATH=$BP BOARD_LOCK_TRIES=1 $BU verify fake-unit build-only; R1=$?; rm -rf "$LANES_HOME/board/fake-unit.lock"
check "board: lock contention -> not written, logged, exit 0" '[ $R1 = 0 ] && grep -q "verify: error: unit lock busy" "$BLOG" && [ "$(grep -c "X PATCH" "$T/curl.log")" = 1 ]'
touch "$T/fail"; PATH=$BP $BU verify fake-unit UI-verified; R2=$?; PATH=$BP $BU verify fake-unit bogus; rm -f "$T/fail" "$LANES_HOME/BOARD_LIVE"
check "board: failed write never fails caller; bad level refused" '[ $R2 = 0 ] && grep -q "error: write Verification=.UI-verified. failed" "$BLOG" && grep -q "level .bogus. is not a board option" "$BLOG"'
[ -n "${TL_DEBUG:-}" ] && echo "$OUT"
echo "test-lanes: $PASS passed, $FAILS failed"; [ $FAILS = 0 ]
