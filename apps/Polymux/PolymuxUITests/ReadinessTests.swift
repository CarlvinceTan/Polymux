// Template for apps/Polymux/PolymuxUITests/ReadinessTests.swift (app PR, not infra).
// verify.sh grants UI-verified only when this passes; its screenshots are the proof media.
// Identifiers and waits follow /workspace/polymux-merge/verify-polymux-features.md:
//  - launch argument --verify-fixture (DEBUG seed: 6 agents, 12 sessions), POLYMUX_DATA_DIR per worktree,
//  - list `chats.list`, rows `sidebar.row.<threadID>` (all 12 seeded ids),
//  - optional server health (POLYMUX_VERIFY_PORT), REQUIRED hidden `app.status` value (connected=1, cache=warm),
//  - no activity indicators / "Loading" labels for 2 polls, app running in the foreground.
// Each wait's elapsed ms goes to ready.json (attachment) for ~/verify-evidence/<worktree>/<run-id>/.
import XCTest

final class ReadinessTests: XCTestCase {
    static let seededIDs = ["t-chief", "t-aria", "t-milo", "t-nova", "t-long", "t-stream", "t-approval",
                            "grp-trip", "t-media", "t-activity", "t-fern", "grp-empty"]
    var waits: [String: Int] = [:]

    func timed(_ name: String, timeout: TimeInterval = 30, _ ok: () -> Bool) {
        let t0 = Date()
        while !ok() {
            if Date().timeIntervalSince(t0) > timeout { XCTFail("readiness wait '\(name)' timed out"); return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        waits[name] = Int(Date().timeIntervalSince(t0) * 1000)
    }

    func testSidebarAndSeededSessionsLoad() throws {
        let app = XCUIApplication()
        let env = ProcessInfo.processInfo.environment
        app.launchEnvironment["POLYMUX_DATA_DIR"] = env["POLYMUX_DATA_DIR"]
        app.launchArguments += ["--verify-fixture"]
        if let port = env["POLYMUX_VERIFY_PORT"] {
            app.launchArguments += ["-PolymuxServer", "http://127.0.0.1:\(port)"]
            timed("server.health") {
                var ok = false; let s = DispatchSemaphore(value: 0)
                URLSession.shared.dataTask(with: URL(string: "http://127.0.0.1:\(port)/health")!) { _, r, _ in
                    ok = (r as? HTTPURLResponse)?.statusCode == 200; s.signal() }.resume()
                _ = s.wait(timeout: .now() + 2); return ok
            }
        }
        app.launch()
        timed("foreground") { app.wait(for: .runningForeground, timeout: 1) }
        let any = app.descendants(matching: .any)
        timed("chats.list") { any["chats.list"].exists }
        var observed = Set<String>()
        timed("sidebar.rows.12") {
            let rows = any.matching(NSPredicate(format: "identifier BEGINSWITH 'sidebar.row.' AND NOT identifier CONTAINS '.unread'"))
            observed.formUnion(rows.allElementsBoundByIndex.map(\.identifier))
            if Self.seededIDs.allSatisfy({ observed.contains("sidebar.row.\($0)") }) { return true }
            // List virtualizes offscreen rows; verify every row across its viewports.
            #if os(macOS)
            any["chats.list"].scroll(byDeltaX: 0, deltaY: -400)
            #else
            any["chats.list"].swipeUp()
            #endif
            return false
        }
        XCTAssertEqual(observed.count, Self.seededIDs.count, "sidebar shows \(observed.count) rows, seed has 12")
        // app.status is required: a missing element fails readiness (never silently skipped).
        let status = any["app.status"]
        timed("app.status") { status.exists }
        timed("stream.connected") { (status.value as? String ?? "").contains("connected=1") }
        timed("cache.warm") { (status.value as? String ?? "").contains("cache=warm") }
        var quiet = 0
        timed("no.spinner") {
            let busy = app.activityIndicators.count > 0 ||
                any.matching(NSPredicate(format: "label CONTAINS 'Loading'")).count > 0
            quiet = busy ? 0 : quiet + 1; return quiet >= 2
        }
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "ready"; shot.lifetime = .keepAlways; add(shot)
        #if os(macOS)
        any["chats.list"].scroll(byDeltaX: 0, deltaY: 400)
        #else
        any["chats.list"].swipeDown()
        #endif
        let sidebar = XCTAttachment(screenshot: app.screenshot())
        sidebar.name = "ready-sidebar"; sidebar.lifetime = .keepAlways; add(sidebar)
        let json = XCTAttachment(data: try JSONSerialization.data(withJSONObject: waits, options: [.sortedKeys]),
                                 uniformTypeIdentifier: "public.json")
        // Xcode strips the final extension; keep ready.json for verify.sh's manifest match.
        json.name = "ready.json.json"; json.lifetime = .keepAlways; add(json)
    }
}
