#if os(macOS)
import AppKit
import Combine
import Foundation
import PolymuxKit

/// Runs the bundled Polymux server as a per-user launch agent and repairs it when it stops.
@MainActor
final class ServerRuntime: ObservableObject {
    static let shared = ServerRuntime()

    enum Status: Equatable {
        case stopped
        case starting
        case running
        case failed(String)

        var label: String {
            switch self {
            case .stopped: "Stopped"
            case .starting: "Starting…"
            case .running: "Running"
            case .failed(let reason): "Not running: \(reason)"
            }
        }
    }

    static let address = "http://127.0.0.1:7337"
    static let label = "com.polymux.server"

    @Published private(set) var status: Status = .stopped
    @Published private(set) var enabled: Bool
    @Published private(set) var autoRepair: Bool
    @Published private(set) var cliMessage: String?
    @Published private(set) var migration: String?

    private let defaults = UserDefaults.standard
    private let domain = "gui/\(getuid())"
    private var monitor: Task<Void, Never>?
    private var maintaining = false

    private init() {
        enabled = defaults.bool(forKey: "server.enabled")
        autoRepair = defaults.object(forKey: "server.autoRepair") as? Bool ?? true
        monitor = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.check()
                try? await Task.sleep(for: .seconds(5))
            }
        }
        Task { await check() }
    }

    var root: URL { ClientPaths.rootURL }
    var data: URL { ClientPaths.serverData }
    var logs: URL { ClientPaths.serverLogs }
    var plistURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library/LaunchAgents/\(Self.label).plist")
    }

    var binaryURL: URL? {
        let bundled = Bundle.main.bundleURL.appending(path: "Contents/Helpers/polymux-server")
        if FileManager.default.isExecutableFile(atPath: bundled.path) { return bundled }
        let installed = ClientPaths.serverBin.appending(path: "polymux-server")
        if FileManager.default.isExecutableFile(atPath: installed.path) { return installed }
        return nil
    }

    func setEnabled(_ value: Bool) {
        enabled = value
        defaults.set(value, forKey: "server.enabled")
        Task { value ? await start() : await stop() }
    }

    func setAutoRepair(_ value: Bool) {
        autoRepair = value
        defaults.set(value, forKey: "server.autoRepair")
        Task { await check(force: true) }
    }

    func start() async {
        guard !maintaining else { return }
        maintaining = true
        defer { maintaining = false }
        guard let binary = binaryURL else {
            status = .failed("The server binary is missing. Reinstall Polymux.")
            return
        }
        do {
            try prepare()
            try writePlist(binary: binary)
            status = .starting
            _ = launchctl(["bootout", "\(domain)/\(Self.label)"])
            let boot = launchctl(["bootstrap", domain, plistURL.path])
            if boot.code != 0 && !boot.output.contains("service already loaded") {
                throw RuntimeError(boot.output.isEmpty ? "Could not start the server." : boot.output)
            }
            _ = launchctl(["kickstart", "-k", "\(domain)/\(Self.label)"])
            for _ in 0..<24 {
                if await healthy() {
                    status = .running
                    return
                }
                try? await Task.sleep(for: .milliseconds(250))
            }
            status = .failed("The server did not become healthy. See ~/.polymux/logs/server.err.log.")
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    func stop() async {
        _ = launchctl(["bootout", "\(domain)/\(Self.label)"])
        try? FileManager.default.removeItem(at: plistURL)
        status = .stopped
    }

    func check(force: Bool = false) async {
        guard enabled else {
            if status != .stopped { status = .stopped }
            return
        }
        guard !maintaining else { return }
        if await healthy() {
            if status != .running { status = .running }
            return
        }
        guard force || autoRepair else {
            status = .failed("The server is not responding.")
            return
        }
        await start()
    }

    /// Replaces this Mac's data with a checksummed archive, then starts and verifies the server.
    /// The previous data is kept as a timestamped sibling until the new server is healthy.
    func importArchive(_ archive: URL) async -> Bool {
        guard let cli = cliURL else {
            migration = "The command line tool is missing."
            return false
        }
        let previous = enabled
        migration = "Stopping the local server…"
        await stop()
        let backup = data.deletingLastPathComponent()
            .appending(path: "data.previous-" + UUID().uuidString.lowercased())
        do {
            if FileManager.default.fileExists(atPath: data.path) {
                try FileManager.default.moveItem(at: data, to: backup)
            }
            migration = "Importing data…"
            let process = Process()
            process.executableURL = cli
            process.arguments = ["import", archive.path, "--force"]
            var environment = ProcessInfo.processInfo.environment
            environment["POLYMUX_DATA_DIR"] = data.path
            process.environment = environment
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                let message = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                throw RuntimeError(message.isEmpty ? "Import failed." : message)
            }
            enabled = true
            defaults.set(true, forKey: "server.enabled")
            migration = "Starting and verifying the server…"
            await start()
            guard status == .running else {
                throw RuntimeError("The imported server did not become healthy.")
            }
            if FileManager.default.fileExists(atPath: backup.path) {
                try? FileManager.default.removeItem(at: backup)
            }
            migration = nil
            return true
        } catch {
            try? FileManager.default.removeItem(at: data)
            if FileManager.default.fileExists(atPath: backup.path) {
                try? FileManager.default.moveItem(at: backup, to: data)
            }
            enabled = previous
            defaults.set(previous, forKey: "server.enabled")
            if previous { await start() }
            migration = error.localizedDescription
            return false
        }
    }

    var cliURL: URL? {
        let bundled = Bundle.main.bundleURL.appending(path: "Contents/Helpers/polymux")
        if FileManager.default.isExecutableFile(atPath: bundled.path) { return bundled }
        let installed = ClientPaths.serverBin.appending(path: "polymux")
        if FileManager.default.isExecutableFile(atPath: installed.path) { return installed }
        return nil
    }

    func installCLI() {
        let names = ["polymux", "polymux-server", "polymux-chat"]
        do {
            try prepare()
            for name in names {
                let source = Bundle.main.bundleURL.appending(path: "Contents/Helpers/" + name)
                guard FileManager.default.isExecutableFile(atPath: source.path) else {
                    cliMessage = "The bundled command line tools are missing."
                    return
                }
                let destination = ClientPaths.serverBin.appending(path: name)
                if source.standardizedFileURL == destination.standardizedFileURL { continue }
                if FileManager.default.fileExists(atPath: destination.path) {
                    try FileManager.default.removeItem(at: destination)
                }
                try FileManager.default.copyItem(at: source, to: destination)
                try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: destination.path)
            }
            let bin = FileManager.default.homeDirectoryForCurrentUser.appending(path: ".local/bin")
            try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
            let link = bin.appending(path: "polymux")
            if FileManager.default.fileExists(atPath: link.path) {
                try FileManager.default.removeItem(at: link)
            }
            try FileManager.default.createSymbolicLink(at: link, withDestinationURL: ClientPaths.serverBin.appending(path: "polymux"))
            cliMessage = "Installed at ~/.local/bin/polymux"
        } catch {
            cliMessage = error.localizedDescription
        }
    }

    func openLogs() {
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        NSWorkspace.shared.open(logs)
    }

    func openData() {
        try? FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        NSWorkspace.shared.open(data)
    }

    private func prepare() throws {
        for directory in [root, data, logs, ClientPaths.serverBin] {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
        }
    }

    private func writePlist(binary: URL) throws {
        try FileManager.default.createDirectory(at: plistURL.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        let value: [String: Any] = [
            "Label": Self.label,
            "ProgramArguments": [binary.path, "-data", data.path, "-log-dir", logs.path,
                                 "-listen", "127.0.0.1:7337", "-device-listen", "127.0.0.1:7339"],
            "RunAtLoad": true,
            "KeepAlive": autoRepair,
            "WorkingDirectory": root.path,
            "StandardOutPath": logs.appending(path: "server.out.log").path,
            "StandardErrorPath": logs.appending(path: "server.err.log").path,
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: value, format: .xml, options: 0)
        try data.write(to: plistURL, options: .atomic)
    }

    private func healthy() async -> Bool {
        let tokenFile = data.appending(path: "devices/local-token")
        guard let token = try? String(contentsOf: tokenFile, encoding: .utf8) else { return false }
        guard let url = URL(string: Self.address + "/health") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        request.setValue("Bearer " + token.trimmingCharacters(in: .whitespacesAndNewlines),
                         forHTTPHeaderField: "Authorization")
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func launchctl(_ arguments: [String]) -> (code: Int32, output: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return (process.terminationStatus, String(decoding: data, as: UTF8.self))
        } catch {
            return (1, error.localizedDescription)
        }
    }

    private struct RuntimeError: LocalizedError {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }
}
#endif
