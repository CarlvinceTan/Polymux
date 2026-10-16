#if os(macOS)
import Foundation

public actor DeviceChannel {
    private let root: URL
    private let driver: EmbeddedDriver
    private let runner = CommandRunner()
    private var credential: DeviceCredential?
    private var session: URLSession?
    private var socket: URLSessionWebSocketTask?
    private var reader: Task<Void, Never>?
    private var work: Task<Void, Never>?
    private var tools: [DeviceTool] = []
    private var seen: Set<String> = []
    private var state = ControlStatus()
    private var settings = ControlState()
    private var generation = UUID()
    private var nativeReady = false
    private var shutdown: Task<Void, Never>?

    public init(root: URL, binary: URL, bundleID: String) {
        self.root = root
        driver = EmbeddedDriver(binary: binary, home: root.appending(path: "RuntimeHome", directoryHint: .isDirectory), bundleID: bundleID)
    }

    public var status: ControlStatus { state }

    public func connect(_ credential: DeviceCredential, settings: ControlState) async throws {
        await stop()
        try Task.checkCancellation()
        let run = UUID(); generation = run
        self.credential = credential; self.settings = settings
        self.tools = []; seen = []
        try await readiness()
        guard run == generation else { throw ControlError.interrupted }
        let transport = PinnedSession(certificate: credential.certificate, host: credential.url.host ?? "").makeSession()
        var components = URLComponents(url: credential.url.appending(path: "connect"), resolvingAgainstBaseURL: false)!
        components.scheme = "wss"
        guard let url = components.url else { throw ControlError.invalidTicket }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        let socket = transport.webSocketTask(with: request)
        socket.maximumMessageSize = 8 << 20
        session = transport; self.socket = socket; socket.resume()
        try await sendHello()
        reader = Task { [weak self] in
            do {
                let hello = try await socket.receive()
                let packet = try Self.decode(hello)
                guard packet.type == "ready" else { throw ControlError.badResponse }
                await self?.acknowledged(run)
                while !Task.isCancelled {
                    let message = try await socket.receive()
                    await self?.received(try Self.decode(message), generation: run)
                }
            } catch { await self?.disconnected(run) }
        }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(15))
            await self?.handshakeTimeout(run)
        }
    }

    private func readiness() async throws {
        try Task.checkCancellation()
        let run = generation
        guard let credential else { throw ControlError.unavailable }
        let accessibility = ControlPermissions.accessibility, screen = ControlPermissions.screen
        if settings.native && credential.capabilities.contains("native") && accessibility && screen {
            do {
                let catalog = try await driver.start()
                try Task.checkCancellation()
                guard run == generation else { throw ControlError.interrupted }
                tools = catalog; nativeReady = true; state.issue = nil
            } catch {
                guard run == generation else { throw ControlError.interrupted }
                state.issue = error.localizedDescription; tools = []; nativeReady = false
            }
        } else {
            nativeReady = false; tools = []; await driver.stop()
            guard run == generation else { throw ControlError.interrupted }
            if settings.native { state.issue = "Allow Accessibility and Screen Recording, then relaunch Polymux." }
            else { state.issue = nil }
        }
        state.ready = DevicePolicy.ready(approved: credential.capabilities, native: settings.native, commands: settings.commands,
            accessibility: accessibility, screen: screen, runtime: nativeReady)
    }

    public func refresh() async throws {
        let current = try ControlState.load(root)
        guard current.enabled, current.revision == settings.revision else { await stop(); throw ControlError.interrupted }
        try await readiness()
        guard socket != nil else { throw ControlError.unavailable }
        try await sendHello()
    }

    private func sendHello() async throws {
        var packet = DevicePacket(type: "hello")
        packet.capabilities = state.ready; packet.tools = state.ready.contains("native") ? tools : []
        try await send(packet)
    }

    private func acknowledged(_ run: UUID) { if generation == run { state.connected = true } }
    private func handshakeTimeout(_ run: UUID) async { if run == generation && !state.connected { await disconnected(run) } }
    private func disconnected(_ run: UUID) async {
        guard run == generation else { return }
        await stop()
        state.issue = "Disconnected. Interrupted actions are not retried."
    }

    private static func decode(_ message: URLSessionWebSocketTask.Message) throws -> DevicePacket {
        let data: Data
        switch message {
        case .data(let value): data = value
        case .string(let value): data = Data(value.utf8)
        @unknown default: throw ControlError.badResponse
        }
        guard data.count <= 8 << 20 else { throw ControlError.badResponse }
        return try JSONDecoder().decode(DevicePacket.self, from: data)
    }

    private func received(_ packet: DevicePacket, generation run: UUID) async {
        guard run == generation, packet.type == "request", let id = packet.id, id.count == 43,
              !seen.contains(id), seen.count < 4096, work == nil else { await disconnected(run); return }
        seen.insert(id)
        work = Task { [weak self] in
            guard let self else { return }
            let result = await self.execute(packet, generation: run)
            guard !Task.isCancelled, await self.generation == run else { return }
            await self.finished(run)
            do { try await self.send(result) } catch { await self.disconnected(run) }
        }
    }

    private func finished(_ run: UUID) { if generation == run { work = nil } }

    private func execute(_ packet: DevicePacket, generation run: UUID) async -> DevicePacket {
        do {
            try Task.checkCancellation()
            guard run == generation else { throw ControlError.interrupted }
            let current = try ControlState.load(root)
            guard current.enabled, current.revision == settings.revision, let credential,
                  let operation = packet.operation, let args = packet.arguments else { throw ControlError.denied }
            var result = DevicePacket(type: "result"); result.id = packet.id
            if operation == "command" {
                guard current.commands, credential.capabilities.contains("commands") else { throw ControlError.denied }
                result.content = [try await runner.run(args, directory: FileManager.default.homeDirectoryForCurrentUser)]
            } else {
                guard current.native, credential.capabilities.contains("native"), nativeReady,
                      ControlPermissions.accessibility, ControlPermissions.screen,
                      let tool = tools.first(where: { $0.name == operation }) else { throw ControlError.denied }
                let directory = Self.capturePath(FileManager.default.temporaryDirectory, id: UUID())
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                defer { try? FileManager.default.removeItem(at: directory) }
                let screenshot = directory.appending(path: "window.png")
                let prepared = try NativeArguments.prepare(args, tool: tool, device: credential.id, screenshot: screenshot)
                let value = try await driver.call(operation, prepared)
                if let blocks = value["content"]?.array {
                    result.content = try blocks.compactMap { block in
                        guard ["text", "image"].contains(block["type"]?.string ?? "") else { return nil }
                        return try JSONDecoder().decode(DeviceContent.self, from: JSONEncoder().encode(block))
                    }
                } else { result.content = [] }
                if FileManager.default.fileExists(atPath: screenshot.path) {
                    let data = try Data(contentsOf: screenshot, options: [.mappedIfSafe])
                    guard data.count <= 4 << 20 else { throw ControlError.badResponse }
                    result.content?.append(DeviceContent(type: "image", data: data.base64EncodedString(), mimeType: "image/png"))
                }
                result.isError = value["isError"]?.bool
            }
            try Task.checkCancellation()
            return result
        } catch { return .failure(packet.id, error.localizedDescription) }
    }

    static func capturePath(_ temporary: URL, id: UUID) -> URL {
        temporary.appending(path: "polymux-captures/\(id.uuidString)", directoryHint: .isDirectory)
    }

    private func send(_ packet: DevicePacket) async throws {
        guard let socket else { throw ControlError.unavailable }
        let data = try JSONEncoder().encode(packet)
        guard data.count <= 8 << 20 else { throw ControlError.badResponse }
        try await socket.send(.data(data))
    }

    public func stop() async {
        if let shutdown { await shutdown.value; return }
        generation = UUID()
        reader?.cancel(); reader = nil
        let previous = work
        previous?.cancel(); work = nil
        socket?.cancel(with: .goingAway, reason: nil); socket = nil
        session?.invalidateAndCancel(); session = nil
        state.connected = false; state.ready = []
        nativeReady = false
        let drain = Task {
            await runner.stop(); await driver.stop()
            await previous?.value
        }
        shutdown = drain
        await drain.value
        shutdown = nil
    }
}
#endif
