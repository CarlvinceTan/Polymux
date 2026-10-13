#!/bin/bash
set -euo pipefail
if [[ "$(xcode-select -p)" == */CommandLineTools && -d /Applications/Xcode.app/Contents/Developer ]]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export OUTDIR="${1:?Usage: scripts/ui_snapshots.sh OUTDIR}"
mkdir -p "$OUTDIR"
OUTDIR="$(cd "$OUTDIR" && pwd)"
export OUTDIR
TASK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/polymux-activity.XXXXXX")"
trap 'rm -rf "$TASK_DIR"' EXIT
mkdir -p "$TASK_DIR/Tests"
for file in ActivityRow PanelSurface HistoryContent BubbleStyle ProgressiveTime; do
    ln -s "$ROOT/apps/Polymux/Sources/Views/$file.swift" "$TASK_DIR/Tests/$file.swift"
done
for file in AvatarView AvatarOptions AvatarPalette; do
    ln -s "$ROOT/apps/Polymux/Sources/Avatar/$file.swift" "$TASK_DIR/Tests/$file.swift"
done
ln -s "$ROOT/apps/Polymux/Tests/ActivityTests/ActivitySnapshots.swift" "$TASK_DIR/Tests/ActivitySnapshots.swift"
# The temporary target compiles the production views without editing the app project.
cat > "$TASK_DIR/Package.swift" <<MANIFEST
// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "ActivitySnapshots", platforms: [.macOS("27.0")],
    dependencies: [.package(name: "Polymux", path: "$ROOT")],
    targets: [.testTarget(name: "ActivitySnapshots", dependencies: [
        .product(name: "PolymuxKit", package: "Polymux"),
        .product(name: "AvatarKit", package: "Polymux")], path: "Tests")])
MANIFEST
export CLANG_MODULE_CACHE_PATH="$TASK_DIR/ModuleCache"
export SWIFTPM_MODULECACHE_OVERRIDE="$TASK_DIR/ModuleCache"
swift test --disable-sandbox --package-path "$TASK_DIR" --filter ActivitySnapshots
for theme in light dark; do
    for image in activity bots bots-empty bots-states bots-long history-empty history-long history-loading history-error history-mobile-empty history-mobile-long history-mobile-loading history-mobile-error; do
        test -s "$OUTDIR/$image-$theme.png"
    done
done

cd "$(dirname "$0")/.."
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$PWD/.build/clang-cache}"
export SWIFTPM_MODULECACHE_OVERRIDE="${SWIFTPM_MODULECACHE_OVERRIDE:-$PWD/.build/swift-cache}"
swift build --disable-sandbox
products=$(swift build --disable-sandbox --show-bin-path)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch" "$TASK_DIR"' EXIT
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
