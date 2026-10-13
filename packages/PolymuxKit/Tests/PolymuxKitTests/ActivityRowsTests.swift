import Foundation
import Testing
@testable import PolymuxKit

@Suite struct ActivityRowsTests {
    private func event(_ seq: Int64, kind: String = "memory.saved", seconds: Double = 0,
                       thread: String = "chief", agents: [String]? = nil) -> Event {
        let date = Date(timeIntervalSince1970: 1_760_000_000 + seconds)
        return Event(seq: seq, conversationID: thread, type: "activity", agentID: "chief",
                     createdAt: WireDate.string(date),
                     payload: Activity(kind: kind, verb: kind == "agent.messaged" ? "Messaged" : "Saved",
                                       objectID: String(seq), objectLabel: "Preference \(seq)",
                                       at: WireDate.string(date), agentIDs: agents))
    }

    @Test func collapsesMemoriesWithinMinute() {
        let rows = ActivityRow.collapse([event(1), event(2, seconds: 20), event(3, seconds: 60)])
        #expect(rows.count == 1)
        #expect(rows.first?.label == "Saved 3 memories")
        #expect(rows.first?.seq == 1)
        #expect(rows.first?.lastSeq == 3)
    }

    @Test func boundsWindowToFirstEvent() {
        #expect(ActivityRow.collapse([event(1), event(2, seconds: 40), event(3, seconds: 80)]).count == 2)
        #expect(ActivityRow.collapse([event(1), event(2, seconds: 61)]).count == 2)
    }

    @Test func respectsMessagesKindsAndConversations() {
        let message = Message(id: "user", threadID: "chief", role: "user", parts: [],
                              createdAt: WireDate.string(), status: "done", seq: 2)
        #expect(ActivityRow.collapse([event(1), event(3, seconds: 20)], messages: [message]).count == 2)
        #expect(ActivityRow.collapse([event(1), event(2, kind: "skill.saved")]).count == 2)
        #expect(ActivityRow.collapse([event(1), event(2, thread: "aria")]).count == 2)
    }

    @Test func replayIsIdempotentAndChronological() {
        #expect(ActivityRow.collapse([event(2, seconds: 10), event(1), event(1)]).first?.count == 2)
        #expect(ActivityRow.collapse([Event(seq: 1, type: "run.update")]).isEmpty)
    }

    @Test func collectsBotsWithoutDuplicates() {
        let rows = ActivityRow.collapse([
            event(1, kind: "agent.messaged", agents: ["chief", "aria"]),
            event(2, kind: "agent.messaged", seconds: 5, agents: ["chief", "liam"])
        ])
        #expect(rows.count == 1)
        #expect(rows.first?.agents == ["chief", "aria", "liam"])
        #expect(rows.first?.label == "2 messages with")
    }

    @Test func collapsesPeerExchangesUntilTimeSeparator() {
        var reply = event(2, kind: "agent.messaged", seconds: 120, agents: ["aria", "chief"])
        reply.payload?.verb = "Message from"
        let rows = ActivityRow.collapse([
            event(1, kind: "agent.messaged", agents: ["chief", "aria"]), reply,
            event(3, kind: "agent.messaged", seconds: 400, agents: ["chief", "liam"]),
            event(4, kind: "agent.messaged", seconds: 2201, agents: ["chief", "aria"])
        ])
        #expect(rows.count == 2)
        #expect(rows.first?.count == 3)
        #expect(rows.first?.agents == ["chief", "aria", "liam"])
        #expect(rows.first?.lastDate == Date(timeIntervalSince1970: 1_760_000_400))
        if let first = rows.first {
            #expect(TranscriptRow.activity(first).lastDate == first.lastDate)
        }
    }

    @Test func deduplicatesBotsAndKeepsInvalidDatesSeparate() {
        #expect(ActivityRow.collapse([event(1, kind: "agent.messaged", agents: ["chief", "chief", "", "aria"])]).first?.agents == ["chief", "aria"])
        var invalid = event(2)
        invalid.payload?.at = "invalid"
        var other = event(3)
        other.payload?.at = "invalid"
        #expect(ActivityRow.collapse([invalid, other]).count == 2)
    }

    @Test func peerMessagesAppearOnlyInHistory() {
        let message = Message(id: "peer", threadID: "chief", role: "assistant", parts: [], createdAt: WireDate.string(), status: "done", seq: 1)
        var activity = event(2, kind: "agent.messaged", agents: ["chief", "aria"])
        activity.payload?.messageIDs = [message.id]
        let rows = TranscriptRow.ordered(messages: [message], events: [activity])
        #expect(rows.count == 1)
        #expect(rows.first?.id == "chief:activity:2")
        activity.type = "run.update"
        #expect(TranscriptRow.ordered(messages: [message], events: [activity]).first?.id == "peer")
    }

    @Test func peerRepliesCollapseWithoutBubblesAfterReload() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try LocalCache(url: directory.appendingPathComponent("cache.sqlite"))
        let request = Message(id: "request", threadID: "chief", role: "assistant", parts: [],
                              createdAt: WireDate.string(), status: "done", seq: 1)
        let reply = Message(id: "reply", threadID: "chief", role: "assistant", parts: [],
                            createdAt: WireDate.string(), status: "done", seq: 3)
        var sent = event(2, kind: "agent.messaged", agents: ["chief", "aria"])
        sent.payload?.messageIDs = [request.id, reply.id, "receipt"]
        var received = event(4, kind: "agent.messaged", seconds: 20, agents: ["chief", "aria"])
        received.payload?.verb = "Message from"
        received.payload?.messageIDs = [reply.id, "receipt"]
        for input in [Event(seq: 1, conversationID: "chief", type: "message.start", message: request), sent,
                      Event(seq: 3, conversationID: "chief", type: "message.done", message: reply), received] {
            _ = try cache.apply(input)
        }
        let client = APIClient(baseURL: URL(string: "http://localhost")!)
        let store = await ChatStore(client: client, actor: LocalCacheActor(cache), threadID: "chief")
        await store.ready()
        #expect(await store.transcript.count == 1)
        if case .activity(let row) = await store.transcript.first {
            #expect(row.label == "2 messages with")
            #expect(row.agents == ["chief", "aria"])
        } else { Issue.record("Peer reply rendered as a bubble after reload") }
    }

    @Test func restoresOfflineRowsPastEventRetention() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("cache.sqlite")
        let cache = try LocalCache(url: url)
        try cache.apply(event(1))
        for seq in 2...1003 {
            try cache.apply(Event(seq: Int64(seq), conversationID: "chief", type: "run.update"))
        }
        let reopened = try LocalCache(url: url)
        let events = try reopened.activityEvents(threadID: "chief")
        #expect(events.count == 1)
        #expect(events.first?.payload?.kind == "memory.saved")
        #expect(ActivityRow.collapse(events).first?.label == "Saved memory Preference 1")
    }

    @Test func ordersActivitiesBetweenMessages() {
        let first = Message(id: "one", threadID: "chief", role: "user", parts: [], createdAt: WireDate.string(), status: "done", seq: 1)
        let last = Message(id: "three", threadID: "chief", role: "assistant", parts: [], createdAt: WireDate.string(), status: "done", seq: 3)
        let rows = TranscriptRow.ordered(messages: [first, last], events: [event(2)])
        #expect(rows.map(\.id) == ["one", "chief:activity:2", "three"])
        if case .activity = rows[1] {} else { Issue.record("Activity was rendered as a message") }
    }

    @Test func wireRoundTripAndIcons() throws {
        let kinds = ["routine.deleted": "clock", "memory.saved": "brain", "skill.saved": "sparkles",
                     "subagent.finished": "arrow.triangle.branch", "connector.removed": "powerplug"]
        for (kind, icon) in kinds {
            let input = event(1, kind: kind)
            let decoded = try JSONDecoder().decode(Event.self, from: JSONEncoder().encode(input))
            #expect(decoded == input)
            #expect(ActivityRow.collapse([decoded]).first?.icon == icon)
        }
    }

    @Test func countsUnreadActivitiesWithoutHiddenMessages() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try LocalCache(url: directory.appendingPathComponent("cache.sqlite"))
        try cache.save(agents: [], threads: [Thread(id: "chief", agentID: "chief")])
        let reply = Message(id: "reply", threadID: "chief", role: "assistant", parts: [],
                            createdAt: WireDate.string(), status: "done", seq: 1)
        try cache.apply(Event(seq: 1, conversationID: "chief", type: "message.start", message: reply))
        var sent = event(2, kind: "agent.messaged")
        sent.payload?.messageIDs = [reply.id, "future"]
        try cache.apply(sent)
        #expect(try cache.threads().first?.unreadCount == 1)
        let future = Message(id: "future", threadID: "chief", role: "assistant", parts: [],
                             createdAt: WireDate.string(), status: "done", seq: 3)
        try cache.apply(Event(seq: 3, conversationID: "chief", type: "message.start", message: future))
        try cache.apply(event(4, kind: "memory.saved"))
        try cache.apply(event(5, kind: "subagent.started"))
        let finished = event(6, kind: "subagent.finished")
        try cache.apply(finished)
        try cache.apply(finished)
        #expect(try cache.threads().first?.unreadCount == 2)
        try cache.markRead(threadID: "chief", seq: 6)
        #expect(try cache.threads().first?.unreadCount == 0)
    }
    @Test func collapsedObjectsKeepTheirNouns() {
        for (kind, verb, label) in [("subagent.started", "Started", "Started 2 subagents"),
                                    ("connector.added", "Connected", "Connected 2 connectors"),
                                    ("instructions.updated", "Updated", "Updated 2 instructions")] {
            var first = event(1, kind: kind)
            first.payload?.verb = verb
            var second = event(2, kind: kind, seconds: 20)
            second.payload?.verb = verb
            #expect(ActivityRow.collapse([first, second]).first?.label == label)
        }
    }

    @Test func consumesWireIcons() throws {
        let json = #"{"seq":1,"conversationID":"chief","type":"activity","createdAt":"2026-10-12T10:00:00Z","payload":{"kind":"skill.saved","verb":"Saved","objectID":"skill","objectLabel":"Review","iconOrAgentID":"doc.badge.gearshape","at":"2026-10-12T10:00:00Z"}}"#
        let decoded = try JSONDecoder().decode(Event.self, from: Data(json.utf8))
        let row = try #require(ActivityRow.collapse([decoded]).first)
        #expect(row.icon == "doc.badge.gearshape")
        #expect(row.label == "Saved skill Review")
    }

    @Test func preservesTimeSeparators() throws {
        let midnight = try #require(Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 13)))
        #expect(ChatTime.startsGroup(midnight.addingTimeInterval(60), after: midnight.addingTimeInterval(-60)))
        #expect(!ChatTime.startsGroup(midnight.addingTimeInterval(600), after: midnight.addingTimeInterval(60)))
        #expect(ChatTime.startsGroup(midnight.addingTimeInterval(1861), after: midnight.addingTimeInterval(60)))
        #expect(ChatTime.startsGroup(midnight, after: nil))
    }

    @Test func boundsRetentionWithoutRevivingPeerBubbles() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try LocalCache(url: directory.appendingPathComponent("cache.sqlite"))
        try cache.save(agents: [], threads: [Thread(id: "chief", agentID: "chief")])
        let peer = Message(id: "peer", threadID: "chief", role: "assistant", parts: [], createdAt: WireDate.string(), status: "done", seq: 1)
        try cache.apply(Event(seq: 1, conversationID: "chief", type: "message.start", message: peer))
        var sent = event(2, kind: "agent.messaged")
        sent.payload?.messageIDs = [peer.id, "future"]
        try cache.apply(sent)
        for seq in 3...1003 { try cache.apply(event(Int64(seq))) }
        #expect(try cache.activityEvents(threadID: "chief").count == 1000)
        #expect(try cache.messages(threadID: "chief").isEmpty)
        let future = Message(id: "future", threadID: "chief", role: "assistant", parts: [], createdAt: WireDate.string(), status: "done", seq: 1004)
        try cache.apply(Event(seq: 1004, conversationID: "chief", type: "message.start", message: future))
        #expect(try cache.threads().first?.unreadCount == 1)
        let client = APIClient(baseURL: URL(string: "http://localhost")!)
        let store = await ChatStore(client: client, actor: LocalCacheActor(cache), threadID: "chief")
        await store.ready()
        #expect(await store.messages.isEmpty)
    }

    @Test func liveActivitiesSurviveReplayAndHideLateReplies() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try LocalCache(url: directory.appendingPathComponent("cache.sqlite"))
        let client = APIClient(baseURL: URL(string: "http://localhost")!)
        let store = await ChatStore(client: client, actor: LocalCacheActor(cache), threadID: "chief")
        await store.ready()
        var sent = event(1, kind: "agent.messaged", agents: ["chief", "aria"])
        sent.payload?.messageIDs = ["late"]
        try await store.receive(sent)
        try await store.receive(sent)
        let reply = Message(id: "late", threadID: "chief", role: "assistant", parts: [],
                            createdAt: WireDate.string(), status: "done", seq: 2)
        try await store.receive(Event(seq: 2, conversationID: "chief", type: "message.done", message: reply))
        #expect(await store.activityEvents.count == 1)
        #expect(await store.messages.isEmpty)
        #expect(await store.transcript.count == 1)
    }

    @Test @MainActor func sidebarCountsPeerActivityOnce() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try await CacheWork.open(directory.appendingPathComponent("cache.sqlite"))
        let client = APIClient(baseURL: URL(string: "http://localhost")!)
        let sidebar = SidebarStore(client: client, cache: cache)
        try await sidebar.cacheActor.call { try $0.save(agents: [], threads: [Thread(id: "chief", agentID: "chief")]) }
        await sidebar.load()
        let sent = event(1, kind: "agent.messaged", agents: ["chief", "aria"])
        sidebar.note(sent)
        sidebar.note(sent)
        #expect(sidebar.threads.first?.unreadCount == 1)
        sidebar.note(event(2))
        #expect(sidebar.threads.first?.unreadCount == 1)
        await sidebar.settled()
        #expect(try await sidebar.cacheActor.call { try $0.threads().first?.unreadCount } == 1)
    }

}
