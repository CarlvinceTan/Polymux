import OSLog
import XCTest

/// Opens 10 chats and reselects 5. Cached rows must already be resident;
/// the signpost interval is click -> first content.
final class ChatSwitchUITests: XCTestCase {
    func testCachedReselectShowsMessages() throws {
        let app = XCUIApplication()
        app.launchArguments.append("--chat-switch-fixture")
        app.launch()
        let chats = (0..<10).map { app.buttons["chat-switch-\($0)"] }
        guard chats.allSatisfy(\.exists) else {
            throw XCTSkip("Chat switch fixture is not in this build")
        }
        let start = Date()
        for chat in chats { chat.tap() }
        for chat in chats.prefix(5) { chat.tap() }
        let store = try OSLogStore.local()
        let entries = try store.getEntries(
            at: store.position(date: start),
            matching: NSPredicate(format: "subsystem == %@", "com.polymux.chat")
        )
        var clicks: [Date] = []
        var gaps: [Double] = []
        for entry in entries {
            guard let log = entry as? OSLogEntrySignpost else { continue }
            if log.signpostName == "click" { clicks.append(log.date) }
            if log.signpostName == "content", let click = clicks.last {
                gaps.append(log.date.timeIntervalSince(click) * 1000)
            }
        }
        XCTAssertGreaterThanOrEqual(gaps.count, 5)
        let sorted = gaps.sorted()
        let rank = max(0, Int((Double(sorted.count) * 0.95).rounded(.up)) - 1)
        XCTAssertLessThan(sorted[rank], 50)
    }
}
