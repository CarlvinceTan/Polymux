#!/bin/sh
# Build a Developer ID-signed macOS client on this Mac. No APNS entitlement is used.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IDENTITY=${POLYMUX_SIGN_IDENTITY:-"Developer ID Application: FlareHQ Pty Ltd (23YB4896XA)"}
TEAM=${POLYMUX_TEAM_ID:-23YB4896XA}
exec xcodebuild build \
  -project "$ROOT/apps/Polymux/Polymux.xcodeproj" \
  -scheme Polymux \
  -configuration Release \
  -destination platform=macOS \
  -derivedDataPath "$ROOT/.build/xcode-release" \
  -jobs 6 \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$IDENTITY" \
  DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGN_ENTITLEMENTS="$ROOT/apps/Polymux/Polymux-local.entitlements" \
  ENABLE_HARDENED_RUNTIME=YES
