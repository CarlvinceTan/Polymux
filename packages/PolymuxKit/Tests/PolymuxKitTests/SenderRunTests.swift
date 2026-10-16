import Testing
@testable import PolymuxKit

struct SenderRunTests {
    private func message(_ role: String = "assistant", agent: String? = "a") -> Message {
        Message(id: "message", threadID: "group", role: role, parts: [],
                createdAt: "2026-10-14T00:00:00Z", status: "done", seq: 1, agentID: agent)
    }

    @Test func consecutiveSenders() {
        let first = message()
        let second = message(agent: "b")
        #expect(first.startsRun(after: nil))
        #expect(!first.startsRun(after: first))
        #expect(second.startsRun(after: first))
        #expect(first.startsRun(after: second))
    }

    @Test func userInterruptsRun() {
        let bot = message()
        let user = message("user", agent: nil)
        #expect(!user.startsRun(after: nil))
        #expect(!user.startsRun(after: bot))
        #expect(bot.startsRun(after: user))
    }

    @Test func unknownSendersStaySeparate() {
        let unknown = message(agent: nil)
        #expect(unknown.startsRun(after: unknown))
        #expect(message().startsRun(after: unknown))
    }
}
