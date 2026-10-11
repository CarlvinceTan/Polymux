import Foundation
import Testing
@testable import PolymuxKit

@Suite(.enabled(if: ProcessInfo.processInfo.environment["POLYMUX_LIVE_URL"] != nil)) @MainActor
struct LiveTests {
    @Test func clientStreamsPersistsAndSearchesOffline() async throws {
        let address = try #require(ProcessInfo.processInfo.environment["POLYMUX_LIVE_URL"])
        let endpoint = try #require(URL(string: address))
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("polymux-live-\(UUID())/cache.sqlite")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let client = APIClient(baseURL: endpoint)
        let agents = try await client.agents()
        let threads = try await client.threads()
        #expect(agents.contains { $0.id == "research" })
        #expect(threads.contains { $0.id == "research" })
        let cache = try LocalCache(url: url)
        try cache.save(agents: agents, threads: threads)
        let chat = ChatStore(client: client, cache: cache, threadID: "research")
        defer { chat.stop() }
        await chat.start()
        for _ in 0..<200 {
            if chat.isConnected { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        #expect(chat.isConnected)
        let stream = chat.voiceReply(text: "Reply with exactly this short sentence: Polymux client integration verified.")
        let response = try await withThrowingTaskGroup(of: String.self) { group in
            group.addTask {
                var response = ""
                for try await delta in stream { response += delta.text }
                return response
            }
            group.addTask {
                try await Task.sleep(for: .seconds(120))
                throw ClientError.response(408, "Timed out waiting for the live reply.")
            }
            let response = try await group.next() ?? ""
            group.cancelAll()
            return response
        }
        #expect(response.lowercased().contains("integration verified"))
        #expect(chat.messages.contains { $0.role == "assistant" && $0.status == "done" && $0.text == response })
        chat.stop()
        var seq = try cache.cursor(threadID: "research")
        #expect(seq > 0)
        while true {
            let tail = try await client.events(threadID: "research", after: seq)
            if tail.isEmpty { break }
            for event in tail { try cache.apply(event) }
            seq = try cache.cursor(threadID: "research")
        }
        let relaunched = try LocalCache(url: url)
        #expect(try relaunched.cursor(threadID: "research") == seq)
        #expect(try relaunched.messages(threadID: "research").contains { $0.text == response })
        let offline = APIClient(baseURL: URL(string: "http://127.0.0.1:1")!)
        let search = SearchStore(client: offline, cache: relaunched, threadID: "research")
        search.query = "integration verified"
        await search.search()
        #expect(search.isOffline)
        #expect(search.results.contains { $0.message.text == response })
        let offlineChat = ChatStore(client: offline, cache: relaunched, threadID: "research")
        await offlineChat.send(text: "Offline probe stays in this temporary cache.")
        #expect(offlineChat.messages.last?.status == "failed")
        let thirdLaunch = try LocalCache(url: url)
        #expect(try thirdLaunch.pending(threadID: "research").count == 1)
        #expect(try thirdLaunch.messages(threadID: "research").last?.status == "failed")
    }
}
