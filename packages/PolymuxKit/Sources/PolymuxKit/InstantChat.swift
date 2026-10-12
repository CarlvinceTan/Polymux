import Foundation

public struct Signpost: Sendable, Equatable {
    public var name: String
    public var duration: Duration

    public var withinBudget: Bool { duration <= SignpostTrace.chatBudget }
}

/// Records local UI commits. The interval ends before any network wait.
public final class SignpostTrace: @unchecked Sendable {
    public static let shared = SignpostTrace()
    /// A new chat has to commit on screen inside one interaction, not after the server replies.
    public static let chatBudget: Duration = .milliseconds(100)

    private let lock = NSLock()
    private var posts: [Signpost] = []

    public init() {}

    @discardableResult
    public func measure(_ name: String, _ body: () -> Void) -> Signpost {
        let start = ContinuousClock.now
        body()
        let post = Signpost(name: name, duration: start.duration(to: .now))
        lock.withLock { posts.append(post) }
        return post
    }

    public func posts(named name: String) -> [Signpost] {
        lock.withLock { posts.filter { $0.name == name } }
    }
}

@MainActor
public final class ChatLaunch {
    public private(set) var thread: Thread?
    public let mark: Signpost
    private var work: (@MainActor () async -> String?)?
    private var didFinish = false

    init(thread: Thread?, mark: Signpost) {
        self.thread = thread
        self.mark = mark
    }

    func setWork(_ work: @escaping @MainActor () async -> String?) { self.work = work }

    func resolve(_ thread: Thread?) { self.thread = thread }

    /// Nil when the chat is confirmed. A message means the optimistic chat was removed.
    public func finish() async -> String? {
        guard !didFinish else { return nil }
        didFinish = true
        return await work?()
    }
}

@MainActor
public final class AgentLaunch {
    public let agent: Agent
    public let mark: Signpost
    public private(set) var saved: Agent?
    private var work: (@MainActor () async -> String?)?
    private var didFinish = false

    init(agent: Agent, mark: Signpost) {
        self.agent = agent
        self.mark = mark
    }

    func setWork(_ work: @escaping @MainActor () async -> String?) { self.work = work }

    func resolve(_ agent: Agent) { saved = agent }

    public func finish() async -> String? {
        guard !didFinish else { return nil }
        didFinish = true
        return await work?()
    }
}

@MainActor
public enum InstantChat {
    public static let chatSignpost = "newChat"
    public static let agentSignpost = "newAgent"

    public static func start(agents: [Agent], title: String?, sidebar: SidebarStore, client: APIClient, trace: SignpostTrace = .shared) -> ChatLaunch {
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolved: String? = (trimmed?.isEmpty == false) ? trimmed : nil
        if agents.count < 2 {
            return openDirect(agents.first, sidebar: sidebar, trace: trace)
        }
        let ids = agents.map(\.id)
        let localID = "local-\(UUID().uuidString)"
        let label = resolved ?? agents.map(\.name).filter { !$0.isEmpty }.joined(separator: ", ")
        let provisional = Thread(id: localID, agentID: ids[0], title: label.isEmpty ? "New chat" : label, agentIDs: ids)
        let mark = trace.measure(chatSignpost) { sidebar.stage(provisional) }
        let launch = ChatLaunch(thread: provisional, mark: mark)
        launch.setWork {
            do {
                let created = try await client.createThread(agentIDs: ids, title: resolved)
                sidebar.replaceStaged(created, local: localID)
                await sidebar.refresh()
                if !sidebar.threads.contains(where: { $0.id == created.id }) { sidebar.accept(created) }
                launch.resolve(sidebar.threads.first { $0.id == created.id } ?? created)
                return nil
            } catch {
                sidebar.dropStaged(thread: localID)
                launch.resolve(nil)
                return "Couldn’t create this chat. \(error.localizedDescription)"
            }
        }
        return launch
    }

    public static func create(_ request: CreateAgentRequest, sidebar: SidebarStore, client: APIClient, trace: SignpostTrace = .shared) -> AgentLaunch {
        let local = Agent(id: "local-\(UUID().uuidString)", name: request.name, role: request.role, avatar: request.avatar)
        let mark = trace.measure(agentSignpost) { sidebar.stage(local) }
        let launch = AgentLaunch(agent: local, mark: mark)
        launch.setWork {
            do {
                let created = try await client.createAgent(request)
                sidebar.replaceStaged(created, local: local.id)
                await sidebar.refresh()
                if !sidebar.agents.contains(where: { $0.id == created.id }) { sidebar.accept(created) }
                launch.resolve(sidebar.agents.first { $0.id == created.id } ?? created)
                return nil
            } catch {
                sidebar.dropStaged(agent: local.id)
                return error.localizedDescription
            }
        }
        return launch
    }

    private static func openDirect(_ agent: Agent?, sidebar: SidebarStore, trace: SignpostTrace) -> ChatLaunch {
        var existing: Thread?
        let mark = trace.measure(chatSignpost) { existing = agent.flatMap { sidebar.thread(for: $0) } }
        let launch = ChatLaunch(thread: existing, mark: mark)
        guard existing == nil, let agent else { return launch }
        launch.setWork {
            await sidebar.refresh()
            if let thread = sidebar.thread(for: agent) {
                launch.resolve(thread)
                return nil
            }
            return "This agent’s chat isn’t available yet. Try again."
        }
        return launch
    }
}
