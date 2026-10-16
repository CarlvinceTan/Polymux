#!/bin/bash
# Proof snapshots of the real SwiftUI views. macOS renders in-process; iOS renders in a booted
# simulator through `simctl spawn`. Everything is compiled from the same view sources the app
# uses, so a snapshot can only exist if the real views build.
set -euo pipefail
cd "$(dirname "$0")/../.."
out="${1:?Supply a snapshot output directory}"
# Absolute, resolved path: the iOS harness runs inside the simulator and gets this path verbatim
# (it used to get "$PWD/$out", which for an absolute $out became <repo>/Users/... and the iOS shots were lost).
mkdir -p "$out"; out=$(cd "$out" && pwd -P)
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

# Dictation lifecycle checks and the 12 composer snapshots from #35.
swiftc -disable-sandbox -whole-module-optimization -swift-version 6 -parse-as-library -D DICTATION_CHECK \
  -target arm64-apple-macosx27.0 -I "$products" -I packages/CSQLite \
  -L "$products" -lPolymuxKit \
  "${sources[@]}" \
  apps/Polymux/Tests/DictationTests/DictationCheck.swift -o "$scratch/dictation-check"
"$scratch/dictation-check" "$out" "$PWD"

# SA1: the composer clears and hands the files over in the tap, the bubble shows them with
# per-file rings, and the signpost trace holds both budgets with 2 x 5 MB files behind a 250 ms
# uploader. The live composer is rendered inside the same window the app would use.
cat > "$scratch/SA1Check.swift" <<'SWIFT'
import SwiftUI
import UniformTypeIdentifiers
import PolymuxKit
#if canImport(AppKit)
import AppKit
#else
import UIKit
#endif

/// A real uploader waits 250 ms per file; the budgets must hold regardless.
private struct LatencyUploader: UploadClient {
    func upload(file: LocalFile, progress: @Sendable (Double) -> Void) async throws -> Attachment {
        dispatchPrecondition(condition: .notOnQueue(.main))
        progress(0.6)
        try await Task.sleep(for: .milliseconds(250))
        return Attachment(id: "sa1-\(file.name)", kind: file.kind, name: file.name, mimeType: file.mimeType,
                          size: file.size, url: "/attachments/\(file.name)", indexingState: "ready")
    }
}

private final class IdleInput: SpeechInput {
    func start() async throws -> AsyncThrowingStream<VoiceEvent, Error> { AsyncThrowingStream { $0.finish() } }
    func stop() async {}
    func setMuted(_ muted: Bool) {}
    func finalize() async throws {}
}

private enum Assets {
    static func color(_ name: String, scheme: ColorScheme, root: URL) -> Color {
        let file = root.appending(path: "apps/Polymux/Sources/Assets.xcassets/\(name).colorset/Contents.json")
        guard let data = try? Data(contentsOf: file),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let entries = json["colors"] as? [[String: Any]],
              let entry = entries[scheme == .dark ? 1 : 0]["color"] as? [String: Any],
              let components = entry["components"] as? [String: String],
              let red = components["red"], let green = components["green"], let blue = components["blue"],
              let r = Double(red), let g = Double(green), let b = Double(blue) else { return .gray }
        return Color(red: r, green: g, blue: b)
    }
}

/// One real view in a real window, rendered for both themes.
@MainActor private final class Scene<V: View> {
    #if os(macOS)
    private let hosting: NSHostingView<AnyView>
    private let window: NSWindow
    #else
    private let controller: UIHostingController<AnyView>
    private let window: UIWindow
    #endif

    init(_ view: V, scheme: ColorScheme, root: URL, width: CGFloat, height: CGFloat) {
        let accent = Assets.color("AccentColor", scheme: scheme, root: root)
        let content = AnyView(view.padding(20)
            .frame(width: width, height: height, alignment: .bottom)
            .background(AppBackground.color(scheme))
            .tint(accent).accentColor(accent)
            .environment(\.colorScheme, scheme))
        #if os(macOS)
        hosting = NSHostingView(rootView: content)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height),
                          styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
        NSApp.appearance = window.appearance
        hosting.appearance = window.appearance
        window.contentView = hosting
        #else
        controller = UIHostingController(rootView: content)
        window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: height))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.frame = window.bounds
        controller.view.layoutIfNeeded()
        // Without an app lifecycle nothing calls the appearance callbacks, so onAppear never fires.
        controller.beginAppearanceTransition(true, animated: false)
        controller.endAppearanceTransition()
        #endif
    }

    #if os(macOS)
    func click(_ point: CGPoint) {
        window.makeKeyAndOrderFront(nil)
        let now = ProcessInfo.processInfo.systemUptime
        if let down = NSEvent.mouseEvent(with: .leftMouseDown, location: point, modifierFlags: [], timestamp: now,
                                         windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) {
            window.sendEvent(down)
        }
        if let up = NSEvent.mouseEvent(with: .leftMouseUp, location: point, modifierFlags: [], timestamp: now + 0.01,
                                       windowNumber: window.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 0) {
            window.sendEvent(up)
        }
    }

    func pressReturn() {
        guard let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
                                           timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                           context: nil, characters: "\r", charactersIgnoringModifiers: "\r",
                                           isARepeat: false, keyCode: 36) else { return }
        window.sendEvent(event)
    }
    #endif

    /// Lets SwiftUI tasks run (thumbnails, the on-appear submit) before the snapshot.
    func settle(_ seconds: Double) async {
        try? await Task.sleep(for: .seconds(seconds))
        #if !os(macOS)
        // The simulator process has no app lifecycle; force a layout pass before snapshotting.
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        #endif
    }

    /// Spinners inside this scene. The composer must show the mic, never a progress control.
    func spinnerCount() -> Int {
        #if os(macOS)
        var count = 0
        func walk(_ view: NSView) {
            if view is NSProgressIndicator { count += 1 }
            view.subviews.forEach(walk)
        }
        walk(hosting)
        return count
        #else
        var count = 0
        func walk(_ view: UIView) {
            if view is UIActivityIndicatorView { count += 1 }
            view.subviews.forEach(walk)
        }
        walk(controller.view)
        return count
        #endif
    }

    func snapshot(name: String, output: URL) throws {
        #if os(macOS)
        hosting.layoutSubtreeIfNeeded()
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { throw CocoaError(.fileWriteUnknown) }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]) else { throw CocoaError(.fileWriteUnknown) }
        try png.write(to: output.appending(path: "mac-\(name).png"))
        #else
        controller.view.layoutIfNeeded()
        let renderer = UIGraphicsImageRenderer(bounds: controller.view.bounds)
        let image = renderer.image { context in
            controller.view.layer.render(in: context.cgContext)
        }
        guard let png = image.pngData() else { throw CocoaError(.fileWriteUnknown) }
        try png.write(to: output.appending(path: "ios-\(name).png"))
        #endif
    }
}

@main private struct SA1Check {
    @MainActor static func main() async throws {
        #if os(macOS)
        NSApplication.shared.setActivationPolicy(.prohibited)
        #endif
        setvbuf(stdout, nil, _IONBF, 0)
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let root = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let folder = FileManager.default.temporaryDirectory.appending(path: "polymux-sa1-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let payload = Data(repeating: 0x41, count: 5 * 1024 * 1024)
        let photo = folder.appending(path: "Sunset.png")
        let brief = folder.appending(path: "Brief.pdf")
        try payload.write(to: photo)
        try payload.write(to: brief)
        let files = [
            LocalFile(url: photo, name: "Sunset.png", kind: "image", mimeType: "image/png", size: Int64(payload.count)),
            LocalFile(url: brief, name: "Brief.pdf", mimeType: "application/pdf", size: Int64(payload.count)),
        ]
        let drafts = files.map { DraftFile(url: $0.url, kind: UTType(mimeType: $0.mimeType) ?? .data) }
        let idle = DictationInput(makeInput: { IdleInput() }, denied: { false })
        let client = APIClient(baseURL: URL(string: "http://127.0.0.1:1")!)
        var spans: [SignpostTrace.Span] = []

        for scheme in [ColorScheme.light, .dark] {
            let theme = scheme == .dark ? "dark" : "light"
            let before = Scene(ComposerView.fixture(input: idle, text: "Two files for review", files: drafts),
                               scheme: scheme, root: root, width: 520, height: 200)
            await before.settle(0.3)
            try before.snapshot(name: "\(theme)-sa1-composer-files", output: output)

            // The state path the tap drives: bubble and pending record land while the files upload.
            let budgetStore = try await store(named: "budget-\(theme)", client: client, folder: folder)
            let tap = ContinuousClock().now
            await budgetStore.send(text: "Two files for review", files: files, at: tap)
            guard let bubbleSpan = budgetStore.trace.spans.first(where: { $0.name == "send.bubble" }), bubbleSpan.withinBudget else {
                fatalError("send.bubble missed its budget (\(theme)): \(budgetStore.trace.spans)")
            }
            guard !budgetStore.uploads.isEmpty, budgetStore.messages.count == 1 else {
                fatalError("no upload in flight after the submit: \(budgetStore.uploads)")
            }
            spans.append(bubbleSpan)

            // The real composer in a real window: it clears in the tap while the files upload.
            let liveStore = try await store(named: "live-\(theme)", client: client, folder: folder)
            ComposerView.renderedDraft = ("<unset>", -1)
            #if os(macOS)
            // A real click into the field and a Return: the submit runs from the installed view,
            // exactly as the app's send button does, so the composer clears for real.
            let live = Scene(ComposerView.checkReadyView(text: "Two files for review", files: drafts, trace: liveStore.trace) { text, files, reply, mentions, tap in
                await liveStore.send(text: text, files: files, reply: reply, mentions: mentions, at: tap)
            }, scheme: scheme, root: root, width: 520, height: 200)
            await live.settle(0.3)
            live.click(CGPoint(x: 200, y: 164))
            await live.settle(0.2)
            live.pressReturn()
            await live.settle(0.15)
            guard ComposerView.renderedDraft.text.isEmpty, ComposerView.renderedDraft.files == 0 else {
                fatalError("composer still shows a draft while the uploads run: \(ComposerView.renderedDraft)")
            }
            #else
            // The simulator process cannot post a touch; the view submits on appear instead.
            let live = Scene(ComposerView.checkSubmitView(text: "Two files for review", files: drafts, trace: liveStore.trace) { text, files, reply, mentions, tap in
                await liveStore.send(text: text, files: files, reply: reply, mentions: mentions, at: tap)
            }, scheme: scheme, root: root, width: 520, height: 200)
            #endif
            guard await poll({ !liveStore.uploads.isEmpty }, seconds: 3) else {
                fatalError("the composer's submit never reached the uploader: \(liveStore.error ?? "no error")")
            }
            guard liveStore.messages.count == 1 else {
                fatalError("the pending bubble is missing or duplicated: \(liveStore.messages.map(\.id))")
            }
            guard live.spinnerCount() == 0 else {
                fatalError("a spinner replaced the composer controls while uploading")
            }
            guard let clearedSpan = liveStore.trace.spans.first(where: { $0.name == "composer.cleared" }), clearedSpan.withinBudget else {
                fatalError("composer.cleared missed its budget (\(theme)): \(liveStore.trace.spans)")
            }
            spans.append(clearedSpan)
            #if os(macOS)
            try live.snapshot(name: "\(theme)-sa1-composer-cleared", output: output)
            #endif

            let uploading = liveStore.messages[0]
            let rings = liveStore.uploads
            let mid = Scene(bubble(uploading, rings: rings, client: client, scheme: scheme, root: root),
                            scheme: scheme, root: root, width: 520, height: 360)
            await mid.settle(0.25)
            try mid.snapshot(name: "\(theme)-sa1-bubble-uploading", output: output)

            guard await poll({ liveStore.uploads.isEmpty }, seconds: 15) else { fatalError("uploads never finished") }
            guard liveStore.messages.count == 1, liveStore.messages[0].attachments.allSatisfy({ $0.localURL == nil }),
                  liveStore.messages[0].attachments.map(\.id) == files.map({ "sa1-\($0.name)" }) else {
                fatalError("uploads did not land on the pending message in place: \(liveStore.messages[0].attachments)")
            }
            var acked = liveStore.messages[0]
            acked.parts = [
                Part(kind: "text", text: "Two files for review"),
                Part(kind: "attachment", attachment: Attachment(id: "sa1-1", kind: "image", name: "Sunset.png",
                    mimeType: "image/png", size: 5_242_880, url: "/attachments/Sunset.png",
                    thumbnailURL: photo.absoluteString, indexingState: "ready")),
                Part(kind: "attachment", attachment: Attachment(id: "sa1-2", kind: "", name: "Brief.pdf",
                    mimeType: "application/pdf", size: 5_242_880, url: "/attachments/Brief.pdf", indexingState: "ready")),
            ]
            acked.status = "done"
            acked.seq = 1
            let after = Scene(bubble(acked, rings: [:], client: client, scheme: scheme, root: root),
                              scheme: scheme, root: root, width: 520, height: 360)
            await after.settle(0.3)
            try after.snapshot(name: "\(theme)-sa1-bubble-acked", output: output)
        }

        let trace = spans.map { "\($0.name) budget=\($0.budget) duration=\($0.duration) withinBudget=\($0.withinBudget)" }
            .joined(separator: "\n") + "\n"
        try trace.write(to: output.appending(path: "sa1-trace.txt"), atomically: true, encoding: .utf8)
        print("SA1: composer cleared while 2 uploads ran, bubble + 2 rings, budgets \(spans.map(\.duration))")
        print(trace, terminator: "")
    }

    @MainActor private static func store(named name: String, client: APIClient, folder: URL) async throws -> ChatStore {
        let url = folder.appending(path: "cache-\(name).sqlite")
        let cache = try await Task.detached { try LocalCache(url: url) }.value
        let store = ChatStore(client: client, actor: LocalCacheActor(cache), threadID: "sa1", uploadClient: LatencyUploader())
        await store.ready()
        return store
    }

    /// Mirrors MessageBubble's user parts: the text on the user bubble, attachments under it.
    @MainActor private static func bubble(_ message: Message, rings: [String: Double], client: APIClient,
                                          scheme: ColorScheme, root: URL) -> some View {
        VStack(alignment: .trailing, spacing: 12) {
            if !message.text.isEmpty {
                Text(message.text)
                    .padding(12)
                    .background(Assets.color("UserBubble", scheme: scheme, root: root),
                                in: RoundedRectangle(cornerRadius: BubbleStyle.radius))
            }
            ForEach(message.parts.compactMap(\.attachment), id: \.id) { attachment in
                AttachmentPreview(attachment: attachment, client: client, localURL: attachment.localURL,
                                  progress: rings[attachment.id])
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    @MainActor private static func poll(_ condition: () -> Bool, seconds: Double = 5) async -> Bool {
        let deadline = ContinuousClock().now + .seconds(seconds)
        while ContinuousClock().now < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return condition()
    }
}
SWIFT

# The budgets are checked against a release PolymuxKit, as the acceptance criteria specify.
swift build -c release --disable-sandbox --target PolymuxKit >/dev/null
release_products=$(swift build -c release --disable-sandbox --show-bin-path)
swiftc -disable-sandbox -O -swift-version 6 -parse-as-library -D DICTATION_CHECK \
  -target arm64-apple-macosx27.0 -I "$release_products" -I packages/CSQLite \
  "${sources[@]}" "$scratch/SA1Check.swift" "$release_products/PolymuxKit.o" -o "$scratch/sa1-check"
"$scratch/sa1-check" "$out" "$PWD"

# Same harness for iOS, run inside a booted simulator (no mockups: the real views, in the sim).
[ -f .build/env ] && . .build/env
udid="${SIM_UDID:-}"
if [ -z "$udid" ]; then
  udid=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
data = json.load(sys.stdin)["devices"]
for runtime in sorted(data, reverse=True):
    if "iOS" not in runtime: continue
    for device in data[runtime]:
        if device.get("isAvailable") and device["name"].startswith("iPhone"):
            print(device["udid"]); raise SystemExit')
fi
if [ -z "$udid" ]; then echo "ui_snapshots: iOS skipped (no iPhone simulator runtime)"; exit 0; fi
xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1 || true
ios_triple=arm64-apple-ios27.0-simulator
swift build -c release --triple "$ios_triple" --scratch-path .build/ios-snap --disable-sandbox --target PolymuxKit >/dev/null
ios_products=$(swift build -c release --triple "$ios_triple" --scratch-path .build/ios-snap --disable-sandbox --show-bin-path)
xcrun --sdk iphonesimulator swiftc -disable-sandbox -O -swift-version 6 -parse-as-library -D DICTATION_CHECK \
  -target "$ios_triple" -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -I "$ios_products" -I packages/CSQLite \
  "${sources[@]}" "$scratch/SA1Check.swift" "$ios_products/PolymuxKit.o" -o "$scratch/sa1-check-ios"
xcrun simctl spawn "$udid" "$scratch/sa1-check-ios" "$out" "$PWD"
n_ios=$(ls "$out"/ios-*.png 2>/dev/null | wc -l | tr -d ' ')
[ "$n_ios" -gt 0 ] || { echo "ui_snapshots: iOS harness wrote no ios-*.png into $out" >&2; exit 1; }
echo "ui_snapshots: $(ls "$out" | wc -l | tr -d ' ') files in $out ($n_ios iOS)"
