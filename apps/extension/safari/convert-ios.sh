#!/bin/zsh
# Generates an iOS Safari Web Extension wrapper around apps/extension.
# Stages a copy that excludes this safari/ folder. Does not sign or notarize.
set -euo pipefail
if ! command -v xcrun >/dev/null; then
  print -u2 "Xcode command-line tools are required."
  exit 1
fi
here="${0:A:h}"
source="${here:h}"
stage="$(mktemp -d "${TMPDIR:-/tmp}/polymux-safari-ios.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
rsync -aL --exclude safari --exclude native-host --exclude install.sh --exclude README.md --exclude STORE_LISTING.md --exclude store-assets --exclude scripts --exclude locker/config.local.js "$source/" "$stage/"
node "$source/scripts/build-locker.mjs" --output-dir "$stage"
xcrun safari-web-extension-converter "$stage" \
  --project-location "$here/ios" \
  --app-name Polymux \
  --bundle-identifier com.polymux.extension \
  --copy-resources \
  --force \
  --ios-only \
  --no-prompt \
  --no-open
cp "$here/iOS.entitlements" "$here/ios/Polymux/iOS.entitlements"
python3 - "$here/ios/Polymux/Polymux.xcodeproj/project.pbxproj" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text()
if "CODE_SIGN_ENTITLEMENTS" not in text:
    text = text.replace(
        "CODE_SIGN_STYLE = Automatic;",
        "CODE_SIGN_STYLE = Automatic;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = iOS.entitlements;",
    )
if "DEVELOPMENT_TEAM" not in text:
    text = text.replace(
        "CODE_SIGN_STYLE = Automatic;",
        "CODE_SIGN_STYLE = Automatic;\n\t\t\t\tDEVELOPMENT_TEAM = 23YB4896XA;",
    )
path.write_text(text)
PY
print "iOS Xcode project written under $here/ios. Team 23YB4896XA is set for Automatic signing."
