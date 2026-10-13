#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$PWD/.build/clang-cache}"
export SWIFTPM_MODULECACHE_OVERRIDE="${SWIFTPM_MODULECACHE_OVERRIDE:-$PWD/.build/swift-cache}"
swift build --disable-sandbox
products=$(swift build --disable-sandbox --show-bin-path)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
sources=()
for name in ComposerView DictationInput DraftPreview ReplyPreview AttachmentPreview BubbleStyle \
  AppearanceView MediaView AudioView HTMLView ShareMenu CameraView PanelView PanelPresentation PanelDismiss InputFocus; do
  sources+=("apps/Polymux/Sources/Views/$name.swift")
done
sources+=(apps/Polymux/Sources/Voice/AppleVoice.swift apps/Polymux/Sources/Voice/VoiceTypes.swift)
swiftc -disable-sandbox -whole-module-optimization -swift-version 6 -parse-as-library -D DICTATION_CHECK \
  -target arm64-apple-macosx27.0 -I "$products" -I packages/CSQLite \
  -L "$products" -lPolymuxKit \
  "${sources[@]}" \
  apps/Polymux/Tests/DictationTests/DictationCheck.swift -o "$scratch/dictation-check"
"$scratch/dictation-check" "${1:?Supply a snapshot output directory}" "$PWD"
