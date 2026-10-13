import Dispatch
import Foundation

/// Background owner of one `LocalCache` connection.
/// Work entered here is never on the main queue.
public actor LocalCacheActor {
    private let cache: LocalCache
    private var saves = 0
    private var marks = 0
    private var stall: Duration = .zero
    private var failing = false

    public init(_ cache: LocalCache) {
        self.cache = cache
    }

    public var saveCount: Int { saves }
    public var markCount: Int { marks }

    public func setStall(_ duration: Duration) { stall = duration }
    public func setFailing(_ enabled: Bool) { failing = enabled }

    /// Holds the actor without touching SQLite. Used to prove the main actor keeps running.
    public func touch() async throws {
        try await enter()
    }

    public func save(agents: [Agent], threads: [Thread], pins: [String]? = nil) async throws {
        try await enter()
        saves += 1
        if failing { throw ClientError.cache("forced") }
        try cache.save(agents: agents, threads: threads, pins: pins)
    }

    public func markRead(threadID: String, seq: Int64) async throws {
        try await enter()
        marks += 1
        try cache.markRead(threadID: threadID, seq: seq)
    }

    public func call<T: Sendable>(_ body: @Sendable (LocalCache) throws -> T) async throws -> T {
        try await enter()
        return try body(cache)
    }

    private func enter() async throws {
        #if DEBUG
        // Debug builds trap if a cache call is still on the main queue.
        dispatchPrecondition(condition: .notOnQueue(.main))
        #endif
        if stall > .zero { try await Task.sleep(for: stall) }
    }
}
