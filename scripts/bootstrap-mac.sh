#!/bin/bash
# Idempotent Mac bootstrap for Polymux agent lanes. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v brew >/dev/null || { echo "install Homebrew first"; exit 1; }
for f in gh xcbeautify tmux; do command -v $f >/dev/null || brew install $f; done
command -v opencode >/dev/null || brew install opencode || echo "warn: opencode not installed"
command -v vault >/dev/null || { echo "vault CLI missing: install it from its repo (cargo build --release) first; lanes read keys from it"; exit 1; }
if ! [ -x ~/.local/bin/cursor-agent ] && ! command -v cursor-agent >/dev/null; then   # pinned + checksummed, never curl|bash
  U=$(python3 scripts/lanes.py get cursor_install_url); H=$(python3 scripts/lanes.py get cursor_install_sha256)
  if [ -z "$H" ]; then echo "warn: cursor-agent missing and no cursor_install_sha256 pinned in agents/lanes.toml; install it manually"
  else T=$(mktemp); curl -fsSL "$U" -o "$T" && echo "$H  $T" | shasum -a 256 -c - >/dev/null && bash "$T" || { echo "cursor installer checksum mismatch; not running it"; exit 1; }; rm -f "$T"; fi
fi
xcodebuild -version | head -1 || { echo "Xcode missing"; exit 1; }
python3 scripts/fetch_cua.py      # required before any macOS build
mkdir -p "$(python3 scripts/lanes.py get lock_dir)" ~/ops/lanes
bash scripts/wt-setup.sh          # creates sim template + this checkout's clone
GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
if   [ $GB -le 16 ]; then N=2 B=1; elif [ $GB -le 24 ]; then N=3 B=2; else N=4 B=2; fi
echo "RAM ${GB} GB -> recommend $N lanes, max_builds=$B (set in agents/lanes.toml)"
echo "One-time manual: grant Screen Recording to Terminal/sshd-keygen-wrapper, enable auto-login."
