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
    public let trace = SignpostTrace()
    /// Holds the row update so a budget test can prove a slow publish misses.
    var rowStall: Duration = .zero
    @ObservationIgnored private let client: APIClient
    @ObservationIgnored public let cacheActor: LocalCacheActor
    @ObservationIgnored private var isFlushing = false
    @ObservationIgnored private var pinned: [String] = []
    @ObservationIgnored private var dirty = false
    @ObservationIgnored private var saving: Task<Void, Never>?
    @ObservationIgnored private var lastSaveAt: ContinuousClock.Instant?
    @ObservationIgnored private var renames: [String: String] = [:]
    @ObservationIgnored private var committedAgents: [Agent] = []
    @ObservationIgnored private var committedThreads: [Thread] = []
    @ObservationIgnored private var committedPins: [String] = []
    @ObservationIgnored private var committedEdits: [String: Thread] = [:]
    @ObservationIgnored private var staged: [SaveFault] = []
    @ObservationIgnored private var epoch: UInt64 = 0
    /// Coalesces disk writes. Tests set this to zero to prove the cap can fail.
    var saveGap: Duration = .milliseconds(250)
    @ObservationIgnored private var revision: UInt64 = 0
    @ObservationIgnored private var generation: UInt64 = 0
    @ObservationIgnored private var acceptedAgents: [String: Agent] = [:]
    @ObservationIgnored private var acceptedThreads: [String: Thread] = [:]
    @ObservationIgnored private var pendingThreads: [String: Thread] = [:]
    @ObservationIgnored private var editTasks: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var editDates: [String: Date] = [:]
    @ObservationIgnored private var editWorkers: [String: Task<Bool, Never>] = [:]

    public init(client: APIClient, cache: LocalCache) {
        self.client = client
        cacheActor = LocalCacheActor(cache)
    }

    /// Fills the sidebar from disk. The read runs on `cacheActor`.
    public func load() async {
        await reload()
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

    public func accept(_ thread: Thread) async {
        revision &+= 1
        epoch &+= 1
        acceptedThreads[thread.id] = thread
        merge(thread, into: &threads)
        isConnected = true
        error = nil
        staged.append(.chat)
        scheduleSave()
        await settled()
    }

    public func accept(_ agent: Agent) async {
        revision &+= 1
        epoch &+= 1
        acceptedAgents[agent.id] = agent
        merge(agent, into: &agents)
        if !threads.contains(where: { $0.id == agent.id }) {
            let thread = Thread(id: agent.id, agentID: agent.id, title: agent.name, agentIDs: [agent.id])
            acceptedThreads[thread.id] = thread
            merge(thread, into: &threads)
        }
        isConnected = true
        error = nil
        staged.append(.agent)
        scheduleSave()
        await settled()
    }

    public func edit(_ thread: Thread, delay: Duration = .milliseconds(550)) async {
        var thread = thread
        thread.runs = []
        revision &+= 1
        epoch &+= 1
        pendingThreads[thread.id] = thread
        acceptedThreads[thread.id] = thread
        editIssues[thread.id] = nil
        merge(thread, into: &threads)
        staged.append(.edit(thread.id))
        scheduleEdit(thread.id, delay: delay)
        scheduleSave()
        await settled()
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
                    staged.append(.edit(id))
                    await persistEdits()
                    if editIssues[id] != nil { return false }
                }
            } catch {
                editIssues[id] = "Changes haven’t synced yet."
                return false
            }
        }
        return true
    }

    private func persistEdits() async {
        scheduleSave()
        await settled()
    }

    private func persist(agents: [Agent], threads: [Thread], pins: [String], edits: [Thread]) async throws {
        try await cacheActor.save(agents: agents, threads: threads, pins: pins, edits: edits)
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
        await settled()
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
            let savedAgents = values.0
            let savedThreads = values.1
            self.agents = savedAgents
            self.threads = savedThreads
            activity.retain(Set(self.threads.map(\.id)))
            for thread in self.threads { activity.reconcile(thread) }
            do {
                try await cacheActor.save(agents: savedAgents, threads: savedThreads, pins: pinned, edits: Array(pendingThreads.values))
            } catch {
                self.agents = committedAgents
                self.threads = committedThreads
                self.pinned = committedPins
                self.error = "Couldn’t save this conversation. Retry"
                return
            }
            remember()
            for thread in snapshots {
                try await cacheActor.call { try $0.reconcile(thread) }
            }
            self.threads = try await cacheActor.call { try $0.threads() }
            remember()
            activity.retain(Set(self.threads.map(\.id)))
            for thread in self.threads { activity.reconcile(thread) }
            acceptedAgents.removeAll()
            acceptedThreads.removeAll()
            acceptedThreads = pendingThreads
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
            while let queued = try await cacheActor.call({ try $0.queued() }).first(where: { !blocked.contains($0.threadID) }) {
                do { try await syncEdit(queued.threadID) }
                catch {
                    blocked.insert(queued.threadID)
                    for pending in try await cacheActor.call({ try $0.queued() }) where pending.threadID == queued.threadID {
                        let id = pending.request.id
                        try await cacheActor.call { try $0.setStatus(id: id, status: "failed") }
                    }
                    continue
                }
                do {
                    try await client.send(threadID: queued.threadID, request: queued.request)
                    let id = queued.request.id
                    try await cacheActor.call { try $0.acknowledge(id: id) }
                } catch {
                    let id = queued.request.id
                    if try await cacheActor.call({ try $0.accepted(id: id) }) {
                        try await cacheActor.call { try $0.acknowledge(id: id) }
                        continue
                    }
                    if case let ClientError.response(code, _) = error, (400..<500).contains(code), code != 408, code != 429 {
                        try await cacheActor.call { try $0.setStatus(id: id, status: "error") }
                        continue
                    }
                    for pending in try await cacheActor.call({ try $0.queued() }) {
                        let id = pending.request.id
                        try await cacheActor.call { try $0.setStatus(id: id, status: "failed") }
                    }
                    isConnected = false
                    self.error = error.localizedDescription
                    break
                }
            }
        } catch { self.error = error.localizedDescription }
    }

    public func reload() async {
        await settled()
        do {
            let nextAgents = try await cacheActor.call { try $0.agents() }
            let nextThreads = try await cacheActor.call { try $0.threads() }
            let nextPins = try await cacheActor.call { try $0.pins() }
            let edits = try await cacheActor.call { try $0.threadEdits() }
            epoch &+= 1
            agents = nextAgents
            threads = nextThreads
            pinned = nextPins
            pendingThreads = Dictionary(uniqueKeysWithValues: edits.map { ($0.id, $0) })
            for thread in edits {
                acceptedThreads[thread.id] = thread
                merge(thread, into: &threads)
            }
            // A failed accept is still only in memory. Reloading disk must not drop that row.
            for agent in acceptedAgents.values { merge(agent, into: &agents) }
            for thread in acceptedThreads.values { merge(thread, into: &threads) }
            for thread in threads { activity.reconcile(thread) }
            remember()
        } catch {
            self.error = "Couldn’t reload conversations. Retry"
        }
    }

    /// Patches one sidebar row from an event already in hand. Disk follows later.
    @discardableResult
    public func note(_ event: Event, at tap: ContinuousClock.Instant = ContinuousClock().now) -> Bool {
        let changed = InstantUI.interval("sidebarRow", budget: InstantUI.stateBudget, trace: trace, from: tap) {
            if rowStall > .zero { pause(rowStall) }
            return patch(event)
        }
        if changed {
            epoch &+= 1
            scheduleSave()
        }
        return changed
    }

    /// Shows the new title before persistence. A failed save puts the previous title back.
    public func rename(_ id: String, to title: String) {
        guard let index = threads.firstIndex(where: { $0.id == id }) else { return }
        let previous = threads[index].title
        guard previous != title else { return }
        if renames[id] == nil { renames[id] = previous }
        epoch &+= 1
        threads[index].title = title
        editIssues[id] = nil
        staged.append(.rename(id))
        scheduleSave()
    }

    /// Moves a chat to the top, then persists with the coalesced writer.
    public func pin(_ id: String) {
        guard let index = threads.firstIndex(where: { $0.id == id }) else { return }
        pinned.removeAll { $0 == id }
        pinned.insert(id, at: 0)
        let thread = threads.remove(at: index)
        threads.insert(thread, at: 0)
        epoch &+= 1
        scheduleSave()
    }

    public func clearUnread(_ id: String, seq: Int64) {
        guard let index = threads.firstIndex(where: { $0.id == id }) else { return }
        threads[index].lastReadSeq = max(threads[index].lastReadSeq, seq)
        threads[index].unreadCount = 0
    }

    public func lastSeq(_ id: String) -> Int64 {
        threads.first { $0.id == id }?.lastSeq ?? 0
    }

    public func settled() async {
        await saving?.value
    }

    private func patch(_ event: Event) -> Bool {
        if event.type == "message.read" {
            clearUnread(event.conversationID, seq: event.seq)
            return false
        }
        guard let index = threads.firstIndex(where: { $0.id == event.conversationID }) else { return false }
        var thread = threads[index]
        let incoming = event.seq > thread.lastSeq
        let localSend = event.seq == 0 && event.message?.role == "user"
        guard incoming || localSend else { return false }
        if incoming { thread.lastSeq = event.seq }
        if let message = project(event, onto: thread),
           message.seq >= (thread.lastMessage?.seq ?? 0) || localSend {
            thread.lastMessage = message
        }
        if incoming, event.type == "message.start", (event.message?.role == "assistant"), event.seq > thread.lastReadSeq {
            thread.unreadCount += 1
        }
        if incoming, event.type == "activity", event.seq > thread.lastReadSeq,
           event.payload?.countsUnread == true {
            thread.unreadCount += 1
        }
        threads[index] = thread
        orderThreads()
        return true
    }

    private func project(_ event: Event, onto thread: Thread) -> Message? {
        if var message = event.message {
            if message.seq == 0, event.seq > 0 { message.seq = event.seq }
            return message
        }
        guard let id = event.messageID, var message = thread.lastMessage, message.id == id else { return nil }
        switch event.type {
        case "message.delta":
            let text = event.text ?? ""
            if let index = message.parts.firstIndex(where: { $0.kind == "text" }) {
                message.parts[index].text = (message.parts[index].text ?? "") + text
            } else {
                message.parts.append(Part(kind: "text", text: text))
            }
            message.status = "streaming"
        case "message.done":
            message.status = "done"
        case "message.error":
            message.status = "error"
        default:
            break
        }
        return message
    }

    private func orderThreads() {
        let pins = pinned
        threads.sort { lhs, rhs in
            let leftPin = pins.firstIndex(of: lhs.id)
            let rightPin = pins.firstIndex(of: rhs.id)
            switch (leftPin, rightPin) {
            case let (left?, right?) where left != right: return left < right
            case (.some, .none): return true
            case (.none, .some): return false
            default: break
            }
            let left = lhs.lastMessage?.date ?? .distantPast
            let right = rhs.lastMessage?.date ?? .distantPast
            if left == right { return lhs.id < rhs.id }
            return left > right
        }
    }

    private func scheduleSave() {
        dirty = true
        guard saving == nil else { return }
        saving = Task { [weak self] in
            await self?.drain()
        }
    }

    private func drain() async {
        while dirty {
            if let lastSaveAt {
                let elapsed = lastSaveAt.duration(to: ContinuousClock().now)
                if elapsed < saveGap { try? await Task.sleep(for: saveGap - elapsed) }
            }
            dirty = false
            let agents = self.agents
            let threads = self.threads
            let pins = self.pinned
            let savedEpoch = epoch
            let pending = renames
            let faults = staged
            staged.removeAll()
            let edits = Array(pendingThreads.values)
            do {
                try await persist(agents: agents, threads: threads, pins: pins, edits: edits)
                lastSaveAt = ContinuousClock().now
                if epoch == savedEpoch {
                    remember()
                } else {
                    committedAgents = agents
                    committedThreads = threads
                    committedPins = pins
                    committedEdits = Dictionary(uniqueKeysWithValues: edits.map { ($0.id, $0) })
                }
                for (id, previous) in pending where renames[id] == previous {
                    if self.threads.first(where: { $0.id == id })?.title != previous {
                        renames[id] = nil
                    }
                }
            } catch {
                // A stream or reload moved the epoch. Keep the faults for the retry.
                if epoch != savedEpoch {
                    staged.insert(contentsOf: faults, at: 0)
                    dirty = true
                    continue
                }
                if keepsRows(faults) { rollbackRenames(faults) }
                else { restore() }
                report(faults)
            }
        }
        saving = nil
        if dirty { scheduleSave() }
    }

    private enum SaveFault {
        case rename(String)
        case agent
        case chat
        case edit(String)
    }

    private func remember() {
        committedAgents = agents
        committedThreads = threads
        committedPins = pinned
        committedEdits = pendingThreads
    }

    private func keepsRows(_ faults: [SaveFault]) -> Bool {
        faults.contains { fault in
            switch fault {
            case .agent, .chat, .edit: return true
            case .rename: return false
            }
        }
    }

    private func rollbackRenames(_ faults: [SaveFault]) {
        for fault in faults {
            guard case .rename(let id) = fault else { continue }
            guard let previous = renames[id], let index = threads.firstIndex(where: { $0.id == id }) else { continue }
            threads[index].title = previous
            renames[id] = nil
        }
    }

    private func restore() {
        agents = committedAgents
        threads = committedThreads
        pinned = committedPins
        pendingThreads = committedEdits
        acceptedAgents = Dictionary(uniqueKeysWithValues: committedAgents.map { ($0.id, $0) })
        acceptedThreads = Dictionary(uniqueKeysWithValues: committedThreads.map { ($0.id, $0) })
        for edit in committedEdits.values { merge(edit, into: &threads) }
        renames.removeAll()
    }

    private func report(_ faults: [SaveFault]) {
        if faults.isEmpty {
            error = "Couldn’t save this conversation. Retry"
            return
        }
        for fault in faults {
            switch fault {
            case .rename(let id):
                editIssues[id] = "Couldn’t save the new name. Retry"
            case .agent:
                error = "Couldn’t save this agent. Retry"
            case .chat:
                error = "Couldn’t save this chat. Retry"
            case .edit(let id):
                editIssues[id] = "Changes couldn’t be saved on this device."
            }
        }
    }

    private func pause(_ duration: Duration) {
        let clock = ContinuousClock()
        let start = clock.now
        while start.duration(to: clock.now) < duration {}
    }
}
