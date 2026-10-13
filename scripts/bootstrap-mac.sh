#!/bin/bash
# Idempotent Mac bootstrap for Polymux agent lanes. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v brew >/dev/null || { echo "install Homebrew first"; exit 1; }
for f in gh xcbeautify tmux; do command -v $f >/dev/null || brew install $f; done
command -v opencode >/dev/null || brew install opencode || echo "warn: opencode not installed"
[ -x ~/.local/bin/cursor-agent ] || command -v cursor-agent >/dev/null || \
  { curl -fsS https://cursor.com/install | bash; }
xcodebuild -version | head -1 || { echo "Xcode missing"; exit 1; }
python3 scripts/fetch_cua.py      # required before any macOS build
mkdir -p "$(python3 scripts/lanes.py get lock_dir)" ~/ops/lanes
bash scripts/wt-setup.sh          # creates sim template + this checkout's clone
GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
if   [ $GB -le 16 ]; then N=2 B=1; elif [ $GB -le 24 ]; then N=3 B=2; else N=4 B=2; fi
echo "RAM ${GB} GB -> recommend $N lanes, max_builds=$B (set in agents/lanes.toml)"
echo "One-time manual: grant Screen Recording to Terminal/sshd-keygen-wrapper, enable auto-login."
