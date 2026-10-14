#!/bin/bash
# Release scroll measurement for PR #39 (lane4/opencode), the FIX's open point.
# Starts the loopback fixture, launches the Release app in the GUI session with
# FrameLog armed, scrolls the staged t-long thread through the cua-driver CLI, and
# leaves run.log, frames.log, scroll-window.json, scroll-stats.json and before/after
# screenshots under .proof/df2-release-scroll/. Nothing here runs from verify.sh.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
PORT=${PORT:-48741}
PROOF="$ROOT/.proof/df2-release-scroll"
APP="$ROOT/.build/DD/Build/Products/Release/Polymux.app/Contents/MacOS/Polymux"
LOG="$PROOF/run.log"
PIDFILE="$ROOT/.build/scroll-app.pid"

: > "$LOG"
pkill -f "df2-release-scroll/proxy.py $PORT" 2>/dev/null || true
python3 "$PROOF/proxy.py" "$PORT" >> "$LOG" 2>&1 &
PROXY=$!
stop() { [ -s "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null; kill "$PROXY" 2>/dev/null; }
trap stop EXIT; trap 'exit 143' INT TERM HUP
rm -rf "$ROOT/.build/release-scroll-data" "$PIDFILE"
sleep 1
lsof -nP -iTCP:"$PORT" >/dev/null 2>&1 || { echo "proxy did not bind port $PORT" | tee -a "$LOG"; exit 1; }

echo "+ launch $APP (GUI session, port $PORT)" | tee -a "$LOG"
bash scripts/gui-run.sh bash -c "echo \$\$ > '$PIDFILE'; export POLYMUX_DATA_DIR='$ROOT/.build/release-scroll-data'; exec '$APP' -serverAddress http://127.0.0.1:$PORT --verify-frame-log '$PROOF/frames.log'" >> "$LOG" 2>&1 &
for _ in $(seq 1 60); do
  PID=$(cat "$PIDFILE" 2>/dev/null || true)
  { [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; } && break
  sleep 1
done
[ -n "${PID:-}" ] || { echo "app did not start" | tee -a "$LOG"; exit 1; }
echo "+ pid $PID; python3 scroll-cua.py" | tee -a "$LOG"
python3 "$PROOF/scroll-cua.py" "$PID" 2>&1 | tee -a "$LOG"
sleep 2
stop; wait 2>/dev/null || true
python3 "$PROOF/stats.py" 2>&1 | tee -a "$LOG"
