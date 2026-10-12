import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PolymuxKit

@Suite(.serialized) @MainActor
struct ChatStoreCacheTests {
    @Test func reselectReusesTheSameStore() async throws {
        let cache = try LocalCache(url: location())
        let client = APIClient(baseURL: URL(string: "http://127.0.0.1:9")!)
        let thread = "reuse"
        try await seed(cache, thread: thread, count: 2)
        let chats = ChatStoreCache(client: client, cache: cache, sidebar: nil)
        let before = ChatStore.createdCount
        let mainBefore = cache.mainCalls
        let offBefore = cache.offCalls
        let first = chats.store(for: thread)
        let second = chats.store(for: thread)
        #expect(first === second)
        #expect(ChatStore.createdCount > before)
        #expect(chats.count == 1)
        #expect(first.messages.map(\.id) == ["\(thread)-1", "\(thread)-2"])
        #expect(cache.mainCalls == mainBefore)
        #expect(cache.offCalls > offBefore)
    }

    @Test func pauseKeepsTranscriptAndScroll() async throws {
        let cache = try LocalCache(url: location())
        let client = APIClient(baseURL: URL(string: "http://127.0.0.1:9")!)
        let thread = "pause"
        try await seed(cache, thread: thread, count: 3)
        let chats = ChatStoreCache(client: client, cache: cache, sidebar: nil)
        let store = chats.store(for: thread)
        store.rememberScroll(messageID: "\(thread)-2", atBottom: false)
        #expect(store.scrollTarget == "\(thread)-2")
        chats.activate("other")
        #expect(store.isPaused)
        #expect(chats.store(for: thread) === store)
        #expect(store.messages.map(\.id) == ["\(thread)-1", "\(thread)-2", "\(thread)-3"])
        #expect(store.scrollTarget == "\(thread)-2")
        store.rememberScroll(messageID: "missing", atBottom: false)
        #expect(store.scrollTarget == "\(thread)-2")
        store.rememberScroll(messageID: nil, atBottom: true)
        #expect(store.scrollTarget == nil)
        await store.start()
        #expect(!store.isPaused)
        store.stop()
        chats.store(for: "other").stop()
    }

    @Test func memoryStaysAtEightStores() async throws {
        let cache = try LocalCache(url: location())
        let client = APIClient(baseURL: URL(string: "http://127.0.0.1:9")!)
        let chats = ChatStoreCache(client: client, cache: cache, sidebar: nil)
        var opened: [String: ChatStore] = [:]
        for index in 0..<20 {
            let id = "bound-\(index)"
            opened[id] = chats.store(for: id)
        }
        #expect(chats.count == ChatStoreCache.capacity)
        for index in 12..<20 {
            #expect(chats.store(for: "bound-\(index)") === opened["bound-\(index)"])
        }
        #expect(chats.store(for: "bound-0") !== opened["bound-0"])
        #expect(chats.count == ChatStoreCache.capacity)
    }

    @Test func warmReselectBeatsColdOpen() async throws {
        let cache = try LocalCache(url: location())
        let client = APIClient(baseURL: URL(string: "http://127.0.0.1:9")!)
        var ids: [String] = []
        for index in 0..<10 {
            let id = "switch-\(index)"
            ids.append(id)
            try await seed(cache, thread: id, count: 4)
        }
        var before: [Double] = []
        for id in ids.prefix(5) {
            let start = ContinuousClock.now
            let store = ChatStore(client: client, cache: cache, threadID: id)
            #expect(!store.messages.isEmpty)
            before.append(elapsed(since: start))
        }
        let chats = ChatStoreCache(client: client, cache: cache, sidebar: nil)
        for id in ids { _ = chats.store(for: id) }
        let mainBefore = cache.mainCalls
        var after: [Double] = []
        for id in ids.prefix(5) {
            let start = ContinuousClock.now
            let store = chats.store(for: id)
            #expect(!store.messages.isEmpty)
            #expect(store.messages.count == 4)
            after.append(elapsed(since: start))
        }
        let hangs = after.filter { $0 > 16 }.count
        let report = SwitchReport(
            before_p95_ms: percentile95(before),
            after_p95_ms: percentile95(after),
            hangs_over_16ms: hangs,
            opens: ids.count,
            reselects: after.count,
            samples_before_ms: before,
            samples_after_ms: after,
            budget_ms: 50
        )
        let data = try JSONEncoder().encode(report)
        let line = "CHAT_SWITCH " + String(decoding: data, as: UTF8.self)
        print(line)
        if let path = ProcessInfo.processInfo.environment["POLYMUX_PERF_OUT"] {
            let url = URL(fileURLWithPath: path)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url)
        }
        #expect(cache.mainCalls == mainBefore)
        #expect(report.after_p95_ms < 50)
        #expect(hangs == 0)
    }

    private func location() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("polymux-switch-\(UUID())/cache.sqlite")
    }

    private func elapsed(since start: ContinuousClock.Instant) -> Double {
        let duration = start.duration(to: .now)
        return Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15
    }

    private func percentile95(_ samples: [Double]) -> Double {
        let sorted = samples.sorted()
        let rank = max(0, Int((Double(sorted.count) * 0.95).rounded(.up)) - 1)
        return sorted[min(rank, sorted.count - 1)]
    }
}

struct SwitchReport: Encodable {
    var before_p95_ms: Double
    var after_p95_ms: Double
    var hangs_over_16ms: Int
    var opens: Int
    var reselects: Int
    var samples_before_ms: [Double]
    var samples_after_ms: [Double]
    var budget_ms: Double
}

private func seed(_ cache: LocalCache, thread: String, count: Int) async throws {
    try await Task.detached {
        try CacheAudit.strict {
        for seq in 1...count {
            let message = Message(
                id: "\(thread)-\(seq)", threadID: thread, role: "assistant",
                parts: [Part(kind: "text", text: "Message \(seq)")],
                createdAt: WireDate.string(), status: "done", seq: Int64(seq)
            )
            try cache.apply(Event(
                seq: Int64(seq), conversationID: thread, type: "message.start",
                messageID: message.id, message: message, createdAt: message.createdAt
            ))
        }
        }
    }.value
}
