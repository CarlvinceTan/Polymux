import Foundation
import Testing
@testable import PolymuxKit

@Suite(.serialized) @MainActor
struct ChatStoreCacheTests {
    @Test func reselectKeepsStoreAndScroll() async throws {
        let cache = try await openCache()
        let chats = ChatStoreCache(client: APIClient(baseURL: URL(string: "http://127.0.0.1:9")!), cache: cache, sidebar: nil)
        try await LocalCacheActor(cache).call { cache in
            for seq in 1...3 {
                let message = Message(id: "pause-\(seq)", threadID: "pause", role: "assistant",
                                      parts: [Part(kind: "text", text: "Message \(seq)")],
                                      createdAt: WireDate.string(), status: "done", seq: Int64(seq))
                _ = try cache.apply(Event(seq: Int64(seq), conversationID: "pause", type: "message.start",
                                          messageID: message.id, message: message, createdAt: message.createdAt))
            }
        }
        let store = chats.store(for: "pause")
        await store.ready()
        store.rememberScroll(messageID: "pause-2", atBottom: false)
        chats.activate("other")
        #expect(store.isPaused)
        #expect(chats.store(for: "pause") === store)
        #expect(store.messages.map(\.id) == ["pause-1", "pause-2", "pause-3"])
        #expect(store.scrollTarget == "pause-2")
    }

    @Test func pausedMessagesStayBounded() async throws {
        let chats = ChatStoreCache(client: APIClient(baseURL: URL(string: "http://127.0.0.1:9")!), cache: try await openCache(), sidebar: nil)
        var held = 0
        for index in 0..<8 {
            let id = "large-\(index)"
            let store = chats.store(for: id)
            await store.ready()
            var incoming: [Message] = []
            incoming.reserveCapacity(5000)
            for seq in 1...5000 {
                incoming.append(Message(id: "\(id)-\(seq)", threadID: id, role: "assistant",
                                        parts: [Part(kind: "text", text: "m")],
                                        createdAt: "t", status: "done", seq: Int64(seq)))
                if seq.isMultiple(of: 250) { await Task.yield() }
            }
            store.adopt(incoming)
            store.rememberScroll(messageID: "\(id)-100", atBottom: false)
            store.pause()
            #expect(store.messages.count <= 241)
            #expect(store.messages.last?.id == "\(id)-5000")
            #expect(store.messages.contains { $0.id == "\(id)-100" })
            held += store.messages.count
        }
        #expect(chats.count == 8)
        #expect(held <= 8 * 241)
    }

    @Test func pendingSendIsNotEvicted() async throws {
        let chats = ChatStoreCache(client: APIClient(baseURL: URL(string: "http://127.0.0.1:9")!), cache: try await openCache(), sidebar: nil)
        let sending = chats.store(for: "sending")
        await sending.ready()
        sending.update(Message(id: "pending", threadID: "sending", role: "user", status: "pending"))
        for index in 0..<10 { _ = chats.store(for: "other-\(index)") }
        #expect(chats.store(for: "sending") === sending)
        #expect(!chats.contains("other-0"))
        #expect(chats.count == 8)
    }

    @Test func pauseDropsVoices() async throws {
        let chats = ChatStoreCache(client: APIClient(baseURL: URL(string: "http://127.0.0.1:9")!), cache: try await openCache(), sidebar: nil)
        let store = chats.store(for: "voice")
        await store.ready()
        let stream = store.voiceReply(text: "hello")
        #expect(store.voiceCount == 1)
        store.pause()
        #expect(store.voiceCount == 1)
        #expect(!store.canEvict)
        store.stop()
        #expect(store.voiceCount == 0)
        withExtendedLifetime(stream) {}
    }

    private func openCache() async throws -> LocalCache {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("polymux-switch-\(UUID())/cache.sqlite")
        return try await Task.detached { try LocalCache(url: url) }.value
    }
}
