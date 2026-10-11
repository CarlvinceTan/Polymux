#if os(macOS)
import XCTest
import Darwin
@testable import LuceControl

@MainActor
final class CommandRunnerTests: XCTestCase {
    func testCommandOutput() async throws {
        let runner = CommandRunner()
        let result = try await runner.run(["command": .string("/bin/echo"), "args": .array([.string("verified")])],
            directory: FileManager.default.temporaryDirectory)
        XCTAssertEqual(result.text, "verified\n")
    }

    func testNoShellExpansion() async throws {
        let runner = CommandRunner()
        let result = try await runner.run(["command": .string("/bin/echo"), "args": .array([.string("$(not-executed); untouched")])],
            directory: FileManager.default.temporaryDirectory)
        XCTAssertEqual(result.text, "$(not-executed); untouched\n")
    }

    func testBoundedOutput() async throws {
        let file = FileManager.default.temporaryDirectory.appending(path: "luce-output-\(UUID().uuidString)")
        try Data(repeating: 120, count: 256 << 10).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let result = try await CommandRunner().run(["command": .string("/bin/cat"), "args": .array([.string(file.path)])],
            directory: FileManager.default.temporaryDirectory)
        XCTAssertEqual(result.text?.utf8.count, 64 << 10)
        XCTAssertTrue(result.text?.hasSuffix("\n[Output truncated at 64 KiB]\n") == true)
    }

    func testCancellation() async throws {
        let runner = CommandRunner()
        let task = Task { try await runner.run(["command": .string("/bin/sleep"), "args": .array([.string("30")])],
            directory: FileManager.default.temporaryDirectory) }
        try await Task.sleep(for: .milliseconds(100))
        task.cancel()
        do { _ = try await task.value; XCTFail("Canceled command succeeded") } catch {}
        let next = try await runner.run(["command": .string("/bin/echo"), "args": .array([.string("new call")])],
            directory: FileManager.default.temporaryDirectory)
        XCTAssertEqual(next.text, "new call\n")
    }

    func testDeniedCommands() async throws {
        for command in ["echo", "/usr/bin/osascript", "/usr/bin/sudo", "/usr/bin/open"] {
            do { _ = try await CommandRunner().run(["command": .string(command)], directory: FileManager.default.temporaryDirectory); XCTFail(command) }
            catch {}
        }
    }

    func testCanceledBeforeLaunch() async throws {
        let marker = FileManager.default.temporaryDirectory.appending(path: "luce-canceled-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: marker) }
        let runner = CommandRunner()
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await runner.run(["command": .string("/usr/bin/touch"), "args": .array([.string(marker.path)])],
                directory: FileManager.default.temporaryDirectory)
        }
        do { _ = try await task.value; XCTFail("Canceled request launched") } catch {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: marker.path))
    }

    func testStopsDescendants() async throws {
        let pidFile = FileManager.default.temporaryDirectory.appending(path: "luce-descendant-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: pidFile) }
        let runner = CommandRunner()
        let script = #"/bin/sleep 30 & echo $! > "$1"; wait"#
        let task = Task { try await runner.run(["command": .string("/bin/sh"),
            "args": .array([.string("-c"), .string(script), .string("fixture"), .string(pidFile.path)])],
            directory: FileManager.default.temporaryDirectory) }
        for _ in 0..<100 {
            if FileManager.default.fileExists(atPath: pidFile.path) { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let pid = try XCTUnwrap(Int32(String(contentsOf: pidFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)))
        task.cancel()
        do { _ = try await task.value; XCTFail("Canceled command succeeded") } catch {}
        for _ in 0..<100 {
            if kill(pid, 0) == -1 && errno == ESRCH { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        kill(pid, SIGKILL)
        XCTFail("Owned command descendant survived shutdown")
    }
}
#endif
