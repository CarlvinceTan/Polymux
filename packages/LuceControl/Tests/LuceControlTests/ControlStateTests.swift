#if os(macOS)
import XCTest
@testable import LuceControl

final class ControlStateTests: XCTestCase {
    private func directory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appending(path: "luce-control-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    func testDefaultsAndPersistence() throws {
        let root = try directory()
        // This Mac is ready on connection; the user only grants permissions.
        let defaults = try ControlState.load(root)
        XCTAssertTrue(defaults.enabled)
        XCTAssertTrue(defaults.native)
        XCTAssertFalse(defaults.commands)
        var state = ControlState(); state.enabled = false; state.native = false
        try state.save(root)
        XCTAssertEqual(try ControlState.load(root), state)
        XCTAssertFalse(try ControlState.load(root).enabled)
    }

    func testExclusiveOwner() throws {
        let root = try directory()
        var first: ControlLease? = ControlLease(root: root)
        XCTAssertNotNil(first)
        XCTAssertNil(ControlLease(root: root))
        first = nil
        let next = ControlLease(root: root)
        XCTAssertNotNil(next)
        withExtendedLifetime(next) {}
    }

    func testNativeBounds() throws {
        let screenshot = URL(fileURLWithPath: "/private/capture/window.png")
        let tool = DeviceTool(name: "get_window_state", description: nil,
            inputSchema: .object(["properties": .object(["session": .object([:]), "screenshot_out_file": .object([:])])]))
        let args = try NativeArguments.prepare(["session": .string("work"), "screenshot_out_file": .string("/someone/else.png")],
            tool: tool, device: "abcdefgh123", screenshot: screenshot)
        XCTAssertEqual(args["session"]?.string, "luce-abcdefgh-work")
        XCTAssertEqual(args["screenshot_out_file"]?.string, screenshot.path)
        for input: [String: WireValue] in [["delivery_mode": .string("foreground")], ["target": .object(["kind": .string("desktop")])],
            ["_bypass": .bool(true)], ["session": .string("../../other")]] {
            XCTAssertThrowsError(try NativeArguments.prepare(input, tool: tool, device: "abcdefgh", screenshot: screenshot))
        }
    }
}
#endif
