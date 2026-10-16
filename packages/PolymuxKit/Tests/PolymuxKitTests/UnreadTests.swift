import Testing
@testable import PolymuxKit

struct UnreadTests {
    @Test func readChatsKeepActivity() {
        #expect(UnreadAccess.value(count: 0) == "")
        #expect(UnreadAccess.value(count: 0, activity: "Working") == "Working")
        #expect(UnreadAccess.value(count: -1, activity: "Offline") == "Offline")
    }

    @Test func unreadChatsAnnounceStateWithoutCount() {
        for count: Int64 in [1, 2, .max] {
            #expect(UnreadAccess.value(count: count) == "Unread")
            #expect(UnreadAccess.value(count: count, activity: "Working") == "Unread, Working")
        }
    }
}
