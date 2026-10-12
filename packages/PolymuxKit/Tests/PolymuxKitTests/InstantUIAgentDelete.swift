import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PolymuxKit

@Suite("InstantUIAgentDelete", .serialized) @MainActor
struct InstantUIAgentDelete {
    @Test func rowHidesBeforeServerAnswers() async throws {
        let rig = try Rig()
        defer {
            await rig.gate.resume()
            rig.cleanup()
        }
        rig.sidebar.removeAgent(id: "gone")
        let row = try #require(rig.sidebar.signposts.first { $0.name == InstantTrace.row })
        #expect(row.duration <= InstantBudget.rowRemoval)
        #expect(!rig.lists("gone"))
        #expect(rig.lists("kept"))
        #expect(rig.sidebar.threads.contains { $0.id == "gone" })
        #expect(rig.sidebar.listedThreads.contains { $0.id == "group" })

        let task = Task { try await rig.sidebar.deleteAgent(id: "gone") }
        let hidden = try await rig.gate.hiddenAtRequest()
        #expect(hidden)
        #expect(!rig.lists("gone"))
        await rig.gate.resume()
        try await task.value

        #expect(!rig.lists("gone"))
        #expect(!rig.sidebar.threads.contains { $0.id == "gone" })
        #expect(rig.lists("kept"))
        #expect(rig.sidebar.threads.contains { $0.id == "group" })
        #expect(try rig.cache.agents().map(\.id) == ["kept"])
        #expect(try rig.cache.messages(threadID: "gone").isEmpty)
        #expect(try rig.cache.messages(threadID: "kept").count == 1)
    }

    @Test func forcedFailureRollsBack() async throws {
        let rig = try Rig(failing: true)
        defer {
            await rig.gate.resume()
            rig.cleanup()
        }
        let before = try rig.cache.messages(threadID: "gone")
        rig.sidebar.removeAgent(id: "gone")
        #expect(!rig.lists("gone"))

        await #expect(throws: ClientError.self) { try await rig.sidebar.deleteAgent(id: "gone") }

        let rollback = try #require(rig.sidebar.signposts.first { $0.name == InstantTrace.rollback })
        #expect(rollback.duration <= InstantBudget.rollback)
        let row = try #require(rig.sidebar.signposts.first { $0.name == InstantTrace.row })
        #expect(row.duration <= InstantBudget.rowRemoval)
        #expect(rig.lists("gone"))
        #expect(rig.lists("kept"))
        #expect(rig.sidebar.agents.map(\.id) == ["gone", "kept"])
        #expect(rig.sidebar.threads.contains { $0.id == "group" })
        #expect(try rig.cache.messages(threadID: "gone") == before)
        #expect(try rig.cache.messages(threadID: "kept").count == 1)
        #expect(try rig.cache.agents().map(\.id) == ["gone", "kept"])
    }

    @Test func refreshKeepsRowHiddenUntilFailure() async throws {
        let rig = try Rig()
        defer {
            await rig.gate.resume()
            rig.cleanup()
        }
        rig.sidebar.removeAgent(id: "gone")
        let task = Task { try await rig.sidebar.deleteAgent(id: "gone") }
        let hidden = try await rig.gate.hiddenAtRequest()
        #expect(hidden)
        await rig.sidebar.refresh()
        #expect(!rig.lists("gone"))
        #expect(rig.sidebar.threads.contains { $0.id == "gone" })
        #expect(rig.lists("kept"))
        #expect(rig.sidebar.listedThreads.contains { $0.id == "group" })
        await rig.gate.fail()
        await #expect(throws: ClientError.self) { try await task.value }
        let rollback = try #require(rig.sidebar.signposts.first { $0.name == InstantTrace.rollback })
        #expect(rollback.duration <= InstantBudget.rollback)
        #expect(rig.lists("gone"))
        #expect(try rig.cache.messages(threadID: "gone").count == 1)
        #expect(try rig.cache.messages(threadID: "kept").count == 1)
    }
}

@MainActor
private final class Rig {
    let cache: LocalCache
    let sidebar: SidebarStore
    let gate: DeleteGate
    private let host: String
    private let directory: URL

    init(failing: Bool = false) throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("polymux-instant-\(UUID())")
        let url = directory.appendingPathComponent("cache.sqlite")
        cache = try LocalCache(url: url)
        let gone = Agent(id: "gone", name: "Gone")
        let kept = Agent(id: "kept", name: "Kept")
        let threads = [
            Thread(id: "gone", agentID: "gone", title: "Gone", agentIDs: ["gone"]),
            Thread(id: "kept", agentID: "kept", title: "Kept", agentIDs: ["kept"]),
            Thread(id: "group", agentID: "kept", title: "Group", agentIDs: ["gone", "kept"])
        ]
        try cache.save(agents: [gone, kept], threads: threads)
        for id in ["gone", "kept"] {
            let message = Message(id: "\(id)-reply", threadID: id, role: "assistant",
                                  parts: [Part(kind: "text", text: "A notebook in \(id)")],
                                  createdAt: "2026-10-09T10:00:00Z", status: "done", seq: 1)
            try cache.apply(Event(seq: 1, conversationID: id, type: "message.start", message: message, createdAt: message.createdAt))
            try cache.apply(Event(seq: 2, conversationID: id, type: "message.done", messageID: message.id, createdAt: message.createdAt))
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [DeleteProtocol.self]
        let slot = SidebarSlot()
        gate = DeleteGate(slot: slot, failing: failing)
        host = DeleteProtocol.routes.add { [gate] request in try await gate.handle(request) }
        let client = APIClient(baseURL: URL(string: "http://\(host)")!, session: URLSession(configuration: config))
        sidebar = SidebarStore(client: client, cache: cache)
        slot.store(sidebar)
    }

    func lists(_ id: String) -> Bool {
        sidebar.listedThreads.contains { !$0.isGroup && $0.agentID == id }
    }

    func cleanup() {
        DeleteProtocol.routes.remove(host)
        try? FileManager.default.removeItem(at: directory)
    }
}

private final class SidebarSlot: @unchecked Sendable {
    private let lock = NSLock()
    private var sidebar: SidebarStore?
    func store(_ sidebar: SidebarStore) { lock.withLock { self.sidebar = sidebar } }
    var current: SidebarStore? { lock.withLock { sidebar } }
}

private actor DeleteGate {
    private let slot: SidebarSlot
    private var failing: Bool
    private var release: CheckedContinuation<Void, Never>?
    private var waiter: CheckedContinuation<Bool, Never>?
    private var rowHidden = false
    private var sawDelete = false

    init(slot: SidebarSlot, failing: Bool) {
        self.slot = slot
        self.failing = failing
    }

    func handle(_ request: URLRequest) async throws -> (Int, Data) {
        let path = request.url?.path ?? ""
        let method = request.httpMethod ?? "GET"
        if method == "DELETE" {
            let listed = await slot.current?.listedThreads
            rowHidden = listed?.contains { !$0.isGroup && $0.agentID == "gone" } == false
            sawDelete = true
            waiter?.resume(returning: rowHidden)
            waiter = nil
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                if failing { continuation.resume() } else { release = continuation }
            }
            if failing {
                return (500, try JSONEncoder().encode(WireError(code: "forced", message: "Forced failure")))
            }
            return (200, try JSONEncoder().encode(DeleteResponse(deleted: true)))
        }
        if path == "/agents" {
            return (200, try JSONEncoder().encode([Agent(id: "gone", name: "Gone"), Agent(id: "kept", name: "Kept")]))
        }
        if path == "/threads" {
            return (200, try JSONEncoder().encode([
                Thread(id: "gone", agentID: "gone", title: "Gone", agentIDs: ["gone"]),
                Thread(id: "kept", agentID: "kept", title: "Kept", agentIDs: ["kept"]),
                Thread(id: "group", agentID: "kept", title: "Group", agentIDs: ["gone", "kept"])
            ]))
        }
        return (200, Data("[]".utf8))
    }

    func hiddenAtRequest() async throws -> Bool {
        if sawDelete { return rowHidden }
        return try await withThrowingTaskGroup(of: Bool.self) { group in
            group.addTask { await self.waitHidden() }
            group.addTask {
                try await Task.sleep(for: .seconds(3))
                throw ClientError.response(408, "Delete did not start.")
            }
            let value = try await group.next() ?? false
            group.cancelAll()
            return value
        }
    }

    func resume() {
        release?.resume()
        release = nil
    }

    func fail() {
        failing = true
        resume()
    }

    private func waitHidden() async -> Bool {
        if sawDelete { return rowHidden }
        return await withCheckedContinuation { waiter = $0 }
    }
}

private final class DeleteRoutes: @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) async throws -> (Int, Data)
    private let lock = NSLock()
    private var handlers: [String: Handler] = [:]

    func add(_ handler: @escaping Handler) -> String {
        let host = "probe-\(UUID().uuidString.lowercased()).test"
        lock.withLock { handlers[host] = handler }
        return host
    }

    func handler(_ host: String) -> Handler? { lock.withLock { handlers[host] } }
    func remove(_ host: String) { _ = lock.withLock { handlers.removeValue(forKey: host) } }
}

private final class DeleteProtocol: URLProtocol, @unchecked Sendable {
    static let routes = DeleteRoutes()
    private let lock = NSLock()
    private var worker: Task<Void, Never>?

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host?.hasPrefix("probe-") == true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let request = request
        nonisolated(unsafe) let proto = self
        nonisolated(unsafe) let loading = client
        let task = Task { @Sendable in
            do {
                guard let url = request.url, let handler = Self.routes.handler(url.host ?? "") else { throw URLError(.badURL) }
                let (status, data) = try await handler(request)
                try Task.checkCancellation()
                let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
                loading?.urlProtocol(proto, didReceive: response, cacheStoragePolicy: .notAllowed)
                loading?.urlProtocol(proto, didLoad: data)
                loading?.urlProtocolDidFinishLoading(proto)
            } catch { loading?.urlProtocol(proto, didFailWithError: error) }
        }
        lock.withLock { self.worker = task }
    }

    override func stopLoading() { lock.withLock { worker?.cancel() } }
}
