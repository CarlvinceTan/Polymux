#!/bin/zsh
# Installs the FlareAI Tab Context native messaging host for Chrome on macOS.
#
# Usage:
#   1. Load the extension: chrome://extensions → Developer mode →
#      "Load unpacked" → select this directory. Copy the extension ID.
#   2. Run: ./install.sh <extension-id>
set -euo pipefail

extension_id="${1:-}"
if [[ ! "$extension_id" =~ ^[a-p]{32}$ ]]; then
  print -u2 "Usage: install.sh <extension-id>  (32-character ID from chrome://extensions)"
  exit 1
fi

script_dir="${0:A:h}"
host_source="$script_dir/native-host/flareai_tab_context_host.py"
manifest_template="$script_dir/native-host/com.flareai.tab_context.json"

host_dir="$HOME/Library/Application Support/flareai-tab-context"
host_path="$host_dir/flareai_tab_context_host.py"
mkdir -p "$host_dir"
cp "$host_source" "$host_path"
chmod +x "$host_path"

installed=0
for browser_dir in \
  "$HOME/Library/Application Support/Google/Chrome" \
  "$HOME/Library/Application Support/Google/Chrome Beta" \
  "$HOME/Library/Application Support/Chromium" \
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser" \
  "$HOME/Library/Application Support/Microsoft Edge" \
  "$HOME/Library/Application Support/Arc/User Data"; do
  [[ -d "$browser_dir" ]] || continue
  target_dir="$browser_dir/NativeMessagingHosts"
  mkdir -p "$target_dir"
  sed -e "s|__HOST_PATH__|$host_path|" -e "s|__EXTENSION_ID__|$extension_id|" \
    "$manifest_template" > "$target_dir/com.flareai.tab_context.json"
  print "Installed host manifest: $target_dir/com.flareai.tab_context.json"
  installed=1
done

if (( !installed )); then
  print -u2 "No supported Chromium-based browser profile directory was found."
  exit 1
fi

print "Done. Reload the extension (chrome://extensions) to start streaming."
print "Snapshots land in: $HOME/Library/Application Support/flareai-tab-context/tabs.json"
