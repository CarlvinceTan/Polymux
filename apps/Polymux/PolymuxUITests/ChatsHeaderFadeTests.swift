import XCTest

final class ChatsHeaderFadeTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        XCUIDevice.shared.appearance = .light
    }

    func testHeaderFadeLight() {
        assertHeader(appearance: .light, name: "light")
    }

    func testHeaderFadeDark() {
        assertHeader(appearance: .dark, name: "dark")
    }

    private func assertHeader(appearance: XCUIDevice.Appearance, name: String) {
        XCUIDevice.shared.appearance = appearance
        let app = XCUIApplication()
        app.launchArguments = ["-ChatsHeaderPreview"]
        app.launch()
        XCUIDevice.shared.appearance = appearance

        let nav = chatsNavigation(app)
        let fade = app.descendants(matching: .any)["chats.header.fade"]
        XCTAssertTrue(fade.waitForExistence(timeout: 8))
        waitUntilFadeSettles(fade, below: nav)

        assertChrome(app, nav: nav, fade: fade)
        let row = chatRow(app, named: "Avery")
        XCTAssertTrue(row.waitForExistence(timeout: 8))
        let resting = row.frame.minY
        attach(name: "chats-header-\(name)-before")

        let list = chatsList(app)
        let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        let end = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25))
        start.press(forDuration: 0.05, thenDragTo: end)
        let moved = chatRow(app, named: "Avery")
        if moved.exists, moved.frame.minY > 0 {
            XCTAssertLessThan(moved.frame.minY, resting - 8, "the chats list should scroll under the header")
        } else {
            XCTAssertTrue(chatRow(app, named: "Harper").exists || chatRow(app, named: "Indigo").exists)
        }
        assertChrome(app, nav: nav, fade: fade)
        attach(name: "chats-header-\(name)-after")

        app.buttons["Search agents"].tap()
        XCTAssertTrue(app.textFields["Search agents"].waitForExistence(timeout: 3))
        XCTAssertTrue(fade.exists)
        XCTAssertFalse(fade.isHittable)
        XCTAssertEqual(fade.value as? String, "background-hidden,no-divider")
        XCTAssertTrue(app.buttons["Close search"].isHittable)
        attach(name: "chats-header-\(name)-search")
        app.buttons["Close search"].tap()
    }

    private func assertChrome(_ app: XCUIApplication, nav: XCUIElement, fade: XCUIElement) {
        XCTAssertTrue(nav.exists)
        XCTAssertTrue(fade.exists)
        XCTAssertFalse(fade.isHittable, "the header fade should not take taps")
        XCTAssertEqual(fade.value as? String, "background-hidden,no-divider")
        XCTAssertFalse(app.otherElements["chats.nav.divider"].exists)
        let hairline = nav.otherElements.matching(NSPredicate(
            format: "identifier CONTAINS[c] 'separator' OR identifier CONTAINS[c] 'divider' OR identifier CONTAINS[c] 'hairline'"
        )).firstMatch
        XCTAssertFalse(hairline.exists)
        XCTAssertLessThanOrEqual(fade.frame.minY, nav.frame.minY + 1, "the fade should cover the navigation bar")
        let below = fade.frame.maxY - nav.frame.maxY
        XCTAssertEqual(below, 28, accuracy: 4, "the fade should end about 28pt below the header, was \(below)")
        XCTAssertTrue(app.buttons["Settings"].isHittable)
        XCTAssertTrue(app.buttons["Filter conversations"].isHittable)
    }

    private func waitUntilFadeSettles(_ fade: XCUIElement, below nav: XCUIElement) {
        let settled = NSPredicate { _, _ in
            fade.exists && fade.frame.height > 40 && fade.frame.maxY > nav.frame.maxY + 20
        }
        let expectation = XCTNSPredicateExpectation(predicate: settled, object: nil)
        wait(for: [expectation], timeout: 6)
    }

    private func chatsNavigation(_ app: XCUIApplication) -> XCUIElement {
        let titled = app.navigationBars["Chats"]
        if titled.waitForExistence(timeout: 10) { return titled }
        XCTAssertTrue(app.staticTexts["Chats"].waitForExistence(timeout: 2))
        let bar = app.navigationBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 2))
        return bar
    }

    private func chatsList(_ app: XCUIApplication) -> XCUIElement {
        let identified = app.descendants(matching: .any)["chats.list"]
        if identified.exists { return identified }
        if app.collectionViews.firstMatch.exists { return app.collectionViews.firstMatch }
        if app.tables.firstMatch.exists { return app.tables.firstMatch }
        return app.scrollViews.firstMatch
    }

    private func chatRow(_ app: XCUIApplication, named name: String) -> XCUIElement {
        let predicate = NSPredicate(format: "label BEGINSWITH %@", name)
        let cell = app.cells.matching(predicate).firstMatch
        if cell.exists { return cell }
        let button = app.buttons.matching(predicate).firstMatch
        if button.exists { return button }
        return app.descendants(matching: .any).matching(predicate).firstMatch
    }

    private func attach(name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
