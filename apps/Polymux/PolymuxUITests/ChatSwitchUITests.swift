import XCTest

/// Opens 10 fixture chats and reselects 5. Cached rows must already be resident.
@MainActor
final class ChatSwitchUITests: XCTestCase {
    func testCachedReselectShowsMessages() {
        let app = XCUIApplication()
        app.launchArguments.append("--chat-switch-fixture")
        app.launch()
        let rows = (0..<10).map { row("chat-switch-\($0)", in: app) }
        XCTAssertTrue(rows.allSatisfy { $0.waitForExistence(timeout: 15) }, "Chat switch fixture is missing")
        for (index, row) in rows.enumerated() {
            reveal(row, in: app)
            row.tap()
            XCTAssertTrue(content(index, in: app).waitForExistence(timeout: 15))
        }
        for index in 5..<10 {
            reveal(rows[index], in: app)
            rows[index].tap()
            XCTAssertTrue(content(index, in: app).waitForExistence(timeout: 15))
        }
        reveal(rows[0], in: app)
        rows[0].tap()
        XCTAssertTrue(content(0, in: app).waitForExistence(timeout: 15))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "chat-switch-reselect"
        shot.lifetime = .keepAlways
        add(shot)
        let samples = app.descendants(matching: .any)["switch.samples"]
        XCTAssertTrue(samples.waitForExistence(timeout: 5))
        var gaps: [Double] = []
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline && gaps.count < 5 {
            gaps = samples.label.split(separator: ",").compactMap { Double($0) }
            if gaps.count >= 5 { break }
            Thread.sleep(forTimeInterval: 0.1)
        }
        let cached = Array(gaps.suffix(5))
        XCTAssertGreaterThanOrEqual(cached.count, 5, "missing ChatSwitchState samples \(samples.label)")
        let sorted = cached.sorted()
        let rank = max(0, Int((Double(sorted.count) * 0.95).rounded(.up)) - 1)
        XCTAssertLessThan(sorted[rank], 50, "cached reselect p95 \(sorted[rank]) ms")
    }

    private func row(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["sidebar.row.\(id)"]
    }

    private func content(_ index: Int, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["chat.content.chat-switch-\(index)"]
    }

    private func reveal(_ row: XCUIElement, in app: XCUIApplication) {
        if row.exists && row.isHittable { return }
        if app.buttons["Chats"].exists { app.buttons["Chats"].tap() }
    }
}
