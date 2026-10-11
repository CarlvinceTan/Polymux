import Foundation
import Observation

@MainActor @Observable
public final class ChatStore {
    public let activity: ActivityStore
    public private(set) var runs: [Run] = []
    public let threadID: String
    public private(set) var messages: [Message] = []
    public private(set) var isConnected = false
    public var isVisible = true
    public private(set) var isSending = false
    public private(set) var error: String?
    public private(set) var hasEarlier = true
    @ObservationIgnored public var onUpdate: (@MainActor () -> Void)?
    @ObservationIgnored private let client: APIClient
    @ObservationIgnored private let cache: LocalCache
    @ObservationIgnored private weak var sidebar: SidebarStore?
    @ObservationIgnored private var streamTask: Task<Void, Never>?
    @ObservationIgnored private var isFlushing = false
    @ObservationIgnored private var voices: [UUID: VoiceReply] = [:]

    private struct VoiceReply {
        let userID: String
        var assistantID: String?
        var agentID: String?
        var hasEmitted = false
        let continuation: AsyncThrowingStream<VoiceFragment, any Error>.Continuation
    }

    public init(client: APIClient, cache: LocalCache, threadID: String, sidebar: SidebarStore? = nil) {
        self.client = client
        self.cache = cache
        self.threadID = threadID
        self.sidebar = sidebar
        activity = sidebar?.activity ?? ActivityStore()
        runs = (try? cache.runs(threadID: threadID)) ?? []
        activity.restore(runs)
        messages = (try? cache.messages(threadID: threadID, limit: 100)) ?? []
    }

    public func start() async {
        guard streamTask == nil else { return }
        messages = (try? cache.messages(threadID: threadID, limit: 100)) ?? messages
        streamTask = Task { [weak self] in await self?.connect() }
    }

    public func stop() {
        streamTask?.cancel()
        streamTask = nil
        isConnected = false
        for reply in voices.values { reply.continuation.finish(throwing: CancellationError()) }
        voices.removeAll()
    }

    public func send(text: String, attachments: [Attachment] = [], reply: ReplyContext? = nil, mentions: [String] = []) async {
        await send(text: text, attachments: attachments, id: UUID().uuidString, reply: reply, mentions: mentions)
    }

    public func retry(messageID: String) async {
        guard !isFlushing, let message = messages.first(where: { $0.id == messageID }), message.role == "user",
              ["pending", "failed", "error"].contains(message.status) else { return }
        if (try? cache.accepted(id: messageID)) == true { return }
        try? cache.setStatus(id: messageID, status: "pending")
        if let message = try? cache.messages(threadID: threadID).first(where: { $0.id == messageID }) { update(message) }
        if let pending = try? cache.pending(threadID: threadID), pending.contains(where: { $0.id == messageID }) {
            await flush()
        } else if let message = messages.first(where: { $0.id == messageID }), message.role == "user" {
            await send(text: message.text, attachments: message.attachments, id: message.id, reply: message.reply, mentions: message.mentions ?? [])
        }
    }

    public func cancelReply(withdrawQueued: Bool = false) async {
        do { try await client.stop(threadID: threadID, withdrawQueued: withdrawQueued) }
        catch { self.error = error.localizedDescription }
        for reply in voices.values { reply.continuation.finish(throwing: CancellationError()) }
        voices.removeAll()
    }

    public func markRead() async {
        guard isVisible else { return }
        do {
            let seq = try cache.cursor(threadID: threadID)
            try cache.markRead(threadID: threadID, seq: seq)
            onUpdate?()
            if isConnected { try await client.markRead(threadID: threadID, seq: seq) }
        } catch { self.error = error.localizedDescription }
    }

    public func loadEarlier() async {
        guard hasEarlier, let first = messages.filter({ $0.seq > 0 }).map(\.seq).min() else { return }
        do {
            var earlier = try cache.messages(threadID: threadID, before: first, limit: 100)
            if earlier.count < 100 {
                let fetched = try await client.messages(threadID: threadID, before: first)
                try cache.merge(fetched)
                earlier = try cache.messages(threadID: threadID, before: first, limit: 100)
            }
            for message in earlier { update(message) }
            hasEarlier = earlier.count == 100
        } catch { self.error = error.localizedDescription }
    }

    public func voiceReply(text: String) -> AsyncThrowingStream<VoiceFragment, any Error> {
        let token = UUID()
        let userID = UUID().uuidString
        return AsyncThrowingStream { continuation in
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                continuation.finish()
                return
            }
            voices[token] = VoiceReply(userID: userID, continuation: continuation)
            let task = Task { [weak self] in await self?.send(text: text, attachments: [], id: userID) }
            continuation.onTermination = { [weak self] _ in
                task.cancel()
                Task { @MainActor [weak self] in self?.voices.removeValue(forKey: token) }
            }
        }
    }

    private func send(text: String, attachments: [Attachment], id: String, reply: ReplyContext? = nil, mentions: [String] = []) async {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || !attachments.isEmpty else { return }
        do {
            let request = SendRequest(id: id, text: text, attachmentIDs: attachments.map(\.id), replyToID: reply?.messageID,
                                      replyPart: reply?.partIndex, mentions: mentions.isEmpty ? nil : mentions)
            let message = try cache.enqueue(threadID: threadID, request: request, attachments: attachments, reply: reply)
            update(message)
            onUpdate?()
            await flush()
        } catch {
            self.error = error.localizedDescription
            failVoices(error, ids: [id])
        }
    }

    private func connect() async {
        var delay: UInt64 = 1
        while !Task.isCancelled {
            do {
                try await repairSequences()
                var cursor = try cache.cursor(threadID: threadID)
                let visibleCount = max(100, messages.count)
                while true {
                    let replay = try await client.events(threadID: threadID, after: cursor)
                    try Task.checkCancellation()
                    if replay.isEmpty { break }
                    for event in replay { try receive(event, live: false) }
                    cursor = try cache.cursor(threadID: threadID)
                }
                messages = try cache.messages(threadID: threadID, limit: visibleCount)
                runs = try cache.runs(threadID: threadID)
                activity.restore(runs)
                isConnected = true
                error = nil
                delay = 1
                await flush()
                await markRead()
                cursor = try cache.cursor(threadID: threadID)
                for try await event in client.stream(threadID: threadID, after: cursor) {
                    try Task.checkCancellation()
                    try receive(event)
                    if event.type == "message.start" || event.type == "message.done" {
                        await markRead()
                    }
                }
                throw ClientError.unavailable
            } catch {
                if Task.isCancelled { return }
                isConnected = false
                self.error = error.localizedDescription
                failVoices(DeliveryFailure.interrupted)
            }
            try? await Task.sleep(for: .seconds(delay))
            delay = min(delay * 2, 15)
        }
    }

    private func repairSequences() async throws {
        guard try !cache.repairIDs(threadID: threadID).isEmpty else { return }
        var before: Int64?
        while true {
            try Task.checkCancellation()
            let snapshots = try await client.messages(threadID: threadID, before: before)
            try cache.repairSequences(snapshots)
            if try cache.repairIDs(threadID: threadID).isEmpty { return }
            guard let next = snapshots.map(\.seq).min(), next > 0, next != before else {
                try cache.finishRepair(threadID: threadID)
                return
            }
            before = next
        }
    }

    private func receive(_ event: Event, live: Bool = true) throws {
        guard event.conversationID == threadID else { return }
        let before = try cache.cursor(threadID: threadID)
        guard event.seq > before else { return }
        if let message = try cache.apply(event) { update(message) }
        activity.receive(event, live: live)
        if event.run != nil { runs = try cache.runs(threadID: threadID) }
        if live { isConnected = true }
        forwardVoice(event)
        onUpdate?()
    }

    private func update(_ message: Message) {
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            messages[index] = message
        } else {
            messages.append(message)
            messages.sort {
                if $0.seq == 0 && $1.seq == 0 { return $0.createdAt < $1.createdAt }
                if $0.seq == 0 { return false }
                if $1.seq == 0 { return true }
                return $0.seq < $1.seq
            }
        }
    }

    private func flush() async {
        guard !isFlushing else { return }
        isFlushing = true
        isSending = true
        defer { isFlushing = false; isSending = false }
        do {
            while let request = try cache.pending(threadID: threadID).first {
                do {
                    try cache.setStatus(id: request.id, status: "pending")
                    if let message = try cache.messages(threadID: threadID).first(where: { $0.id == request.id }) { update(message) }
                    try await sidebar?.syncEdit(threadID)
                    try await client.send(threadID: threadID, request: request)
                    try cache.acknowledge(id: request.id)
                    if let message = try cache.messages(threadID: threadID).first(where: { $0.id == request.id }) { update(message) }
                    error = nil
                } catch {
                    if try cache.accepted(id: request.id) {
                        try cache.acknowledge(id: request.id)
                        continue
                    }
                    if case let ClientError.response(code, _) = error, (400..<500).contains(code), code != 408, code != 429 {
                        try cache.setStatus(id: request.id, status: "error")
                        if let message = try cache.messages(threadID: threadID).first(where: { $0.id == request.id }) { update(message) }
                        self.error = error.localizedDescription
                        failVoices(DeliveryFailure.interrupted, ids: [request.id])
                        continue
                    }
                    let pending = try cache.pending(threadID: threadID)
                    for pending in pending {
                        try cache.setStatus(id: pending.id, status: "failed")
                        if let message = try cache.messages(threadID: threadID).first(where: { $0.id == pending.id }) { update(message) }
                    }
                    isConnected = false
                    self.error = error.localizedDescription
                    failVoices(DeliveryFailure.interrupted, ids: Set(pending.map(\.id)))
                    break
                }
            }
        } catch {
            self.error = error.localizedDescription
            failVoices(error)
        }
    }

    private func failVoices(_ error: any Error, ids: Set<String>? = nil) {
        for token in Array(voices.keys) {
            guard let reply = voices[token] else { continue }
            if let ids, !ids.contains(reply.userID) { continue }
            voices.removeValue(forKey: token)
            reply.continuation.finish(throwing: error)
        }
    }

    private func forwardVoice(_ event: Event) {
        for token in Array(voices.keys) {
            guard var reply = voices[token] else { continue }
            if reply.assistantID == nil, event.type == "message.start", event.message?.role == "assistant", event.message?.replyToID == reply.userID {
                reply.assistantID = event.messageID ?? event.message?.id
                reply.agentID = event.message?.agentID ?? event.agentID
            }
            if let id = reply.assistantID, event.messageID == id || event.message?.id == id {
                if event.type == "message.delta", let text = event.text {
                    reply.continuation.yield(VoiceFragment(text: text, agentID: reply.agentID))
                    reply.hasEmitted = true
                }
                if event.type == "message.done" {
                    if !reply.hasEmitted, let text = event.message?.text, !text.isEmpty {
                        reply.continuation.yield(VoiceFragment(text: text, agentID: reply.agentID))
                    }
                    reply.continuation.finish()
                    voices.removeValue(forKey: token)
                    continue
                }
                if event.type == "message.error" {
                    reply.continuation.finish(throwing: DeliveryFailure.interrupted)
                    voices.removeValue(forKey: token)
                    continue
                }
            }
            voices[token] = reply
        }
    }
}
