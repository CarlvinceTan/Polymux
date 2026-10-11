#if os(macOS)
import XCTest
@testable import LuceControl

@MainActor
final class ChannelTests: XCTestCase {
    private func fixture() throws -> (Process, FileHandle, FileHandle, URL, PairTicket) {
        guard let binary = ProcessInfo.processInfo.environment["LUCE_DEVICE_FIXTURE"] else {
            throw XCTSkip("Build tests/device_fixture and set LUCE_DEVICE_FIXTURE for pinned TLS integration.")
        }
        let root = FileManager.default.temporaryDirectory.appending(path: "luce-channel-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let process = Process(), input = Pipe(), output = Pipe()
        process.executableURL = URL(fileURLWithPath: binary); process.arguments = ["-data", root.path]
        process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
        try process.run()
        try input.fileHandleForReading.close(); try output.fileHandleForWriting.close()
        addTeardownBlock {
            try? input.fileHandleForWriting.close()
            if process.isRunning { process.terminate() }
            process.waitUntilExit()
            try? FileManager.default.removeItem(at: root)
        }
        let first = try JSONDecoder().decode([String: String].self, from: output.fileHandleForReading.availableData)
        let ticket = try PairTicket.parse(first["ticket"] ?? "", server: URL(string: "http://127.0.0.1:7337")!)
        return (process, input.fileHandleForWriting, output.fileHandleForReading, root, ticket)
    }

    func testPinnedTLSChannel() async throws {
        let (_, input, output, root, ticket) = try fixture()
        let credential = try await Pairing.enroll(ticket, capabilities: ["commands"], name: "Fixture")
        var settings = ControlState(); settings.enabled = true; settings.commands = true; try settings.save(root)
        let channel = DeviceChannel(root: root, binary: root.appending(path: "not-installed"), bundleID: "com.test.luce")
        try await channel.connect(credential, settings: settings)
        for _ in 0..<100 {
            if await channel.status.connected { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let status = await channel.status
        XCTAssertTrue(status.connected)
        XCTAssertEqual(status.ready, ["commands"])
        struct Call: Encodable { let device: String; let operation: String; let arguments: [String: WireValue] }
        for index in 0..<3 {
            let call = Call(device: credential.id, operation: "command", arguments: ["command": .string("/bin/echo"), "args": .array([.string("fixture-\(index)")])])
            var data = try JSONEncoder().encode(call); data.append(10); try input.write(contentsOf: data)
            let result = try JSONDecoder().decode(DevicePacket.self, from: await Task.detached { output.availableData }.value)
            XCTAssertEqual(result.content?.first?.text, "fixture-\(index)\n")
            XCTAssertNotEqual(result.isError, true)
        }
        try await Pairing.revoke(credential)
        await channel.stop()
        let stopped = await channel.status
        XCTAssertFalse(stopped.connected)
        XCTAssertEqual(stopped.ready, [])
    }

    func testWrongPin() async throws {
        let (_, _, _, _, ticket) = try fixture()
        let (_, _, _, _, other) = try fixture()
        let altered = PairTicket(version: ticket.version, url: ticket.url, certificate: other.certificate,
            code: ticket.code, agent: ticket.agent, capabilities: ticket.capabilities)
        do { _ = try await Pairing.enroll(altered, capabilities: ["commands"], name: "Fixture"); XCTFail("Wrong TLS identity accepted") } catch {}
        let credential = try await Pairing.enroll(ticket, capabilities: ["commands"], name: "Fixture")
        try await Pairing.revoke(credential)
    }

    func testDisconnectDoesNotReplay() async throws {
        let (_, input, output, root, ticket) = try fixture()
        let credential = try await Pairing.enroll(ticket, capabilities: ["commands"], name: "Fixture")
        var settings = ControlState(); settings.enabled = true; settings.commands = true; try settings.save(root)
        let channel = DeviceChannel(root: root, binary: root.appending(path: "not-installed"), bundleID: "com.test.luce")
        try await channel.connect(credential, settings: settings)
        for _ in 0..<100 {
            if await channel.status.connected { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let marker = root.appending(path: "effects.txt")
        let script = #"echo before >> "$1"; /bin/sleep 30; echo after >> "$1""#
        let call: WireValue = .object(["device": .string(credential.id), "operation": .string("command"),
            "arguments": .object(["command": .string("/bin/sh"),
                "args": .array([.string("-c"), .string(script), .string("fixture"), .string(marker.path)])])])
        var data = try JSONEncoder().encode(call); data.append(10); try input.write(contentsOf: data)
        for _ in 0..<100 {
            if FileManager.default.fileExists(atPath: marker.path) { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertEqual(try String(contentsOf: marker, encoding: .utf8), "before\n")
        await channel.stop()
        let unknown = try JSONDecoder().decode([String: String].self, from: await Task.detached { output.availableData }.value)
        XCTAssertTrue(unknown["error"]?.contains("unknown") == true)
        try await channel.connect(credential, settings: settings)
        for _ in 0..<100 {
            if await channel.status.connected { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let connected = await channel.status.connected
        XCTAssertTrue(connected)
        XCTAssertEqual(try String(contentsOf: marker, encoding: .utf8), "before\n")
        settings.enabled = false; settings.revision = UUID(); try settings.save(root)
        do { try await channel.refresh(); XCTFail("Disabled channel remained active") } catch {}
        let stopped = await channel.status
        XCTAssertFalse(stopped.connected)
        try await Pairing.revoke(credential)
    }
}
#endif
