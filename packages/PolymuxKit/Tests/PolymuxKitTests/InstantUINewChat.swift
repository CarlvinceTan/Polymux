import Foundation
#if canImport(FoundationNetworking)
@preconcurrency import FoundationNetworking
#endif
import Testing
@testable import PolymuxKit

@Suite("InstantUINewChat") @MainActor
struct InstantUINewChat {
    @Test func directChatMeetsBudgetWithoutWaiting() async throws {
        let rig = try await Rig()
        defer { rig.close() }
        let trace = SignpostTrace()
        let launch = InstantChat.start(agents: [rig.arlo], title: nil, sidebar: rig.sidebar, client: rig.client, trace: trace)
        #expect(launch.thread?.id == rig.arlo.id)
        #expect(launch.feedback.name == InstantChat.chatFeedback)
        #expect(launch.mark.name == InstantChat.chatSignpost)
        #expect(launch.feedback.budget == .milliseconds(16))
        #expect(launch.mark.budget == .milliseconds(50))
        #expect(launch.feedback.withinBudget)
        #expect(launch.mark.withinBudget)
        #expect(trace.meetsBudgets)
        #expect(await launch.finish() == nil)
        #expect(await rig.probe.calls == 0)
        #expect(launch.thread?.id == rig.arlo.id)
    }

    @Test func missingDirectChatReportsUnavailable() async throws {
        let rig = try await Rig(seedThreads: false)
        defer { rig.close() }
        let trace = SignpostTrace()
        let launch = InstantChat.start(agents: [rig.arlo], title: nil, sidebar: rig.sidebar, client: rig.client, trace: trace)
        #expect(launch.thread?.id.hasPrefix("local-") == true)
        #expect(launch.feedback.withinBudget)
        #expect(launch.mark.withinBudget)
        #expect(trace.meetsBudgets)
        let message = await launch.finish()
        #expect(message == "This agent’s chat isn’t available yet. Try again.")
        #expect(rig.sidebar.thread(for: rig.arlo) == nil)
        #expect(await rig.probe.calls >= 1)
    }

    @Test func forcedFailureRollsBackGroupInsideBudget() async throws {
        let rig = try await Rig()
        defer { rig.close() }
        let beforeAgents = try await rig.sidebar.cacheActor.call { try $0.agents() }
        let beforeThreads = try await rig.sidebar.cacheActor.call { try $0.threads() }
        let trace = SignpostTrace()
        let launch = InstantChat.start(agents: [rig.arlo, rig.milo], title: "Trip", sidebar: rig.sidebar, client: rig.client, trace: trace)
        let local = try #require(launch.thread?.id)
        #expect(local.hasPrefix("local-"))
        #expect(launch.feedback.withinBudget)
        #expect(launch.mark.withinBudget)
        #expect(trace.meetsBudgets)
        #expect(rig.sidebar.threads.contains { $0.id == local })
        #expect(await rig.probe.calls == 0)

        async let failure = launch.finish()
        await rig.probe.waitUntilEntered()
        await rig.sidebar.refresh()
        #expect(rig.sidebar.threads.contains { $0.id == local })
        let message = await failure
        #expect(message == "Couldn’t create this chat. Check your connection and try again.")
        #expect(rig.sidebar.notice == message)
        #expect(launch.thread == nil)
        #expect(!rig.sidebar.threads.contains { $0.id == local })
        #expect(try await rig.sidebar.cacheActor.call { try $0.agents() } == beforeAgents)
        #expect(try await rig.sidebar.cacheActor.call { try $0.threads().map(\.id).sorted() } == beforeThreads.map(\.id).sorted())
        #expect(rig.sidebar.thread(for: rig.arlo)?.id == rig.arlo.id)
    }

    @Test func forcedFailureRollsBackAgentInsideBudget() async throws {
        let rig = try await Rig()
        defer { rig.close() }
        let beforeAgents = try await rig.sidebar.cacheActor.call { try $0.agents() }
        let beforeThreads = try await rig.sidebar.cacheActor.call { try $0.threads().map(\.id).sorted() }
        let trace = SignpostTrace()
        let request = CreateAgentRequest(name: "Nova", role: "", prompt: "")
        let launch = InstantChat.create(request, sidebar: rig.sidebar, client: rig.client, trace: trace)
        #expect(launch.agent.name == "Nova")
        #expect(launch.feedback.name == InstantChat.agentFeedback)
        #expect(launch.mark.name == InstantChat.agentSignpost)
        #expect(launch.feedback.budget == InstantUI.feedbackBudget)
        #expect(launch.mark.budget == InstantUI.stateBudget)
        #expect(launch.feedback.withinBudget)
        #expect(launch.mark.withinBudget)
        #expect(trace.meetsBudgets)
        #expect(rig.sidebar.agents.contains { $0.id == launch.agent.id })
        #expect(rig.sidebar.thread(for: launch.agent)?.id == launch.agent.id)
        #expect(await rig.probe.calls == 0)

        async let failure = launch.finish()
        await rig.probe.waitUntilEntered()
        #expect(rig.sidebar.agents.contains { $0.id == launch.agent.id })
        let message = await failure
        #expect(message == "Couldn’t create this agent. Check your connection and try again.")
        #expect(rig.sidebar.notice == message)
        #expect(launch.saved == nil)
        #expect(!rig.sidebar.agents.contains { $0.id == launch.agent.id })
        #expect(rig.sidebar.thread(for: launch.agent) == nil)
        #expect(try await rig.sidebar.cacheActor.call { try $0.agents() } == beforeAgents)
        #expect(try await rig.sidebar.cacheActor.call { try $0.threads().map(\.id).sorted() } == beforeThreads)
    }

    @Test func slowCreateMeetsBudgetAndKeepsServerChat() async throws {
        let rig = try await Rig(failCreates: false)
        defer { rig.close() }
        let trace = SignpostTrace()
        let launch = InstantChat.start(agents: [rig.arlo, rig.milo], title: "Trip", sidebar: rig.sidebar, client: rig.client, trace: trace)
        let local = try #require(launch.thread?.id)
        #expect(launch.feedback.withinBudget)
        #expect(launch.mark.withinBudget)
        #expect(trace.meetsBudgets)
        #expect(await rig.probe.calls == 0)
        let message = await launch.finish()
        #expect(message == nil)
        #expect(launch.thread?.id == "server-group")
        #expect(!rig.sidebar.threads.contains { $0.id == local })
        #expect(rig.sidebar.threads.contains { $0.id == "server-group" && $0.title == "Trip" })
        #expect((try await rig.sidebar.cacheActor.call { try $0.threads() }).contains { $0.id == "server-group" })
        #expect((try await rig.sidebar.cacheActor.call { try $0.threads() }).allSatisfy { $0.id != local })
    }

    @Test func slowCreateExceedsBudget() async throws {
        let rig = try await Rig()
        defer { rig.close() }
        let trace = SignpostTrace()
        let launch = InstantChat.start(agents: [rig.arlo, rig.milo], title: "Trip", sidebar: rig.sidebar, client: rig.client, trace: trace, stall: {
            let until = ContinuousClock.now.advanced(by: .milliseconds(70))
            while ContinuousClock.now < until { Thread.sleep(forTimeInterval: 0.005) }
        })
        let local = try #require(launch.thread?.id)
        #expect(rig.sidebar.threads.contains { $0.id == local })
        #expect(launch.feedback.budget == .milliseconds(16))
        #expect(launch.mark.budget == .milliseconds(50))
        #expect(launch.feedback.duration > launch.feedback.budget)
        #expect(launch.mark.duration > launch.mark.budget)
        #expect(!launch.feedback.withinBudget)
        #expect(!launch.mark.withinBudget)
        #expect(!trace.meetsBudgets)
    }

    @Test func publishesBeforeSuspending() async throws {
        let rig = try await Rig(failCreates: false)
        defer { rig.close() }
        let launch = InstantChat.start(agents: [rig.arlo, rig.milo], title: nil,
                                       sidebar: rig.sidebar, client: rig.client)
        let local = try #require(launch.thread?.id)
        #expect(rig.sidebar.threads.contains { $0.id == local })
        async let result = launch.finish()
        await rig.probe.waitUntilEntered()
        #expect(rig.sidebar.threads.contains { $0.id == local })
        #expect(await result == nil)
        #expect(rig.sidebar.aliases[local] == "server-group")
        #expect(rig.sidebar.displayed(local)?.id == "server-group")
    }

    @Test func queuesSendUntilReconciled() async throws {
        let rig = try await Rig(failCreates: false)
        defer { rig.close() }
        let launch = InstantChat.start(agents: [rig.arlo, rig.milo], title: nil,
                                       sidebar: rig.sidebar, client: rig.client)
        let local = try #require(launch.thread?.id)
        let store = ChatStore(client: rig.client, actor: rig.sidebar.cacheActor,
                              threadID: local, sidebar: rig.sidebar)
        await store.ready()
        async let result = launch.finish()
        await rig.probe.waitUntilEntered()
        let sending = Task { await store.send(text: "Hello") }
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while store.messages.isEmpty, ContinuousClock.now < deadline { await Task.yield() }
        #expect(!store.messages.isEmpty)
        #expect(store.messages.first?.threadID == local)
        #expect(await rig.probe.sentPaths.isEmpty)
        #expect(try await rig.sidebar.cacheActor.call { try $0.pending(threadID: local).isEmpty })
        #expect(await result == nil)
        await sending.value
        #expect(store.threadID == "server-group")
        #expect(store.messages.first?.threadID == "server-group")
        #expect(store.messages.first?.text == "Hello")
        #expect(await rig.probe.sentPaths == ["/threads/server-group/messages"])
        #expect(try await rig.sidebar.cacheActor.call { try $0.pending(threadID: local).isEmpty })
    }

    @Test func resolvedWakesWithServerIDWithoutPolling() async throws {
        let rig = try await Rig(failCreates: false)
        defer { rig.close() }
        let launch = InstantChat.start(agents: [rig.arlo, rig.milo], title: nil,
                                       sidebar: rig.sidebar, client: rig.client)
        let local = try #require(launch.thread?.id)
        let waiting = Task { await rig.sidebar.resolved(local) }
        #expect(await launch.finish() == nil)
        #expect(await waiting.value == "server-group")
        #expect(rig.sidebar.aliases[local] == "server-group")
    }

    @Test func resolvedWakesWithNilWhenCreateFails() async throws {
        let rig = try await Rig()
        defer { rig.close() }
        let launch = InstantChat.start(agents: [rig.arlo, rig.milo], title: nil,
                                       sidebar: rig.sidebar, client: rig.client)
        let local = try #require(launch.thread?.id)
        let waiting = Task { await rig.sidebar.resolved(local) }
        #expect(await launch.finish() != nil)
        #expect(await waiting.value == nil)
    }

    @Test func cancelledResolverStopsWaiting() async throws {
        let rig = try await Rig(failCreates: false)
        defer { rig.close() }
        let launch = InstantChat.start(agents: [rig.arlo, rig.milo], title: nil,
                                       sidebar: rig.sidebar, client: rig.client)
        let local = try #require(launch.thread?.id)
        let waiting = Task { await rig.sidebar.resolved(local) }
        waiting.cancel()
        #expect(await waiting.value == nil)
        #expect(await launch.finish() == nil)
    }

    @Test func failedCreateKeepsQueuedMessageInMemory() async throws {
        let rig = try await Rig()
        defer { rig.close() }
        let launch = InstantChat.start(agents: [rig.arlo, rig.milo], title: nil,
                                       sidebar: rig.sidebar, client: rig.client)
        let local = try #require(launch.thread?.id)
        let store = ChatStore(client: rig.client, actor: rig.sidebar.cacheActor,
                              threadID: local, sidebar: rig.sidebar)
        await store.ready()
        async let result = launch.finish()
        await rig.probe.waitUntilEntered()
        let sending = Task { await store.send(text: "Keep my draft") }
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while store.messages.isEmpty, ContinuousClock.now < deadline { await Task.yield() }
        #expect(!store.messages.isEmpty)
        #expect(await result != nil)
        await sending.value
        #expect(store.messages.first?.text == "Keep my draft")
        #expect(store.messages.first?.status == "failed")
        #expect(await rig.probe.sentPaths.isEmpty)
        #expect(try await rig.sidebar.cacheActor.call { try $0.messages(threadID: local).isEmpty })
    }

}

@MainActor
private struct Rig {
    let folder: URL
    let cache: LocalCache
    let sidebar: SidebarStore
    let client: APIClient
    let probe: FailProbe
    let arlo = Agent(id: "arlo", name: "Arlo")
    let milo = Agent(id: "milo", name: "Milo")

    init(seedThreads: Bool = true, failCreates: Bool = true) async throws {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("polymux-instant-\(UUID())")
        let threads = seedThreads ? [
            Thread(id: arlo.id, agentID: arlo.id, title: arlo.name, agentIDs: [arlo.id]),
            Thread(id: milo.id, agentID: milo.id, title: milo.name, agentIDs: [milo.id]),
        ] : []
        let url = folder.appendingPathComponent("cache.sqlite")
        let agents = [arlo, milo]
        cache = try await Task.detached {
            let cache = try LocalCache(url: url)
            try cache.save(agents: agents, threads: threads)
            return cache
        }.value
        let created = FailProbe(agents: [arlo, milo], threads: threads, failCreates: failCreates)
        probe = created
        let host = InstantProtocol.routes.add { try await created.handle($0) }
        client = Rig.client(host: host)
        sidebar = SidebarStore(client: client, cache: cache)
        await sidebar.load()
    }

    func close() {
        if let host = client.baseURL.host { InstantProtocol.routes.remove(host) }
        try? FileManager.default.removeItem(at: folder)
    }

    private static func client(host: String) -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [InstantProtocol.self]
        return APIClient(baseURL: URL(string: "http://\(host)")!, session: URLSession(configuration: config))
    }
}

private actor FailProbe {
    private(set) var calls = 0
    private(set) var sentPaths: [String] = []
    private var entered = 0
    private let agents: [Agent]
    private let threads: [PolymuxKit.Thread]
    private let failCreates: Bool

    init(agents: [Agent], threads: [PolymuxKit.Thread], failCreates: Bool) {
        self.agents = agents
        self.threads = threads
        self.failCreates = failCreates
    }

    func waitUntilEntered() async {
        while entered == 0 { try? await Task.sleep(for: .milliseconds(5)) }
    }

    func handle(_ request: URLRequest) async throws -> (Int, Data) {
        calls += 1
        let path = request.url?.path ?? ""
        if request.httpMethod == "POST", path == "/threads" || path == "/agents" {
            entered += 1
            try await Task.sleep(for: .milliseconds(250))
            if failCreates {
                return (500, Data(#"{"code":"forced","message":"forced failure"}"#.utf8))
            }
            if path == "/threads" {
                let thread = Thread(id: "server-group", agentID: "arlo", title: "Trip", agentIDs: ["arlo", "milo"])
                return (201, try JSONEncoder().encode(thread))
            }
            let agent = Agent(id: "server-agent", name: "Nova")
            return (201, try JSONEncoder().encode(agent))
        }
        if request.httpMethod == "POST", path.hasSuffix("/messages") {
            sentPaths.append(path)
            return (200, Data("{}".utf8))
        }
        if request.httpMethod == "GET", path == "/threads" {
            var listed = threads
            if !failCreates { listed.append(Thread(id: "server-group", agentID: "arlo", title: "Trip", agentIDs: ["arlo", "milo"])) }
            return (200, try JSONEncoder().encode(listed))
        }
        if request.httpMethod == "GET", path == "/agents" {
            return (200, try JSONEncoder().encode(agents))
        }
        return (200, Data("[]".utf8))
    }
}

private final class InstantRoutes: @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) async throws -> (Int, Data)
    private let lock = NSLock()
    private var handlers: [String: Handler] = [:]

    func add(_ handler: @escaping Handler) -> String {
        let host = "instant-\(UUID().uuidString.lowercased()).test"
        lock.withLock { handlers[host] = handler }
        return host
    }

    func handler(_ host: String) -> Handler? { lock.withLock { handlers[host] } }
    func remove(_ host: String) { _ = lock.withLock { handlers.removeValue(forKey: host) } }
}

private final class InstantProtocol: URLProtocol {
    static let routes = InstantRoutes()
    private let lock = NSLock()
    private var worker: Task<Void, Never>?

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host?.hasPrefix("instant-") == true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let request = request
        let loader = Loader(proto: self)
        let task = Task { await loader.deliver(request) }
        lock.withLock { self.worker = task }
    }

    private struct Loader: @unchecked Sendable {
        let proto: InstantProtocol
        func deliver(_ request: URLRequest) async { await proto.deliver(request) }
    }

    private func deliver(_ request: URLRequest) async {
        do {
            guard let url = request.url, let handler = Self.routes.handler(url.host ?? "") else { throw URLError(.badURL) }
            let (status, data) = try await handler(request)
            try Task.checkCancellation()
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }

    override func stopLoading() { lock.withLock { worker?.cancel() } }
}
