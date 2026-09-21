#!/bin/zsh
# Installs the Polymux native messaging host for Chromium or Firefox on macOS.
#
# Usage:
#   1. Load the extension: chrome://extensions → Developer mode →
#      "Load unpacked" → select this directory. Copy the extension ID.
#   2. Run: ./install.sh <extension-id>
set -euo pipefail

extension_id="${1:-}"
native_browser="chromium"
if [[ "$extension_id" == "firefox" ]]; then
  native_browser="firefox"
  extension_id="extension@polymux.com"
elif [[ ! "$extension_id" =~ ^[a-p]{32}$ ]]; then
  print -u2 "Usage: install.sh <32-character Chromium extension-id> | firefox"
  exit 1
fi

script_dir="${0:A:h}"
host_source="$script_dir/native-host/polymux_tab_context_host.mjs"
manifest_template="$script_dir/native-host/com.polymux.tab_context.json"

# Chrome launches the host with the GUI PATH (/usr/bin:/bin:...), which has no
# `node` on it, so the manifest points at a wrapper with an absolute
# interpreter baked in at install time. Preference order: the runtime a
# packaged Polymux ships, the checkout's fetched copy, then PATH node.
node_bin=""
for candidate in \
  "/Applications/Polymux.app/Contents/Resources/resources/node/node" \
  "$script_dir/../../resources/node/node"; do
  [[ -x "$candidate" ]] && { node_bin="${candidate:A}"; break; }
done
if [[ -z "$node_bin" ]]; then
  node_bin="$(command -v node || true)"
fi
if [[ -z "$node_bin" ]]; then
  print -u2 "No Node runtime found. Install Polymux, run 'node scripts/fetch-node.mjs' in the checkout, or install Node."
  exit 1
fi

host_dir="$HOME/Library/Application Support/polymux-tab-context"
host_script="$host_dir/polymux_tab_context_host.mjs"
host_path="$host_dir/polymux_tab_context_host-$native_browser"
mkdir -p "$host_dir"
cp "$host_source" "$host_script"
cat > "$host_path" <<WRAPPER
#!/bin/sh
# Written by install.sh: Chrome's spawn environment has no PATH worth trusting.
POLYMUX_NATIVE_BROWSER="$native_browser" POLYMUX_EXTENSION_ID="$extension_id" exec "$node_bin" "$host_script" "\$@"
WRAPPER
chmod +x "$host_path" "$host_script"

if [[ "$native_browser" == "firefox" ]]; then
  target_dir="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
  mkdir -p "$target_dir"
  "$node_bin" --input-type=module - "$host_path" "$target_dir/com.polymux.tab_context.json" <<'JS'
import {writeFileSync} from "node:fs";
writeFileSync(process.argv[3], JSON.stringify({
  name: "com.polymux.tab_context",
  description: "Polymux tab context and authenticated Vault connection",
  path: process.argv[2],
  type: "stdio",
  allowed_extensions: ["extension@polymux.com"],
}, null, 2) + "\n");
JS
  print "Installed Firefox host manifest: $target_dir/com.polymux.tab_context.json"
  print "Done. Reload the Polymux add-on and open Polymux to connect Vault."
  exit 0
fi

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
    "$manifest_template" > "$target_dir/com.polymux.tab_context.json"
  print "Installed host manifest: $target_dir/com.polymux.tab_context.json"
  installed=1
done

if (( !installed )); then
  print -u2 "No supported Chromium-based browser profile directory was found."
  exit 1
fi

print "Done. Reload the extension (chrome://extensions) to start streaming."
print "Snapshots land in: $HOME/Library/Application Support/polymux-tab-context/tabs.json"
