import XCTest

final class HeaderCapsuleUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testHeightMatchesToolbar() {
        for theme in ["Light", "Dark"] {
            let app = open("t-aria", theme: theme)
            let capsule = app.buttons["header.capsule"]
            let search = app.buttons["header.search"]
            XCTAssertTrue(search.waitForExistence(timeout: 5))
            XCTAssertEqual(capsule.value as? String, "1 avatars")
            XCTAssertGreaterThan(capsule.frame.height, 0)
            XCTAssertEqual(capsule.frame.height, search.frame.height, accuracy: 1)
            capture(app, name: "direct-" + theme)
        }
    }

    func testGroupPlusN() {
        for theme in ["Light", "Dark"] {
            let app = open("grp-trip", five: true, theme: theme)
            XCTAssertTrue(app.staticTexts["header.overflow"].waitForExistence(timeout: 5))
            XCTAssertEqual(app.staticTexts["header.overflow"].label, "+2")
            XCTAssertEqual(app.buttons["header.capsule"].value as? String, "3 avatars")
            capture(app, name: "group-five-" + theme)
        }
    }

    func testProfileOpens() {
        for theme in ["Light", "Dark"] {
            let app = open("t-chief", theme: theme)
            capture(app, name: "chief-" + theme)
            press(app.buttons["header.capsule"])
            XCTAssertTrue(app.textFields.firstMatch.waitForExistence(timeout: 2))
            capture(app, name: "profile-" + theme)
        }
    }

    private func open(_ id: String, five: Bool = false, theme: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--verify-fixture", "-AppleInterfaceStyle", theme] + (five ? ["--verify-header-five"] : [])
        app.launch()
        #if os(macOS)
        app.activate()
        #endif
        let row = app.descendants(matching: .any)["sidebar.row.\(id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        press(row)
        XCTAssertTrue(app.buttons["header.capsule"].waitForExistence(timeout: 5))
        return app
    }

    private func press(_ element: XCUIElement) {
        #if os(macOS)
        element.click()
        #else
        element.tap()
        #endif
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "CL1-\(name)"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
