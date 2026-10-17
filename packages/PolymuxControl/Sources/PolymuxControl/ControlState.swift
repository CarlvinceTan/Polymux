#if os(macOS)
import Foundation
import ApplicationServices
import CoreGraphics
import Darwin

public struct ControlState: Codable, Sendable, Equatable {
    // This Mac is ready to work with its agents on connection; the user only grants
    // permissions. Pairing still requires a code issued on the server.
    public var enabled = true
    public var native = true
    public var commands = false
    public var permissionRequest = false
    public var revision = UUID()
    public init() {}
    public static func load(_ root: URL) throws -> ControlState {
        let path = root.appending(path: "settings.json")
        guard FileManager.default.fileExists(atPath: path.path) else { return ControlState() }
        return try JSONDecoder().decode(ControlState.self, from: Data(contentsOf: path))
    }
    public func save(_ root: URL) throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let path = root.appending(path: "settings.json")
        try JSONEncoder().encode(self).write(to: path, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
    }
}

public struct ControlStatus: Codable, Sendable {
    public var connected = false
    public var ready: [String] = []
    public var issue: String?
    public var updated = Date()
    public init() {}
    public static func load(_ root: URL) -> ControlStatus? {
        guard let data = try? Data(contentsOf: root.appending(path: "status.json")),
              let state = try? JSONDecoder().decode(ControlStatus.self, from: data),
              state.updated > Date().addingTimeInterval(-10) else { return nil }
        return state
    }
    public func save(_ root: URL) {
        let path = root.appending(path: "status.json")
        if let data = try? JSONEncoder().encode(self) { try? data.write(to: path, options: [.atomic]) }
    }
}

public enum ControlPermissions {
    public static var accessibility: Bool { AXIsProcessTrusted() }
    public static var screen: Bool { CGPreflightScreenCaptureAccess() }
    @MainActor public static func request() {
        _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
        _ = CGRequestScreenCaptureAccess()
    }
}

public enum NativeArguments {
    public static func prepare(_ values: [String: WireValue], tool: DeviceTool, device: String, screenshot: URL) throws -> [String: WireValue] {
        guard DevicePolicy.nativeTools.contains(tool.name), values["target"]?["kind"]?.string != "desktop",
              values["scope"]?.string != "desktop", values["delivery_mode"]?.string != "foreground" else { throw ControlError.denied }
        var args = values
        guard !args.keys.contains(where: { $0.hasPrefix("_") }) else { throw ControlError.denied }
        if tool.inputSchema["properties"]?["session"] != nil {
            let label = args["session"]?.string ?? "work"
            guard !label.isEmpty, label.utf8.count <= 32, label.allSatisfy({ $0.isLetter || $0.isNumber || "-_".contains($0) }) else { throw ControlError.denied }
            args["session"] = .string("polymux-\(device.prefix(8))-\(label)")
        }
        if tool.inputSchema["properties"]?["screenshot_out_file"] != nil { args["screenshot_out_file"] = .string(screenshot.path) }
        else if args["screenshot_out_file"] != nil { throw ControlError.denied }
        return args
    }
}

public final class ControlLease: @unchecked Sendable {
    private let fd: Int32
    public init?(root: URL) {
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        fd = Darwin.open(root.appending(path: "owner.lock").path, O_CREAT | O_RDWR | O_CLOEXEC, 0o600)
        guard fd >= 0 else { return nil }
        if flock(fd, LOCK_EX | LOCK_NB) != 0 { Darwin.close(fd); return nil }
    }
    deinit { flock(fd, LOCK_UN); Darwin.close(fd) }
}
#endif
