import Foundation

@MainActor
public final class ChatLaunch {
    public private(set) var thread: Thread?
    public let feedback: SignpostTrace.Span
    public let mark: SignpostTrace.Span
    private var work: (@MainActor () async -> String?)?
    private var didFinish = false

    init(thread: Thread?, feedback: SignpostTrace.Span, mark: SignpostTrace.Span) {
        self.thread = thread
        self.feedback = feedback
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
    public let feedback: SignpostTrace.Span
    public let mark: SignpostTrace.Span
    public private(set) var saved: Agent?
    private var work: (@MainActor () async -> String?)?
    private var didFinish = false

    init(agent: Agent, feedback: SignpostTrace.Span, mark: SignpostTrace.Span) {
        self.agent = agent
        self.feedback = feedback
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
    public static let chatFeedback = "newChatFeedback"
    public static let agentSignpost = "newAgent"
    public static let agentFeedback = "newAgentFeedback"

    public static func start(agents: [Agent], title: String?, sidebar: SidebarStore, client: APIClient, trace: SignpostTrace = .shared, begin: () -> Void = {}, show: (Thread) -> Void = { _ in }) -> ChatLaunch {
        start(agents: agents, title: title, sidebar: sidebar, client: client, trace: trace, begin: begin, show: show, stall: {})
    }

    static func start(agents: [Agent], title: String?, sidebar: SidebarStore, client: APIClient, trace: SignpostTrace, begin: () -> Void = {}, show: (Thread) -> Void = { _ in }, stall: () -> Void) -> ChatLaunch {
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolved: String? = (trimmed?.isEmpty == false) ? trimmed : nil
        if agents.count < 2 {
            return openDirect(agents.first, sidebar: sidebar, trace: trace, begin: begin, show: show, stall: stall)
        }
        let ids = agents.map(\.id)
        var provisional: Thread?
        var feedback: SignpostTrace.Span?
        let mark = InstantUI.interval("newChat", budget: InstantUI.stateBudget, trace: trace) {
            feedback = InstantUI.interval("newChatFeedback", budget: InstantUI.feedbackBudget, trace: trace) {
                begin()
                stall()
                let localID = "local-\(UUID().uuidString)"
                let label = resolved ?? agents.map(\.name).filter { !$0.isEmpty }.joined(separator: ", ")
                let thread = Thread(id: localID, agentID: ids[0], title: label.isEmpty ? "New chat" : label, agentIDs: ids)
                provisional = thread
                sidebar.reveal(thread)
                show(thread)
            }
            sidebar.saveStaged()
        }
        guard let thread = provisional, let recorded = feedback else {
            preconditionFailure("new chat did not publish")
        }
        let launch = ChatLaunch(thread: thread, feedback: recorded, mark: mark)
        launch.setWork {
            do {
                let created = try await client.createThread(agentIDs: ids, title: resolved)
                sidebar.replaceStaged(created, local: thread.id)
                await sidebar.refresh()
                if !sidebar.threads.contains(where: { $0.id == created.id }) { sidebar.accept(created) }
                launch.resolve(sidebar.threads.first { $0.id == created.id } ?? created)
                return nil
            } catch {
                let message = "Couldn’t create this chat. \(error.localizedDescription)"
                sidebar.dropStaged(thread: thread.id, notice: message)
                launch.resolve(nil)
                return message
            }
        }
        return launch
    }

    public static func create(_ request: CreateAgentRequest, sidebar: SidebarStore, client: APIClient, trace: SignpostTrace = .shared, begin: () -> Void = {}, show: (Agent) -> Void = { _ in }) -> AgentLaunch {
        create(request, sidebar: sidebar, client: client, trace: trace, begin: begin, show: show, stall: {})
    }

    static func create(_ request: CreateAgentRequest, sidebar: SidebarStore, client: APIClient, trace: SignpostTrace, begin: () -> Void = {}, show: (Agent) -> Void = { _ in }, stall: () -> Void) -> AgentLaunch {
        var local: Agent?
        var feedback: SignpostTrace.Span?
        let mark = InstantUI.interval("newAgent", budget: InstantUI.stateBudget, trace: trace) {
            feedback = InstantUI.interval("newAgentFeedback", budget: InstantUI.feedbackBudget, trace: trace) {
                begin()
                stall()
                let agent = Agent(id: "local-\(UUID().uuidString)", name: request.name, role: request.role, avatar: request.avatar)
                local = agent
                sidebar.reveal(agent)
                show(agent)
            }
            sidebar.saveStaged()
        }
        guard let agent = local, let recorded = feedback else {
            preconditionFailure("new agent did not publish")
        }
        let launch = AgentLaunch(agent: agent, feedback: recorded, mark: mark)
        launch.setWork {
            do {
                let created = try await client.createAgent(request)
                sidebar.replaceStaged(created, local: agent.id)
                await sidebar.refresh()
                if !sidebar.agents.contains(where: { $0.id == created.id }) { sidebar.accept(created) }
                launch.resolve(sidebar.agents.first { $0.id == created.id } ?? created)
                return nil
            } catch {
                let message = "Couldn’t create this agent. \(error.localizedDescription)"
                sidebar.dropStaged(agent: agent.id, notice: message)
                return message
            }
        }
        return launch
    }

    private static func openDirect(_ agent: Agent?, sidebar: SidebarStore, trace: SignpostTrace, begin: () -> Void, show: (Thread) -> Void, stall: () -> Void) -> ChatLaunch {
        var existing: Thread?
        var feedback: SignpostTrace.Span?
        let mark = InstantUI.interval("newChat", budget: InstantUI.stateBudget, trace: trace) {
            feedback = InstantUI.interval("newChatFeedback", budget: InstantUI.feedbackBudget, trace: trace) {
                begin()
                stall()
                existing = agent.flatMap { sidebar.thread(for: $0) }
                if let existing {
                    sidebar.clearNotice()
                    show(existing)
                }
            }
        }
        guard let recorded = feedback else { preconditionFailure("new chat did not publish") }
        let launch = ChatLaunch(thread: existing, feedback: recorded, mark: mark)
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
