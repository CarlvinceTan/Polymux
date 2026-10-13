// Template for apps/Polymux/PolymuxUITests/ReadinessTests.swift (app PR, not infra).
// verify.sh treats a run as "ready" only when this passes. It needs the app to:
//  - read POLYMUX_DATA_DIR (own data dir per worktree) and POLYMUX_SEED=1 (load fixture sessions),
//  - tag the sidebar list `sidebar.sessions` and each row `session.row.<id>`.
import XCTest

final class ReadinessTests: XCTestCase {
    func testSidebarAndSeededSessionsLoad() throws {
        let app = XCUIApplication()
        let env = ProcessInfo.processInfo.environment
        app.launchEnvironment["POLYMUX_DATA_DIR"] = env["POLYMUX_DATA_DIR"]
        app.launchEnvironment["POLYMUX_SEED"] = "1"
        app.launch()
        let sidebar = app.descendants(matching: .any)["sidebar.sessions"]
        XCTAssertTrue(sidebar.waitForExistence(timeout: 30), "sidebar.sessions never appeared")
        let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'session.row.'"))
        let loaded = expectation(for: NSPredicate(format: "count >= 3"), evaluatedWith: rows)
        wait(for: [loaded], timeout: 30)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "ready"; shot.lifetime = .keepAlways; add(shot)
    }
}
