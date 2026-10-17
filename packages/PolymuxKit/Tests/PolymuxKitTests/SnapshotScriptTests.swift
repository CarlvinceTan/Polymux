import Foundation
import XCTest

final class SnapshotScriptTests: XCTestCase {
    func testOutputPaths() throws {
        let result = try run(path: "scripts/verify/test-ui-snapshots.sh", arguments: [])
        XCTAssertEqual(result.status, 0, result.log)
    }

    /// The real macOS pass: the message menu and emoji picker draw content into all eight
    /// positions in both themes. A blank panel fails inside the harness, which fails this test.
    func testMessageViewsRender() throws {
        let output = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("polymux-ma2-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: output) }
        var extra = ["MA2_MAC_ONLY": "1"]
        if let products = productsDirectory() { extra["SNAPSHOT_PRODUCTS"] = products.path }
        let result = try run(path: "scripts/verify/ui_snapshots.sh", arguments: ["MA2", output.path], extra: extra)
        XCTAssertEqual(result.status, 0, result.log)
        XCTAssertTrue(result.log.contains("draw content"), result.log)
        for theme in ["light", "dark"] {
            for view in ["menu", "picker"] {
                for edge in 0..<8 {
                    let name = "mac-\(theme)-\(view)-\(edge).png"
                    let file = output.appendingPathComponent(name)
                    let size = (try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? Int
                    XCTAssertNotNil(size, "missing \(name)")
                    XCTAssertGreaterThan(size ?? 0, 1_000, "\(name) is empty")
                }
            }
        }
    }

    private var root: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private func run(path: String, arguments: [String], extra: [String: String] = [:]) throws -> (status: Int32, log: String) {
        let process = Process()
        process.currentDirectoryURL = root
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [root.appendingPathComponent(path).path] + arguments
        var environment = ProcessInfo.processInfo.environment
        for (key, value) in extra { environment[key] = value }
        process.environment = environment
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }

    /// A PolymuxKit build this checkout already made, so the snapshot script does not build again.
    private func productsDirectory() -> URL? {
        var candidates: [URL] = []
        for scratch in [".build/swiftpm", ".build"] {
            let scratchURL = root.appendingPathComponent(scratch)
            candidates.append(scratchURL.appendingPathComponent("debug"))
            let entries = (try? FileManager.default.contentsOfDirectory(atPath: scratchURL.path)) ?? []
            candidates += entries.filter { $0 != "debug" }.map { scratchURL.appendingPathComponent($0).appendingPathComponent("debug") }
        }
        return candidates.first { candidate in
            let contents = (try? FileManager.default.contentsOfDirectory(atPath: candidate.path)) ?? []
            return contents.contains("libPolymuxKit.a") || contents.contains("libPolymuxKit.dylib")
        }
    }
}
