import AppKit
import SwiftUI
import XCTest
import PolymuxKit
import AvatarKit

final class ActivitySnapshots: XCTestCase {
    func testImages() throws {
        try MainActor.assumeIsolated {
            let out = try XCTUnwrap(ProcessInfo.processInfo.environment["OUTDIR"])
            try FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
            let names = ["chief": "Chief", "aria": "Aria", "liam": "Liam"]
            let kinds = ["routine.created", "agent.messaged", "memory.saved", "agent.messaged", "routine.paused"]
            let verbs = ["Created", "Messaged", "Saved", "Messaged", "Paused"]
            let events = kinds.enumerated().map { index, kind in
                Event(seq: Int64(index + 1), conversationID: "chief", type: "activity",
                      payload: Activity(kind: kind, verb: verbs[index], objectLabel: "Account and session health",
                                        agentIDs: kind == "agent.messaged" ? (index == 1 ? ["chief", "aria"] : ["chief", "aria", "liam"]) : nil))
            }
            let rows = PolymuxKit.ActivityRow.collapse(events)
            for scheme in [ColorScheme.light, .dark] {
                let theme = scheme == .dark ? "dark" : "light"
                let content = VStack(spacing: 0) {
                    Text("Today 1:06 PM").font(.caption).foregroundStyle(ActivityInk.color(scheme)).padding(14)
                    ForEach(rows) { row in
                        ActivityLine(row: row, names: names, currentAgent: "chief", avatar: Self.face, open: { _ in })
                    }
                    ActivityLine(row: PolymuxKit.ActivityRow.collapse((1...3).map { i in
                        Event(seq: Int64(i), conversationID: "chief", type: "activity",
                              payload: Activity(kind: "memory.saved", verb: "Saved", objectLabel: "Preference"))
                    })[0], names: names, currentAgent: "chief", avatar: Self.face, open: { _ in })
                }
                .padding(20).frame(width: 640)
                .background(scheme == .dark ? Color(white: 0.08) : .white)
                .environment(\.colorScheme, scheme)
                try Self.render(content, to: out + "/activity-\(theme).png", checksInk: scheme)
                let popover = BotsList(agents: ["chief", "aria", "liam"], names: names, currentAgent: "chief", avatar: Self.face, pick: { _ in })
                    .environment(\.colorScheme, scheme)
                try Self.render(popover, to: out + "/bots-\(theme).png")
                let empty = BotsList(agents: [], names: names, avatar: Self.face, pick: { _ in })
                    .environment(\.colorScheme, scheme)
                try Self.render(empty, to: out + "/bots-empty-\(theme).png")
                let states = VStack(spacing: 0) {
                    BotLabel(name: "Aria", avatar: Self.face("aria"), hovered: true)
                    BotLabel(name: "Liam", avatar: Self.face("liam"), focused: true)
                    BotLabel(name: "Chief", avatar: Self.face("chief")).opacity(0.5)
                }
                .foregroundStyle(.primary).frame(width: 240).padding(8)
                .background(PanelSurface.color(scheme)).environment(\.colorScheme, scheme)
                try Self.render(states, to: out + "/bots-states-\(theme).png")
                let long = BotsList(agents: ["chief", "aria", "liam"],
                                    names: ["aria": "Aria with a very long agent name that must truncate"],
                                    currentAgent: "chief", avatar: Self.face, pick: { _ in })
                    .environment(\.colorScheme, scheme)
                try Self.render(long, to: out + "/bots-long-\(theme).png")
                let chief = Agent(id: "chief", name: "Chief")
                let aria = Agent(id: "aria", name: "Aria")
                var history: [Message] = []
                for i in 0..<40 {
                    let text = i % 2 == 0 ? "Check the account and session health." : "The accounts are healthy. No action is needed."
                    let date = Date(timeIntervalSince1970: 1_760_000_000 + Double(i) * 1900)
                    history.append(Message(id: "history-\(i)", threadID: "chief", role: "assistant",
                                           parts: [Part(kind: "text", text: text)], createdAt: WireDate.string(date),
                                           status: "done", seq: Int64(i + 1), agentID: i % 2 == 0 ? "chief" : "aria"))
                }
                for state in ["empty", "long", "loading", "error"] {
                    let panel = HistoryContent(current: chief, peer: aria, messages: state == "long" ? history : [],
                                               loading: state == "loading", issue: state == "error" ? "History is unavailable. Try again." : nil,
                                               avatar: Self.face, close: {})
                    let desktop = HistoryOverlay(close: {}) { panel }
                        .frame(width: 640, height: 740).background(PanelSurface.color(scheme))
                        .environment(\.colorScheme, scheme)
                    try Self.renderHosted(desktop, to: out + "/history-\(state)-\(theme).png")
                    try Self.renderHosted(panel.frame(width: 390, height: 844).environment(\.colorScheme, scheme),
                                    to: out + "/history-mobile-\(state)-\(theme).png")
                }
            }
        }
    }

    @MainActor private static func face(_ id: String) -> some View {
        var options = AvatarOptions()
        options.shape = id == "chief" ? .circle : .hexagon
        options.color = id == "aria" ? .orange : .ink
        options.animates = false
        options.followCursor = false
        return AvatarView(options: options, playing: false, frozenAt: 0)
    }

    @MainActor private static func render<V: View>(_ view: V, to path: String, checksInk: ColorScheme? = nil) throws {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.cgImage)
        let bitmap = NSBitmapImageRep(cgImage: image)
        var colors = Set<String>()
        for y in stride(from: 0, to: bitmap.pixelsHigh, by: 4) {
            for x in stride(from: 0, to: bitmap.pixelsWide, by: 4) {
                if let color = bitmap.colorAt(x: x, y: y) { colors.insert(color.description) }
            }
        }
        XCTAssertGreaterThan(colors.count, 4, "Rendered content is blank: \(path)")
        let png = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
        XCTAssertGreaterThan(png.count, 100)
        if let checksInk { try contrast(png, scheme: checksInk) }
        try png.write(to: URL(fileURLWithPath: path))
    }

    @MainActor private static func renderHosted<V: View>(_ view: V, to path: String) throws {
        let host = NSHostingView(rootView: view)
        let size = host.fittingSize
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        host.frame = NSRect(origin: .zero, size: size)
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        let bitmap = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
        try png.write(to: URL(fileURLWithPath: path))
        XCTAssertGreaterThan(png.count, 1000, "History content was not rendered: \(path)")
        window.orderOut(nil)
    }

    @MainActor private static func contrast(_ png: Data, scheme: ColorScheme) throws {
        let bitmap = try XCTUnwrap(NSBitmapImageRep(data: png))
        let expectedInk = scheme == .dark ? 166 : 92
        let expectedSurface = scheme == .dark ? 20 : 255
        var inkPixels = 0
        var surfacePixels = 0
        for y in 0..<bitmap.pixelsHigh {
            for x in 0..<bitmap.pixelsWide {
                var pixel = [UInt](repeating: 0, count: bitmap.samplesPerPixel)
                bitmap.getPixel(&pixel, atX: x, y: y)
                let bytes = [Int(pixel[0]), Int(pixel[1]), Int(pixel[2])]
                if bytes.allSatisfy({ abs($0 - expectedInk) <= 1 }) { inkPixels += 1 }
                if bytes.allSatisfy({ abs($0 - expectedSurface) <= 1 }) { surfacePixels += 1 }
            }
        }
        XCTAssertGreaterThan(inkPixels, 50, "Expected activity text ink was not rendered")
        XCTAssertGreaterThan(surfacePixels, bitmap.pixelsWide * bitmap.pixelsHigh / 2)
        func luminance(_ byte: Int) -> Double {
            let value = Double(byte) / 255
            return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        let surface = luminance(expectedSurface)
        let text = luminance(expectedInk)
        XCTAssertGreaterThanOrEqual((max(text, surface) + 0.05) / (min(text, surface) + 0.05), 4.5)
    }
}
