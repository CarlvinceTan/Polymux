import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PolymuxKit

@Suite(.serialized) @MainActor
struct ChatStoreDeltaTests {
    @Test func resumeFetchesOnlyNewEvents() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("polymux-delta-\(UUID())")
        let cache = try LocalCache(url: folder.appendingPathComponent("cache.sqlite"))
        defer { try? FileManager.default.removeItem(at: folder) }
        let thread = "delta"
        try await Task.detached {
            try CacheAudit.strict {
            for seq in 1...3 {
                let message = Message(
                    id: "\(thread)-\(seq)", threadID: thread, role: "user",
                    parts: [Part(kind: "text", text: "kept \(seq)")],
                    createdAt: WireDate.string(), status: "done", seq: Int64(seq)
                )
                try cache.apply(Event(
                    seq: Int64(seq), conversationID: thread, type: "message.start",
                    messageID: message.id, message: message, createdAt: message.createdAt
                ))
            }
            }
        }.value

        let added = (4...5).map { seq in
            Message(
                id: "\(thread)-\(seq)", threadID: thread, role: "assistant",
                parts: [Part(kind: "text", text: "new \(seq)")],
                createdAt: WireDate.string(), status: "done", seq: Int64(seq)
            )
        }
        let duplicate = Event(seq: 4, conversationID: thread, type: "message.start", messageID: added[0].id, message: added[0], createdAt: added[0].createdAt)
        let fourth = Event(seq: 4, conversationID: thread, type: "message.start", messageID: added[0].id, message: added[0], createdAt: added[0].createdAt)
        let fifth = Event(seq: 5, conversationID: thread, type: "message.start", messageID: added[1].id, message: added[1], createdAt: added[1].createdAt)
        let feed = DeltaFeed(events: [fourth, duplicate, fifth])
        let host = DeltaProtocol.routes.add { try feed.handle($0) }
        defer { DeltaProtocol.routes.remove(host) }
        let client = client(host: host)
        let mainBefore = cache.mainCalls
        let offBefore = cache.offCalls
        let store = ChatStore(client: client, cache: cache, threadID: thread)
        #expect(store.messages.map(\.id) == ["delta-1", "delta-2", "delta-3"])
        #expect(cache.mainCalls == mainBefore)
        #expect(cache.offCalls > offBefore)
        defer { store.stop() }
        await store.start()
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while !store.messages.contains(where: { $0.id == "delta-5" }), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        store.pause()
        let ids = store.messages.map(\.id)
        #expect(ids == ["delta-1", "delta-2", "delta-3", "delta-4", "delta-5"])
        #expect(Set(ids).count == ids.count)
        #expect(store.messages.map(\.text) == ["kept 1", "kept 2", "kept 3", "new 4", "new 5"])
        let urls = feed.urls
        let eventURLs = urls.filter { $0.path.contains("events") || $0.absoluteString.contains("events") }
        #expect(!eventURLs.isEmpty)
        #expect(urls.allSatisfy { !isMessageFetch($0) })
        let firstAfter = eventURLs.compactMap(queryAfter).min()
        #expect(firstAfter == 3)
        #expect(cache.mainCalls == mainBefore)
        let resumed = ChatStoreCache(client: client, cache: cache, sidebar: nil)
        let again = resumed.store(for: thread)
        #expect(again.messages.map(\.id) == ids)
        again.rememberScroll(messageID: "delta-4", atBottom: false)
        again.pause()
        #expect(resumed.store(for: thread) === again)
        #expect(again.scrollTarget == "delta-4")
        #expect(again.isPaused)
    }

    private func client(host: String) -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [DeltaProtocol.self]
        return APIClient(baseURL: URL(string: "http://\(host)")!, session: URLSession(configuration: config))
    }
}

private func isMessageFetch(_ url: URL) -> Bool {
    let raw = url.absoluteString
    if raw.contains("/events") || raw.contains("/stream") || raw.contains("/read") { return false }
    return raw.contains("/messages")
}

private func queryAfter(_ url: URL) -> Int64? {
    URLComponents(url: url, resolvingAgainstBaseURL: false)?
        .queryItems?
        .first { $0.name == "after" }
        .flatMap { Int64($0.value ?? "") }
}

private final class DeltaFeed: @unchecked Sendable {
    private let lock = NSLock()
    private var seen: [URL] = []
    private let events: [Event]

    init(events: [Event]) { self.events = events }

    var urls: [URL] { lock.withLock { seen } }

    func handle(_ request: URLRequest) throws -> (Int, Data) {
        guard let url = request.url else { throw URLError(.badURL) }
        lock.withLock { seen.append(url) }
        let raw = url.absoluteString
        if raw.contains("/messages") && !raw.contains("/events") {
            return (500, Data(#"{"code":"no","message":"full history was fetched"}"#.utf8))
        }
        if raw.contains("/events") {
            let after = queryAfter(url) ?? -1
            let page = events.filter { $0.seq > after }
            return (200, try JSONEncoder().encode(page))
        }
        if raw.contains("/stream") { return (200, Data()) }
        return (200, Data("[]".utf8))
    }
}

private final class DeltaRoutes: @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) throws -> (Int, Data)
    private let lock = NSLock()
    private var handlers: [String: Handler] = [:]

    func add(_ handler: @escaping Handler) -> String {
        let host = "delta-\(UUID().uuidString.lowercased()).test"
        lock.withLock { handlers[host] = handler }
        return host
    }

    func handler(_ host: String) -> Handler? { lock.withLock { handlers[host] } }
    func remove(_ host: String) { _ = lock.withLock { handlers.removeValue(forKey: host) } }
}

private final class DeltaProtocol: URLProtocol, @unchecked Sendable {
    static let routes = DeltaRoutes()

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host?.hasPrefix("delta-") == true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    // Finish on this call. A later client callback races Linux URLSession and traps in release.
    override func startLoading() {
        do {
            guard let url = request.url, let handler = Self.routes.handler(url.host ?? "") else { throw URLError(.badURL) }
            let (status, data) = try handler(request)
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
