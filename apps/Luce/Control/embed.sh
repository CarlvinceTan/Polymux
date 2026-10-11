#!/bin/sh
set -eu
[ "$PLATFORM_NAME" = macosx ] || exit 0
root="$SRCROOT/../.."
source="$root/.vendor/cua"
if [ ! -x "$source/cua-driver" ]; then
  echo 'error: Missing bundled runtime. Run python3 scripts/fetch_cua.py before building macOS.' >&2
  exit 1
fi
expected=$(cat "$source/SHA256")
actual=$(/usr/bin/shasum -a 256 "$source/cua-driver" | /usr/bin/awk '{print $1}')
[ "$actual" = "$expected" ] || { echo 'error: Bundled Cua checksum mismatch' >&2; exit 1; }
destination="$TARGET_BUILD_DIR/$CONTENTS_FOLDER_PATH"
mkdir -p "$destination/Helpers" "$destination/Library/LaunchAgents" "$destination/Resources/Control"
cp "$source/cua-driver" "$destination/Helpers/cua-driver"
cp "$SRCROOT/Control/com.carlvince.luce.control.plist" "$destination/Library/LaunchAgents/"
cp "$SRCROOT/Control/Cua-LICENSE.txt" "$destination/Resources/Control/"
for notice in "$source"/notice-*; do
  [ ! -f "$notice" ] || cp "$notice" "$destination/Resources/Control/"
done
if [ "$CODE_SIGNING_ALLOWED" != NO ]; then
  identity="${EXPANDED_CODE_SIGN_IDENTITY:--}"
  [ -n "$identity" ] || identity=-
  /usr/bin/codesign --force --options runtime --sign "$identity" "$destination/Helpers/cua-driver"
fi
