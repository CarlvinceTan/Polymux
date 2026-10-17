import AppKit
import SwiftUI
import PolymuxKit

@MainActor private final class MockInput: SpeechInput {
    let stream = AsyncThrowingStream<VoiceEvent, Error>.makeStream()
    var permission: CheckedContinuation<Void, Never>?
    var waiting = false
    var stops = 0
    var finalizes = 0
    var stalled = false
    var denied = false
    var finalization: CheckedContinuation<Void, Never>?

    func start() async throws -> AsyncThrowingStream<VoiceEvent, Error> {
        if denied { throw VoiceFailure.recognition }
        if waiting { await withCheckedContinuation { permission = $0 } }
        return stream.stream
    }

    func stop() async {
        stops += 1
        stream.continuation.finish()
        finalization?.resume()
        finalization = nil
    }
    func setMuted(_ muted: Bool) {}
    func finalize() async throws {
        finalizes += 1
        if stalled {
            await withCheckedContinuation { finalization = $0 }
            return
        }
        stream.continuation.yield(.transcript(.init(text: "final words", start: 0, end: 1, final: true)))
    }
}

@main private struct DictationCheck {
    @MainActor static func main() async throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        try await lifecycle()
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let root = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        for scheme in [ColorScheme.light, .dark] {
            let theme = scheme == .dark ? "dark" : "light"
            let idle = DictationInput(makeInput: { MockInput() }, denied: { false })
            try await capture(ComposerView.fixture(input: idle), name: "\(theme)-empty", scheme: scheme, root: root, output: output)
            try await capture(ComposerView.fixture(input: idle, text: "Keep this typed draft", focus: true),
                              name: "\(theme)-focused", scheme: scheme, root: root, output: output)
            let source = MockInput()
            let active = DictationInput(makeInput: { source }, denied: { false })
            active.start(transcript: { _ in }, failure: { _ in fatalError("Unexpected failure") })
            await Task.yield()
            source.stream.continuation.yield(.level(0.8))
            await Task.yield()
            try await capture(ComposerView.fixture(input: active, text: "Typed draft and partial words", focus: true),
                              name: "\(theme)-active", scheme: scheme, root: root, output: output)
            await active.stop()
            let denied = DictationInput(makeInput: { MockInput() }, denied: { true })
            try await capture(ComposerView.fixture(input: denied, text: "Keep this typed draft", banner: true),
                              name: "\(theme)-denied", scheme: scheme, root: root, output: output)
            try await capture(ComposerView.fixture(input: idle, text: "Keep this typed draft", issue: "Speech recognition unavailable"),
                              name: "\(theme)-error", scheme: scheme, root: root, output: output)
            try await capture(ComposerView.fixture(input: denied, text: "Keep this typed draft", banner: true),
                              name: "\(theme)-denied-narrow", scheme: scheme, root: root, output: output, width: 320)
        }
        print("Dictation lifecycle checks and 12 native composer snapshots passed")
    }

    @MainActor private static func lifecycle() async throws {
        let pending = MockInput()
        pending.waiting = true
        let next = MockInput()
        var sources = [pending, next]
        let input = DictationInput(makeInput: { sources.removeFirst() }, denied: { false })
        var values: [String] = []
        input.start(transcript: { values.append($0.text) }, failure: { _ in fatalError("Unexpected failure") })
        for _ in 0..<20 where pending.permission == nil { await Task.yield() }
        precondition(pending.permission != nil, "Must exercise a pending system permission prompt")
        let start = ContinuousClock.now
        await input.stop()
        precondition(start.duration(to: .now) < .seconds(0.5), "Stop must not await a system prompt")
        precondition(!input.active && !input.stopping && pending.finalizes == 0)
        input.start(transcript: { values.append($0.text) }, failure: { _ in fatalError("Unexpected failure") })
        pending.permission?.resume()
        pending.permission = nil
        try await Task.sleep(for: .milliseconds(30))
        precondition(input.active, "A cancelled startup must not reset the next session")
        next.stream.continuation.yield(.transcript(.init(text: "partial", start: 0, end: 1, final: false)))
        try await Task.sleep(for: .milliseconds(30))
        await input.stop()
        precondition(values == ["partial", "final words"], "Stop must drain the final transcript before Send")
        precondition(!input.active && !input.stopping && input.level == 0 && next.finalizes == 1)
        let stalled = MockInput()
        stalled.stalled = true
        var paused = false
        let bounded = DictationInput(makeInput: { stalled }, pause: { paused = true }, denied: { false })
        bounded.start(transcript: { _ in }, failure: { _ in fatalError("Unexpected failure") })
        try await Task.sleep(for: .milliseconds(30))
        let contention = Task { @MainActor in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(20)) }
                catch { return }
                occupy()
            }
        }
        let deadline = ContinuousClock.now
        await bounded.stop()
        contention.cancel()
        precondition(deadline.duration(to: .now) < .seconds(1.5), "A stalled finalizer must not block Send")
        precondition(paused && !bounded.active && !bounded.stopping && stalled.finalizes == 1)
        let rejected = MockInput()
        rejected.denied = true
        let unavailable = DictationInput(makeInput: { rejected }, denied: { true })
        var draft = "Keep this typed draft"
        var failed = false
        unavailable.start(transcript: { draft = $0.text }, failure: { _ in failed = true })
        for _ in 0..<20 where !failed { await Task.yield() }
        precondition(failed && unavailable.denied && !unavailable.active)
        precondition(draft == "Keep this typed draft" && rejected.finalizes == 0)

        let shared = MockInput()
        let concurrent = DictationInput(makeInput: { shared }, denied: { false })
        concurrent.start(transcript: { _ in }, failure: { _ in fatalError("Unexpected failure") })
        try await Task.sleep(for: .milliseconds(30))
        async let first: Void = concurrent.stop()
        async let second: Void = concurrent.stop()
        _ = await (first, second)
        precondition(!concurrent.active && !concurrent.stopping && shared.finalizes == 1,
                     "Send and Escape must share one finalization")
    }

    private static func occupy() {
        // Exercise a busy UI thread without extending the finalization deadline.
        Thread.sleep(forTimeInterval: 0.06)
    }

    @MainActor private static func capture<V: View>(_ view: V, name: String, scheme: ColorScheme,
                                                   root: URL, output: URL, width: CGFloat = 480) async throws {
        let colors = root.appending(path: "apps/Polymux/Sources/Assets.xcassets/AccentColor.colorset/Contents.json")
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: colors)) as! [String: Any]
        let entries = json["colors"] as! [[String: Any]]
        let entry = entries[scheme == .dark ? 1 : 0]["color"] as! [String: Any]
        let components = entry["components"] as! [String: String]
        let accent = Color(red: Double(components["red"]!)!, green: Double(components["green"]!)!, blue: Double(components["blue"]!)!)
        let content = view.padding(20).frame(width: width, height: 160, alignment: .bottom)
            .background(AppBackground.color(scheme)).tint(accent).accentColor(accent)
            .environment(\.colorScheme, scheme)
            .background { InputFocus().frame(width: 0, height: 0) }
        let hosting = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 160),
                              styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
        NSApp.appearance = window.appearance
        hosting.appearance = window.appearance
        window.contentView = hosting
        defer { window.close() }
        try await Task.sleep(for: .milliseconds(150))
        hosting.layoutSubtreeIfNeeded()
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
            throw CocoaError(.fileWriteUnknown)
        }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        try png.write(to: output.appending(path: "mac-\(name).png"))
    }
}
