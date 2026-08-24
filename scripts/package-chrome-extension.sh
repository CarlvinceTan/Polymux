#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_arg="${1:-dist/polymux-agent-surface.zip}"
if [[ "$output_arg" = /* ]]; then
  output_path="$output_arg"
else
  output_path="$repo_root/$output_arg"
fi

stage_root="$(mktemp -d "${TMPDIR:-/tmp}/polymux-extension.XXXXXX")"
trap 'rm -rf "$stage_root"' EXIT
package_root="$stage_root/package"
mkdir -p "$package_root" "$(dirname "$output_path")"

rsync -aL \
  --exclude '.DS_Store' \
  --exclude 'README.md' \
  --exclude 'STORE_LISTING.md' \
  --exclude 'store-assets' \
  --exclude 'install.sh' \
  --exclude 'native-host' \
  "$repo_root/apps/extension/" "$package_root/"

node - "$package_root" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const referenced = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
  ...Object.values(manifest.icons ?? {}),
].filter(Boolean);
for (const relative of referenced) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing packaged file: ${relative}`);
}
if (fs.lstatSync(root).isSymbolicLink()) throw new Error("Package root must not be a symlink");
console.log(`Packaging Polymux Agent Surface ${manifest.version}.`);
NODE

if find "$package_root" -type l -print -quit | grep -q .; then
  echo "Extension package must not contain symlinks." >&2
  exit 1
fi

temporary_zip="$stage_root/polymux-agent-surface.zip"
(cd "$package_root" && zip -q -r "$temporary_zip" .)
mv -f "$temporary_zip" "$output_path"
unzip -tq "$output_path"
echo "Created $output_path"
