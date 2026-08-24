#!/bin/zsh
# Installs the Polymux Tab Context native messaging host for Chrome on macOS.
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
host_path="$host_dir/polymux_tab_context_host"
mkdir -p "$host_dir"
cp "$host_source" "$host_script"
cat > "$host_path" <<WRAPPER
#!/bin/sh
# Written by install.sh: Chrome's spawn environment has no PATH worth trusting.
exec "$node_bin" "$host_script" "\$@"
WRAPPER
chmod +x "$host_path" "$host_script"

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
