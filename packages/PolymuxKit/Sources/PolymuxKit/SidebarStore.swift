import Foundation
import Observation

@MainActor @Observable
public final class SidebarStore {
    public let activity = ActivityStore()
    public private(set) var agents: [Agent] = []
    public private(set) var threads: [Thread] = []
    public private(set) var isConnected = false
    public private(set) var error: String?
    public private(set) var editIssues: [String: String] = [:]
    @ObservationIgnored private let client: APIClient
    @ObservationIgnored private let cache: LocalCache
    @ObservationIgnored private var isFlushing = false
    @ObservationIgnored private var revision: UInt64 = 0
    @ObservationIgnored private var generation: UInt64 = 0
    @ObservationIgnored private var acceptedAgents: [String: Agent] = [:]
    @ObservationIgnored private var acceptedThreads: [String: Thread] = [:]
    @ObservationIgnored private var pendingThreads: [String: Thread] = [:]
    @ObservationIgnored private var stagedAgents: [String: Agent] = [:]
    @ObservationIgnored private var stagedThreads: [String: Thread] = [:]
    @ObservationIgnored private var agentChats: Set<String> = []
    @ObservationIgnored private var editTasks: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var editDates: [String: Date] = [:]
    @ObservationIgnored private var editWorkers: [String: Task<Bool, Never>] = [:]

    public init(client: APIClient, cache: LocalCache) {
        self.client = client
        self.cache = cache
        agents = (try? cache.agents()) ?? []
        threads = (try? cache.threads()) ?? []
        for thread in (try? cache.threadEdits()) ?? [] {
            pendingThreads[thread.id] = thread
            acceptedThreads[thread.id] = thread
            merge(thread, into: &threads)
        }
    }

    public func thread(for agent: Agent) -> Thread? {
        threads.first { !$0.isGroup && $0.agentID == agent.id }
    }

    public var groups: [Thread] { threads.filter(\.isGroup) }

    public func participants(in thread: Thread) -> [Agent] {
        thread.participantIDs.compactMap { id in agents.first { $0.id == id } }
    }

    /// Orders agents the way the sidebar orders chats: newest message first.
    public func recentFirst(_ agents: [Agent]) -> [Agent] {
        agents.sorted { lhs, rhs in
            let left = thread(for: lhs)?.lastMessage?.date ?? .distantPast
            let right = thread(for: rhs)?.lastMessage?.date ?? .distantPast
            if left == right { return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending }
            return left > right
        }
    }

    public func accept(_ thread: Thread) {
        revision &+= 1
        acceptedThreads[thread.id] = thread
        merge(thread, into: &threads)
        persist()
    }

    public func accept(_ agent: Agent) {
        revision &+= 1
        acceptedAgents[agent.id] = agent
        merge(agent, into: &agents)
        if !threads.contains(where: { $0.id == agent.id }) {
            let cached = try? cache.threads().first { $0.id == agent.id }
            let thread = cached ?? Thread(id: agent.id, agentID: agent.id, title: agent.name, agentIDs: [agent.id])
            acceptedThreads[thread.id] = thread
            merge(thread, into: &threads)
        }
        persist()
    }

    /// Shows a chat before the server confirms it. Refresh keeps it until it is replaced or dropped.
    func stage(_ thread: Thread) {
        revision &+= 1
        stagedThreads[thread.id] = thread
        acceptedThreads[thread.id] = thread
        merge(thread, into: &threads)
        persist()
    }

    /// Shows an agent, and a direct chat when none exists, before the server confirms it.
    func stage(_ agent: Agent) {
        revision &+= 1
        stagedAgents[agent.id] = agent
        acceptedAgents[agent.id] = agent
        merge(agent, into: &agents)
        if !threads.contains(where: { $0.id == agent.id }) {
            let thread = Thread(id: agent.id, agentID: agent.id, title: agent.name, agentIDs: [agent.id])
            stagedThreads[thread.id] = thread
            agentChats.insert(agent.id)
            acceptedThreads[thread.id] = thread
            merge(thread, into: &threads)
        }
        persist()
    }

    func dropStaged(thread id: String) {
        guard stagedThreads.removeValue(forKey: id) != nil else { return }
        revision &+= 1
        acceptedThreads[id] = nil
        threads.removeAll { $0.id == id }
        persist(omittingThreads: [id])
    }

    func dropStaged(agent id: String) {
        guard stagedAgents.removeValue(forKey: id) != nil else { return }
        revision &+= 1
        acceptedAgents[id] = nil
        agents.removeAll { $0.id == id }
        var omittingThreads: Set<String> = []
        if agentChats.remove(id) != nil {
            stagedThreads[id] = nil
            acceptedThreads[id] = nil
            threads.removeAll { $0.id == id }
            omittingThreads.insert(id)
        }
        persist(omittingAgents: [id], omittingThreads: omittingThreads)
    }

    func replaceStaged(_ thread: Thread, local id: String) {
        revision &+= 1
        stagedThreads[id] = nil
        let dropLocal = id != thread.id
        if dropLocal {
            acceptedThreads[id] = nil
            threads.removeAll { $0.id == id }
        }
        acceptedThreads[thread.id] = thread
        merge(thread, into: &threads)
        persist(omittingThreads: dropLocal ? [id] : [])
    }

    func replaceStaged(_ agent: Agent, local id: String) {
        revision &+= 1
        stagedAgents[id] = nil
        acceptedAgents[id] = nil
        agents.removeAll { $0.id == id }
        var omittingThreads: Set<String> = []
        if agentChats.remove(id) != nil {
            stagedThreads[id] = nil
            acceptedThreads[id] = nil
            threads.removeAll { $0.id == id }
            omittingThreads.insert(id)
        }
        acceptedAgents[agent.id] = agent
        merge(agent, into: &agents)
        if !threads.contains(where: { $0.id == agent.id }) {
            let thread = Thread(id: agent.id, agentID: agent.id, title: agent.name, agentIDs: [agent.id])
            acceptedThreads[thread.id] = thread
            merge(thread, into: &threads)
        }
        let omittingAgents: Set<String> = id == agent.id ? [] : [id]
        persist(omittingAgents: omittingAgents, omittingThreads: omittingThreads)
    }

    public func edit(_ thread: Thread, delay: Duration = .milliseconds(550)) {
        var thread = thread
        thread.runs = []
        revision &+= 1
        pendingThreads[thread.id] = thread
        acceptedThreads[thread.id] = thread
        editIssues[thread.id] = nil
        merge(thread, into: &threads)
        do {
            try persistEdits()
        } catch {
            editIssues[thread.id] = "Changes couldn’t be saved on this device."
        }
        scheduleEdit(thread.id, delay: delay)
    }

    public func retryEdit(_ id: String) { scheduleEdit(id, delay: .zero) }

    public func syncEdit(_ id: String) async throws {
        editTasks[id]?.cancel()
        editTasks[id] = nil
        while pendingThreads[id] != nil {
            editDates[id] = .distantPast
            let synced = await saveEdit(id)
            guard synced || editIssues[id] == nil else { throw ClientError.unavailable }
        }
    }

    private func scheduleEdit(_ id: String, delay: Duration) {
        guard pendingThreads[id] != nil else { return }
        editTasks[id]?.cancel()
        let seconds = Double(delay.components.seconds) + Double(delay.components.attoseconds) / 1e18
        editDates[id] = Date().addingTimeInterval(seconds)
        editTasks[id] = Task { [weak self] in
            do { try await Task.sleep(for: delay) }
            catch { return }
            guard let self, !Task.isCancelled else { return }
            self.editTasks[id] = nil
            _ = await self.saveEdit(id)
        }
    }

    private func saveEdit(_ id: String) async -> Bool {
        if let worker = editWorkers[id] { return await worker.value }
        let worker = Task { [weak self] in await self?.pushEdit(id) ?? false }
        editWorkers[id] = worker
        let synced = await worker.value
        editWorkers[id] = nil
        return synced
    }

    private func pushEdit(_ id: String) async -> Bool {
        while let pending = pendingThreads[id] {
            guard (editDates[id] ?? .distantPast) <= Date() else { return false }
            do {
                let updated = try await client.updateThread(id: id, title: pending.title, agentIDs: pending.agentIDs, leadAgentID: pending.leadAgentID)
                if pendingThreads[id] == pending {
                    revision &+= 1
                    pendingThreads[id] = nil
                    editDates[id] = nil
                    editIssues[id] = nil
                    acceptedThreads[id] = updated
                    merge(updated, into: &threads)
                    try persistEdits()
                }
            } catch {
                editIssues[id] = "Changes haven’t synced yet."
                return false
            }
        }
        return true
    }

    private func persistEdits() throws {
        try cache.saveEdits(Array(pendingThreads.values))
        var cached = try cache.threads()
        for thread in acceptedThreads.values { merge(thread, into: &cached) }
        try cache.save(agents: try cache.agents(), threads: cached)
        reload()
    }

    private func persist(omittingAgents: Set<String> = [], omittingThreads: Set<String> = []) {
        isConnected = true
        error = nil
        do {
            var agents = try cache.agents()
            var threads = try cache.threads()
            if !omittingAgents.isEmpty { agents.removeAll { omittingAgents.contains($0.id) } }
            if !omittingThreads.isEmpty { threads.removeAll { omittingThreads.contains($0.id) } }
            for agent in acceptedAgents.values where !omittingAgents.contains(agent.id) { merge(agent, into: &agents) }
            for thread in acceptedThreads.values where !omittingThreads.contains(thread.id) { merge(thread, into: &threads) }
            try cache.save(agents: agents, threads: threads)
            reload()
        } catch { self.error = error.localizedDescription }
    }

    private func merge(_ agent: Agent, into agents: inout [Agent]) {
        if let index = agents.firstIndex(where: { $0.id == agent.id }) { agents[index] = agent }
        else { agents.append(agent) }
    }

    private func merge(_ thread: Thread, into threads: inout [Thread]) {
        guard let index = threads.firstIndex(where: { $0.id == thread.id }) else { threads.append(thread); return }
        var accepted = thread
        let previous = threads[index]
        accepted.lastReadSeq = max(previous.lastReadSeq, accepted.lastReadSeq)
        accepted.lastSeq = max(previous.lastSeq, accepted.lastSeq)
        var runs = Dictionary(uniqueKeysWithValues: previous.runs.map { ($0.id, $0) })
        for run in accepted.runs where run.seq >= (runs[run.id]?.seq ?? -1) { runs[run.id] = run }
        accepted.runs = runs.values.sorted { $0.seq > $1.seq }
        // Rename responses omit the last-message summary.
        if accepted.lastMessage == nil || (previous.lastMessage?.seq ?? 0) > (accepted.lastMessage?.seq ?? 0) {
            accepted.lastMessage = previous.lastMessage
            accepted.unreadCount = previous.unreadCount
        }
        threads[index] = accepted
    }

    public func refresh() async {
        generation &+= 1
        let generation = generation
        let revision = revision
        do {
            async let agents = client.agents()
            async let threads = client.threads()
            var values = try await (agents, threads)
            guard generation == self.generation, revision == self.revision else { return }
            let snapshots = values.1
            for pending in pendingThreads.values { merge(pending, into: &values.1) }
            for agent in stagedAgents.values { merge(agent, into: &values.0) }
            for thread in stagedThreads.values { merge(thread, into: &values.1) }
            try cache.save(agents: values.0, threads: values.1)
            for thread in snapshots { try cache.reconcile(thread) }
            self.agents = values.0
            self.threads = try cache.threads()
            activity.retain(Set(self.threads.map(\.id)))
            for thread in self.threads { activity.reconcile(thread) }
            acceptedAgents.removeAll()
            acceptedThreads.removeAll()
            acceptedThreads = pendingThreads
            for (id, agent) in stagedAgents { acceptedAgents[id] = agent }
            for (id, thread) in stagedThreads { acceptedThreads[id] = thread }
            isConnected = true
            error = nil
            for id in pendingThreads.keys where editTasks[id] == nil && editWorkers[id] == nil { retryEdit(id) }
            await flush()
        } catch {
            guard generation == self.generation, revision == self.revision else { return }
            isConnected = false
            self.error = error.localizedDescription
        }
    }

    private func flush() async {
        guard !isFlushing else { return }
        isFlushing = true
        defer { isFlushing = false }
        do {
            var blocked: Set<String> = []
            while let queued = try cache.queued().first(where: { !blocked.contains($0.threadID) }) {
                do { try await syncEdit(queued.threadID) }
                catch {
                    blocked.insert(queued.threadID)
                    for pending in try cache.queued() where pending.threadID == queued.threadID {
                        try cache.setStatus(id: pending.request.id, status: "failed")
                    }
                    continue
                }
                do {
                    try await client.send(threadID: queued.threadID, request: queued.request)
                    try cache.acknowledge(id: queued.request.id)
                } catch {
                    if try cache.accepted(id: queued.request.id) {
                        try cache.acknowledge(id: queued.request.id)
                        continue
                    }
                    if case let ClientError.response(code, _) = error, (400..<500).contains(code), code != 408, code != 429 {
                        try cache.setStatus(id: queued.request.id, status: "error")
                        continue
                    }
                    for pending in try cache.queued() {
                        try cache.setStatus(id: pending.request.id, status: "failed")
                    }
                    isConnected = false
                    self.error = error.localizedDescription
                    break
                }
            }
        } catch { self.error = error.localizedDescription }
    }

    public func reload() {
        var agents = (try? cache.agents()) ?? agents
        var threads = (try? cache.threads()) ?? threads
        for agent in acceptedAgents.values { merge(agent, into: &agents) }
        for thread in acceptedThreads.values { merge(thread, into: &threads) }
        self.agents = agents
        self.threads = threads
        for thread in threads { activity.reconcile(thread) }
    }
}
