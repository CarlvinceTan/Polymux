import Dispatch
import Foundation
import Observation

public struct ScrollAnchor: Equatable, Sendable {
    public var messageID: String
    public var atBottom: Bool

    public init(messageID: String, atBottom: Bool) {
        self.messageID = messageID
        self.atBottom = atBottom
    }
}

@MainActor @Observable
public final class ChatStore {
    public static var createdCount = 0
    public let activity: ActivityStore
    public private(set) var runs: [Run] = []
    public let threadID: String
    public private(set) var messages: [Message] = []
    public private(set) var isConnected = false
    public private(set) var isPaused = false
    public private(set) var scrollAnchor: ScrollAnchor?
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

    private struct Applied: Sendable {
        var ignored: Bool
        var message: Message?
        var runs: [Run]?
    }

    /// The visible transcript is whatever this store already holds. Disk is read once, off the main actor.
    public var scrollTarget: String? {
        guard let scrollAnchor, !scrollAnchor.atBottom else { return nil }
        guard messages.contains(where: { $0.id == scrollAnchor.messageID }) else { return nil }
        return scrollAnchor.messageID
    }

    public init(client: APIClient, cache: LocalCache, threadID: String, sidebar: SidebarStore? = nil) {
        Self.createdCount += 1
        self.client = client
        self.cache = cache
        self.threadID = threadID
        self.sidebar = sidebar
        activity = sidebar?.activity ?? ActivityStore()
        let snapshot = Self.snapshot(cache: cache, threadID: threadID)
        runs = snapshot.runs
        activity.restore(runs)
        messages = snapshot.messages
    }

    public func rememberScroll(messageID: String?, atBottom: Bool) {
        if atBottom {
            scrollAnchor = ScrollAnchor(messageID: messages.last?.id ?? messageID ?? "", atBottom: true)
            return
        }
        guard let messageID, messages.contains(where: { $0.id == messageID }) else { return }
        scrollAnchor = ScrollAnchor(messageID: messageID, atBottom: false)
    }

    public func start() async {
        isPaused = false
        guard streamTask == nil else { return }
        streamTask = Task { [weak self] in await self?.connect() }
    }

    /// Leave the chat without dropping messages or the scroll anchor.
    public func pause() {
        streamTask?.cancel()
        streamTask = nil
        isPaused = true
    }

    public func stop() {
        pause()
        isPaused = false
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
        if (try? await withCache({ try $0.accepted(id: messageID) })) == true { return }
        try? await withCache { try $0.setStatus(id: messageID, status: "pending") }
        if let message = try? await withCache({ try $0.messages(threadID: threadID).first(where: { $0.id == messageID }) }) { update(message) }
        if let pending = try? await withCache({ try $0.pending(threadID: threadID) }), pending.contains(where: { $0.id == messageID }) {
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
            let seq = try await withCache { cache -> Int64 in
                let seq = try cache.cursor(threadID: threadID)
                try cache.markRead(threadID: threadID, seq: seq)
                return seq
            }
            onUpdate?()
            if isConnected { try await client.markRead(threadID: threadID, seq: seq) }
        } catch { self.error = error.localizedDescription }
    }

    public func loadEarlier() async {
        guard hasEarlier, let first = messages.filter({ $0.seq > 0 }).map(\.seq).min() else { return }
        do {
            var earlier = try await withCache { try $0.messages(threadID: threadID, before: first, limit: 100) }
            if earlier.count < 100 {
                let fetched = try await client.messages(threadID: threadID, before: first)
                try await withCache { try $0.merge(fetched) }
                earlier = try await withCache { try $0.messages(threadID: threadID, before: first, limit: 100) }
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
            let message = try await withCache { try $0.enqueue(threadID: threadID, request: request, attachments: attachments, reply: reply) }
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
                var cursor = try await withCache { try $0.cursor(threadID: threadID) }
                while true {
                    let replay = try await client.events(threadID: threadID, after: cursor)
                    try Task.checkCancellation()
                    if replay.isEmpty { break }
                    for event in replay { try await receive(event, live: false) }
                    cursor = try await withCache { try $0.cursor(threadID: threadID) }
                }
                isConnected = true
                error = nil
                delay = 1
                await flush()
                await markRead()
                cursor = try await withCache { try $0.cursor(threadID: threadID) }
                for try await event in client.stream(threadID: threadID, after: cursor) {
                    try Task.checkCancellation()
                    try await receive(event)
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
        let pending = try await withCache { try $0.repairIDs(threadID: threadID) }
        guard !pending.isEmpty else { return }
        var before: Int64?
        while true {
            try Task.checkCancellation()
            let snapshots = try await client.messages(threadID: threadID, before: before)
            try await withCache { try $0.repairSequences(snapshots) }
            let remaining = try await withCache { try $0.repairIDs(threadID: threadID) }
            if remaining.isEmpty { return }
            guard let next = snapshots.map(\.seq).min(), next > 0, next != before else {
                try await withCache { try $0.finishRepair(threadID: threadID) }
                return
            }
            before = next
        }
    }

    private func receive(_ event: Event, live: Bool = true) async throws {
        guard event.conversationID == threadID else { return }
        let applied = try await withCache { cache -> Applied in
            let before = try cache.cursor(threadID: event.conversationID)
            guard event.seq > before else { return Applied(ignored: true, message: nil, runs: nil) }
            let message = try cache.apply(event)
            let runs = event.run != nil ? try cache.runs(threadID: event.conversationID) : nil
            return Applied(ignored: false, message: message, runs: runs)
        }
        if applied.ignored { return }
        if let message = applied.message { update(message) }
        if let runs = applied.runs { self.runs = runs }
        activity.receive(event, live: live)
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
            while let request = try await withCache({ try $0.pending(threadID: threadID).first }) {
                do {
                    try await withCache { try $0.setStatus(id: request.id, status: "pending") }
                    if let message = try await withCache({ try $0.messages(threadID: threadID).first(where: { $0.id == request.id }) }) { update(message) }
                    try await sidebar?.syncEdit(threadID)
                    try await client.send(threadID: threadID, request: request)
                    try await withCache { try $0.acknowledge(id: request.id) }
                    if let message = try await withCache({ try $0.messages(threadID: threadID).first(where: { $0.id == request.id }) }) { update(message) }
                    error = nil
                } catch {
                    if try await withCache({ try $0.accepted(id: request.id) }) {
                        try await withCache { try $0.acknowledge(id: request.id) }
                        continue
                    }
                    if case let ClientError.response(code, _) = error, (400..<500).contains(code), code != 408, code != 429 {
                        try await withCache { try $0.setStatus(id: request.id, status: "error") }
                        if let message = try await withCache({ try $0.messages(threadID: threadID).first(where: { $0.id == request.id }) }) { update(message) }
                        self.error = error.localizedDescription
                        failVoices(DeliveryFailure.interrupted, ids: [request.id])
                        continue
                    }
                    let pending = try await withCache { try $0.pending(threadID: threadID) }
                    for pending in pending {
                        try await withCache { try $0.setStatus(id: pending.id, status: "failed") }
                        if let message = try await withCache({ try $0.messages(threadID: threadID).first(where: { $0.id == pending.id }) }) { update(message) }
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

    private func withCache<T: Sendable>(_ body: @Sendable (LocalCache) throws -> T) async throws -> T {
        let cache = cache
        return try await withoutActuallyEscaping(body) { body in
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<T, Error>) in
                DispatchQueue.global(qos: .userInitiated).async {
                    let result = Result { () throws -> T in
                        try CacheAudit.strict {
                            #if DEBUG
                            dispatchPrecondition(condition: .notOnQueue(.main))
                            #endif
                            return try body(cache)
                        }
                    }
                    continuation.resume(with: result)
                }
            }
        }
    }

    /// One disk read, never on the main thread. Later switches reuse the in-memory transcript.
    private static func snapshot(cache: LocalCache, threadID: String) -> (messages: [Message], runs: [Run]) {
        let loaded = try? CacheAudit.hop {
            try CacheAudit.strict { () throws -> (messages: [Message], runs: [Run]) in
                #if DEBUG
                dispatchPrecondition(condition: .notOnQueue(.main))
                #endif
                let runs = (try? cache.runs(threadID: threadID)) ?? []
                let messages = (try? cache.messages(threadID: threadID, limit: 100)) ?? []
                return (messages, runs)
            }
        }
        return loaded ?? ([], [])
    }
}

/// Keeps the last few chats resident so a reselect paints the transcript it already has.
@MainActor
public final class ChatStoreCache {
    public static let capacity = 8
    public private(set) var activeID: String?
    private var stores: [String: ChatStore] = [:]
    private var order: [String] = []
    private let client: APIClient
    private let cache: LocalCache
    private weak var sidebar: SidebarStore?

    public init(client: APIClient, cache: LocalCache, sidebar: SidebarStore?) {
        self.client = client
        self.cache = cache
        self.sidebar = sidebar
    }

    public var count: Int { stores.count }

    public func contains(_ threadID: String) -> Bool { stores[threadID] != nil }

    public func store(for threadID: String) -> ChatStore {
        if let existing = stores[threadID] {
            touch(threadID)
            return existing
        }
        let created = ChatStore(client: client, cache: cache, threadID: threadID, sidebar: sidebar)
        stores[threadID] = created
        order.append(threadID)
        while stores.count > Self.capacity, let oldest = order.first {
            order.removeFirst()
            stores.removeValue(forKey: oldest)?.stop()
        }
        return created
    }

    public func activate(_ threadID: String?) {
        activeID = threadID
        for (id, store) in stores where id != threadID {
            store.pause()
        }
        guard let threadID else { return }
        _ = store(for: threadID)
    }

    private func touch(_ threadID: String) {
        order.removeAll { $0 == threadID }
        order.append(threadID)
    }
}
