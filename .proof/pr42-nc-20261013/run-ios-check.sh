#!/bin/bash
# Build and run the PR #42 iOS check harness inside the booted simulator.
# The harness renders the real views and drives InstantChat against the proxy in front of the
# verify fixture server (.proof/pr42-nc-20261013/proxy.py). Release PolymuxKit, app sources,
# and the check file compile into one simulator binary; this host has no Simulator UI, so the
# binary runs through `simctl spawn` (no taps and no XCUITest target exist here).
set -euo pipefail
cd "$(dirname "$0")/../.."
out="${1:-$PWD/.proof/pr42-nc-20261013}"
udid="${SIM_UDID:-42A85E14-AAD9-45D3-96FF-F9C91A5FF1AC}"
ios_triple=arm64-apple-ios27.0-simulator
scratch=.build/ios-nccheck
. .build/env 2>/dev/null || true
udid="${SIM_UDID:-$udid}"
swift build -c release --triple "$ios_triple" --scratch-path "$scratch" --disable-sandbox --target PolymuxKit >/dev/null
swift build -c release --triple "$ios_triple" --scratch-path "$scratch" --disable-sandbox --target AvatarKit >/dev/null
swift build -c release --triple "$ios_triple" --scratch-path "$scratch" --disable-sandbox --target PolymuxControl >/dev/null
products=$(swift build -c release --triple "$ios_triple" --scratch-path "$scratch" --disable-sandbox --show-bin-path)
sources=()
while IFS= read -r file; do sources+=("$file"); done < <(find apps/Polymux/Sources -name '*.swift' ! -name 'PolymuxApp.swift' | sort)
xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1 || true
xcrun --sdk iphonesimulator swiftc -O -swift-version 6 -parse-as-library -D DICTATION_CHECK \
  -target "$ios_triple" -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -I "$products" -I packages/CSQLite \
  "${sources[@]}" "$PWD/.build/ncproof/NewChatCheck.swift" \
  "$products/PolymuxKit.o" "$products/AvatarKit.o" "$products/PolymuxControl.o" \
  -o "$scratch/newchatcheck-ios"
xcrun simctl spawn "$udid" "$scratch/newchatcheck-ios" "$out" "$PWD"
