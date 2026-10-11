#if os(macOS)
import Foundation
import Darwin

public actor EmbeddedDriver {
    private let binary: URL
    private let home: URL
    private let bundleID: String
    private var daemon: Process?
    private var proxy: Process?
    private var lifetime: Pipe?
    private var input: FileHandle?
    private var reader: Task<Void, Never>?
    private var directory: URL?
    private var generation = UUID()
    private var nextID = 0
    private var pending: [Int: CheckedContinuation<WireValue, Error>] = [:]
    private var catalog: [DeviceTool] = []
    private var starting: Task<[DeviceTool], Error>?
    private var startID: UUID?
    private var shutdown: Task<Void, Never>?
    private var cleaning: Task<Void, Never>?

    public init(binary: URL, home: URL, bundleID: String) {
        self.binary = binary; self.home = home; self.bundleID = bundleID
    }

    public func start() async throws -> [DeviceTool] {
        if let shutdown { await shutdown.value }
        try Task.checkCancellation()
        if let starting { return try await starting.value }
        if daemon?.isRunning == true && proxy?.isRunning == true && !catalog.isEmpty {
            let run = generation
            do {
                try await permissions()
                guard run == generation else { throw ControlError.interrupted }
                return catalog
            } catch {
                if run == generation { await stop() }
                throw error
            }
        }
        let task = Task { try await self.launch() }
        let id = UUID()
        startID = id
        starting = task
        defer { if startID == id { starting = nil; startID = nil } }
        return try await task.value
    }

    private func launch() async throws -> [DeviceTool] {
        await cleanup()
        try Task.checkCancellation()
        guard FileManager.default.isExecutableFile(atPath: binary.path) else { throw ControlError.unavailable }
        let run = UUID(); generation = run
        let temp = FileManager.default.temporaryDirectory.appending(path: "lc-\(run.uuidString.prefix(8))", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        directory = temp
        let socket = temp.appending(path: "c.sock").path
        guard socket.utf8.count < 104 else { await cleanup(); throw ControlError.unavailable }
        let env = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": home.path, "TMPDIR": temp.path,
                   "CUA_DRIVER_EMBEDDED": "1", "CUA_DRIVER_HOST_BUNDLE_ID": bundleID,
                   "CUA_DRIVER_RS_TELEMETRY_ENABLED": "0", "DO_NOT_TRACK": "1"]
        let host = Process(), alive = Pipe()
        host.executableURL = binary
        host.arguments = ["serve", "--embedded", "--permission-mode", "standard", "--socket", socket, "--parent-liveness-stdio"]
        host.environment = env; host.standardInput = alive
        host.standardOutput = FileHandle.nullDevice; host.standardError = FileHandle.nullDevice
        daemon = host; lifetime = alive
        do {
            try host.run()
            try alive.fileHandleForReading.close()
            for _ in 0..<100 {
                try Task.checkCancellation()
                guard run == generation, host.isRunning else { throw ControlError.unavailable }
                if FileManager.default.fileExists(atPath: socket) { break }
                try await Task.sleep(for: .milliseconds(100))
            }
            guard FileManager.default.fileExists(atPath: socket) else { throw ControlError.unavailable }
            let process = Process(), to = Pipe(), from = Pipe()
            process.executableURL = binary; process.arguments = ["mcp", "--embedded", "--socket", socket]
            process.environment = env; process.standardInput = to; process.standardOutput = from
            process.standardError = FileHandle.nullDevice
            proxy = process; input = to.fileHandleForWriting
            try process.run()
            try to.fileHandleForReading.close(); try from.fileHandleForWriting.close()
            reader = Task { [weak self] in
                do {
                    var line = Data()
                    for try await byte in from.fileHandleForReading.bytes {
                        if byte == 10 {
                            if !line.isEmpty { await self?.received(line, generation: run) }
                            line.removeAll(keepingCapacity: true)
                        } else {
                            guard line.count < 8 << 20 else { throw ControlError.badResponse }
                            line.append(byte)
                        }
                    }
                } catch {}
                await self?.failed(run)
            }
            _ = try await rpc("initialize", .object(["protocolVersion": .string("2024-11-05"), "capabilities": .object([:]),
                 "clientInfo": .object(["name": .string("Luce"), "version": .string("0.1")])]))
            try send(.object(["jsonrpc": .string("2.0"), "method": .string("notifications/initialized")]))
            let result = try await rpc("tools/list", .object([:]))
            guard let tools = result["tools"]?.array else { throw ControlError.badResponse }
            catalog = try tools.compactMap { value in
                guard let name = value["name"]?.string, DevicePolicy.nativeTools.contains(name) else { return nil }
                return try JSONDecoder().decode(DeviceTool.self, from: JSONEncoder().encode(value))
            }
            try await permissions()
            let health = try await call("health_report", ["include": .array([.string("bundle_identity")])])
            let identity = health["structuredContent"]?["checks"]?.array?.first { $0["name"]?.string == "bundle_identity" }
            guard identity?["status"]?.string == "pass", identity?["data"]?["bundle_identifier"]?.string == bundleID,
                  identity?["data"]?["identity_source"]?.string == "parent_application",
                  identity?["data"]?["parent_process_id"] == .number(Double(ProcessInfo.processInfo.processIdentifier)) else { throw ControlError.unavailable }
            let screenshot = temp.appending(path: "readiness.png")
            let proof = try await call("get_desktop_state", ["session": .string("luce-readiness"),
                "max_image_dimension": .number(1024), "screenshot_out_file": .string(screenshot.path)])
            let png = try Data(contentsOf: screenshot)
            defer { try? FileManager.default.removeItem(at: screenshot) }
            guard proof["isError"]?.bool != true, png.count > 24,
                  png.prefix(8) == Data([137, 80, 78, 71, 13, 10, 26, 10]) else { throw ControlError.denied }
            _ = try await call("end_session", ["session": .string("luce-readiness")])
            return catalog
        } catch {
            if generation == run { await cleanup() }
            throw error
        }
    }

    public func call(_ name: String, _ arguments: [String: WireValue]) async throws -> WireValue {
        try await rpc("tools/call", .object(["name": .string(name), "arguments": .object(arguments)]))
    }

    private func permissions() async throws {
        let result = try await call("check_permissions", [:])
        let source = result["structuredContent"]?["source"]
        guard source?["attribution"]?.string == "host", source?["host_bundle_id"]?.string == bundleID,
              result["structuredContent"]?["accessibility"]?.bool == true,
              result["structuredContent"]?["screen_recording"]?.bool == true else { throw ControlError.denied }
    }

    private func rpc(_ method: String, _ params: WireValue) async throws -> WireValue {
        try Task.checkCancellation()
        guard daemon?.isRunning == true && proxy?.isRunning == true else { throw ControlError.unavailable }
        let run = generation
        nextID += 1
        let id = nextID
        let timeout = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(90)) } catch { return }
            await self?.failed(run)
        }
        defer { timeout.cancel() }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard !Task.isCancelled else { continuation.resume(throwing: ControlError.interrupted); return }
                pending[id] = continuation
                do { try send(.object(["jsonrpc": .string("2.0"), "id": .number(Double(id)), "method": .string(method), "params": params])) }
                catch { pending.removeValue(forKey: id)?.resume(throwing: error) }
            }
        } onCancel: { Task { await self.failed(run) } }
    }

    private func send(_ value: WireValue) throws {
        guard let input else { throw ControlError.unavailable }
        var data = try JSONEncoder().encode(value); data.append(10)
        try input.write(contentsOf: data)
    }

    private func received(_ data: Data, generation run: UUID) {
        guard run == generation, let value = try? JSONDecoder().decode(WireValue.self, from: data),
              case .number(let number) = value["id"], let id = Int(exactly: number), id >= 0,
              let continuation = pending.removeValue(forKey: id) else { return }
        if value["error"] != nil { continuation.resume(throwing: ControlError.unavailable) }
        else if let result = value["result"] { continuation.resume(returning: result) }
        else { continuation.resume(throwing: ControlError.badResponse) }
    }

    private func failed(_ run: UUID) async { if run == generation { await stop() } }

    public func stop() async {
        if let shutdown { await shutdown.value; return }
        let task = starting
        starting = nil; startID = nil
        task?.cancel()
        let drain = Task {
            await cleanup()
            _ = try? await task?.value
        }
        shutdown = drain
        await drain.value
        shutdown = nil
    }

    private func cleanup() async {
        if let cleaning { await cleaning.value; return }
        generation = UUID(); catalog = []
        reader?.cancel(); reader = nil
        try? input?.close(); input = nil
        try? lifetime?.fileHandleForWriting.close(); lifetime = nil
        let children = [proxy, daemon].compactMap { $0 }
        proxy = nil; daemon = nil
        for (_, continuation) in pending { continuation.resume(throwing: ControlError.interrupted) }
        pending.removeAll()
        for child in children where child.isRunning { child.terminate() }
        let oldDirectory = directory; directory = nil
        let drain = Task {
            for _ in 0..<20 {
                if children.allSatisfy({ !$0.isRunning }) { break }
                try? await Task.sleep(for: .milliseconds(50))
            }
            for child in children where child.isRunning { kill(child.processIdentifier, SIGKILL) }
            while children.contains(where: { $0.isRunning }) { try? await Task.sleep(for: .milliseconds(20)) }
            if let oldDirectory { try? FileManager.default.removeItem(at: oldDirectory) }
        }
        cleaning = drain
        await drain.value
        cleaning = nil
    }
}
#endif
