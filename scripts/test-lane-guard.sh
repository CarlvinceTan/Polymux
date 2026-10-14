#!/bin/bash
set -eu
SRC=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export LANES_HOME="$T/ops" LANE_GUARD_STATE="$T/state" LANE_GUARD_EVENTS="$T/events" LANES_REPO="$T/repo" LANE_GATE=true
mkdir -p "$LANES_REPO/scripts" "$LANES_REPO/agents" "$LANES_HOME/queue"
cp "$SRC/scripts/dispatch-guard.sh" "$SRC/scripts/lanes.py" "$LANES_REPO/scripts/"
printf 'mac_hosts = []\n[laneA]\nagent = "codex"\ncmd = "true"\n' > "$LANES_REPO/agents/lanes.toml"
for kind in dep spec scope; do
  bash "$SRC/scripts/lane-guard.sh" --task-end laneA "$kind" 1 /dev/null "$kind"
done
[ ! -f "$LANES_HOME/PAUSE" ]; [ ! -s "$LANE_GUARD_STATE/tasks.tsv" ]
echo 'ok   dependency/spec/scope stops excluded from guard ledger'
echo 'test-lane-guard: 1 passed, 0 failed'
