// Template for apps/Polymux/PolymuxUITests/ReadinessTests.swift (app PR, not infra).
// verify.sh grants UI-verified only when this passes; its screenshots are the proof media.
// Identifiers and waits follow /workspace/polymux-merge/verify-polymux-features.md:
//  - launch argument --verify-fixture (DEBUG seed: 6 agents, 12 sessions), POLYMUX_DATA_DIR per worktree,
//  - list `chats.list`, rows `sidebar.row.<threadID>` (all 12 seeded ids),
//  - optional server health (POLYMUX_VERIFY_PORT), REQUIRED hidden `app.status` value (connected=1, cache=warm),
//  - no activity indicators / "Loading" labels for 2 polls, app running in the foreground.
// Each wait's elapsed ms goes to ready.json (attachment) for ~/verify-evidence/<worktree>/<run-id>/.
import XCTest
import CoreGraphics
import ImageIO
import QuartzCore

final class ReadinessTests: XCTestCase {
    static let seededIDs = ["t-chief", "t-aria", "t-milo", "t-nova", "t-long", "t-stream", "t-approval",
                            "grp-trip", "t-media", "t-activity", "t-fern", "grp-empty"]
    /// The seeded chats that start unread; each announces "Unread", never a count.
    static let unreadIDs = ["t-aria", "t-milo", "t-nova"]
    var waits: [String: Int] = [:]

    func testInlineActivity() {
        for theme in ["light", "dark"] {
            let app = XCUIApplication()
            app.launchEnvironment["POLYMUX_DATA_DIR"] = ProcessInfo.processInfo.environment["POLYMUX_DATA_DIR"]
            app.launchArguments = ["--verify-fixture"] + (theme == "dark" ? ["--verify-dark"] : [])
            app.launch()
            let any = app.descendants(matching: .any)
            timed("activity.sidebar.\(theme)") { any["chats.list"].exists }
            let row = any["sidebar.row.t-activity"]
            timed("activity.visible.\(theme)") {
                if row.exists && row.isHittable { return true }
                #if os(macOS)
                any["chats.list"].scroll(byDeltaX: 0, deltaY: -300)
                #else
                any["chats.list"].swipeUp()
                #endif
                return false
            }
            row.tap()
            let tool = any.matching(NSPredicate(format: "label CONTAINS 'release status'")).firstMatch
            let peers = any.matching(NSPredicate(format: "label CONTAINS '1 message with'")).firstMatch
            let repeats = any.matching(NSPredicate(format: "label CONTAINS 'Searched 3 activities'")).firstMatch
            let memory = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Rollout plan'")).firstMatch
            timed("activity.rows.\(theme)") { tool.exists && peers.exists && repeats.exists && memory.exists }
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = "inline-activity-\(theme)"; shot.lifetime = .keepAlways; add(shot)
            let chat = app.scrollViews.firstMatch
            timed("activity.hittable.\(theme)") {
                guard !memory.isHittable else { return true }
                guard chat.exists else { return false }
                #if os(macOS)
                chat.scroll(byDeltaX: 0, deltaY: -180)
                #else
                chat.swipeUp()
                #endif
                return memory.isHittable
            }
            press(memory)
            timed("activity.object.\(theme)") {
                any.matching(NSPredicate(format: "label CONTAINS 'verify the release before enabling'")).firstMatch.exists
            }
            let object = XCTAttachment(screenshot: app.screenshot())
            object.name = "activity-object-\(theme)"; object.lifetime = .keepAlways; add(object)
            app.terminate()
        }
    }

    #if os(macOS)
    // Release scroll frame timing for PR #39: opens the staged long thread (100 messages and
    // 600 activity events served by .proof/df2-release-scroll/proxy.py), scrolls it, and
    // reports the CADisplayLink log FrameLog writes as median/p95/max frame times plus the
    // share of intervals over 1.5x the measured display period (a missed refresh). Armed
    // only by .proof/df2-release-scroll/measure-release-scroll.sh, which also points the
    // scheme's TestAction at the Release configuration for the armed run and restores it
    // afterwards; verify.sh never sets POLYMUX_RELEASE_SCROLL_PORT, so its runs skip this
    // measurement, and the log header must say [Release] or the test fails.
    func testReleaseScroll() throws {
        guard let port = ProcessInfo.processInfo.environment["POLYMUX_RELEASE_SCROLL_PORT"] else {
            throw XCTSkip("Release scroll measurement is armed only by .proof/df2-release-scroll/measure-release-scroll.sh")
        }
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let proof = root.appendingPathComponent(".proof/df2-release-scroll")
        let frames = proof.appendingPathComponent("frames.log")
        let data = root.appendingPathComponent(".build/release-scroll-data")
        try? FileManager.default.removeItem(at: frames)
        try? FileManager.default.removeItem(at: data)

        let app = XCUIApplication()   // the scheme's target app: Release for the armed run
        app.launchEnvironment["POLYMUX_DATA_DIR"] = data.path
        app.launchArguments = ["-serverAddress", "http://127.0.0.1:\(port)",
                               "--verify-frame-log", frames.path]
        app.launch()
        let any = app.descendants(matching: .any)
        timed("release.list") { any["chats.list"].exists }
        let row = any["sidebar.row.t-long"]
        timed("release.row") {
            if row.exists && row.isHittable { return true }
            any["chats.list"].scroll(byDeltaX: 0, deltaY: -300)
            return false
        }
        row.click()
        let transcript = app.scrollViews.firstMatch
        XCTAssertTrue(transcript.waitForExistence(timeout: 30), "chat transcript is a scroll view")
        let newest = any.matching(NSPredicate(format: "label CONTAINS 'Review release 100 and'")).firstMatch
        timed("release.newest", timeout: 60) {   // normalize to the thread's newest message
            if newest.exists { return true }
            transcript.scroll(byDeltaX: 0, deltaY: -1500)
            return false
        }
        capture(app, theme: "release", state: "before-scroll")
        let before = visibleReleases(any)
        let from = Date()
        for _ in 0..<30 { transcript.scroll(byDeltaX: 0, deltaY: 700) }
        let after = visibleReleases(any)
        XCTAssertFalse(after.isEmpty, "long thread shows release messages while scrolling")
        XCTAssertLessThan(after.min() ?? 101, before.min() ?? 101,
                          "scrolling up reached older releases (\(before.min() ?? -1) -> \(after.min() ?? -1))")
        capture(app, theme: "release", state: "mid-scroll")
        for _ in 0..<30 { transcript.scroll(byDeltaX: 0, deltaY: -700) }
        let until = Date()
        capture(app, theme: "release", state: "after-scroll")
        RunLoop.current.run(until: Date().addingTimeInterval(1))   // let FrameLog flush the tail
        app.terminate()

        let text = (try? String(contentsOf: frames, encoding: .utf8)) ?? ""
        XCTAssertTrue(text.contains("[Release]"), "measurement must come from a Release build")
        var samples: [(at: Double, ms: Double)] = []
        for line in text.split(separator: "\n") where !line.hasPrefix("#") {
            let parts = line.split(separator: " ")
            if parts.count == 2, let at = Double(parts[0]), let ms = Double(parts[1]) { samples.append((at, ms)) }
        }
        let window = samples.filter { $0.at >= from.timeIntervalSince1970 && $0.at <= until.timeIntervalSince1970 }
            .map(\.ms).sorted()
        XCTAssertGreaterThan(window.count, 120,
                             "frame log holds \(window.count) samples in the scroll window (\(samples.count) in the run)")
        guard window.count > 120 else { return }
        func percentile(_ p: Double) -> Double { window[Int(Double(window.count - 1) * p)] }
        let refresh = percentile(0.10)
        let hitches = window.filter { $0 > refresh * 1.5 }.count
        let stats: [String: Any] = [
            "configuration": "Release",
            "os": ProcessInfo.processInfo.operatingSystemVersionString,
            "messages": 100, "activityEvents": 600, "scrollSteps": 60,
            "samples": window.count, "releaseMin": after.min() ?? -1,
            "refreshMs": refresh, "hitchThresholdMs": refresh * 1.5,
            "medianMs": percentile(0.50), "p95Ms": percentile(0.95), "maxMs": window.last ?? 0,
            "hitches": hitches, "hitchRate": Double(hitches) / Double(window.count)]
        if let json = try? JSONSerialization.data(withJSONObject: stats, options: [.sortedKeys, .prettyPrinted]) {
            try? json.write(to: proof.appendingPathComponent("scroll-stats.json"))
            let report = XCTAttachment(data: json, uniformTypeIdentifier: "public.json")
            report.name = "scroll-stats.json"; report.lifetime = .keepAlways; add(report)
        }
        let log = XCTAttachment(data: Data(text.utf8), uniformTypeIdentifier: "public.plain-text")
        log.name = "frames.log"; log.lifetime = .keepAlways; add(log)
        print("release scroll: \(window.count) frames, median \(percentile(0.50)) ms, p95 \(percentile(0.95)) ms, " +
              "max \(window.last ?? 0) ms, hitch rate \(hitches)/\(window.count) (threshold \(refresh * 1.5) ms)")
    }

    private func visibleReleases(_ any: XCUIElementQuery) -> [Int] {
        any.matching(NSPredicate(format: "label CONTAINS 'Review release '")).allElementsBoundByIndex.compactMap {
            guard let range = $0.label.range(of: "Review release ") else { return nil }
            return Int($0.label[range.upperBound...].prefix { $0.isNumber })
        }
    }
    #endif

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testToolRows() {
        for theme in ["light", "dark"] {
            let app = XCUIApplication()
            app.launchEnvironment["POLYMUX_DATA_DIR"] = ProcessInfo.processInfo.environment["POLYMUX_DATA_DIR"]
            app.launchArguments = ["--verify-fixture", "--verify-tools"] + (theme == "dark" ? ["--tools-dark"] : [])
            for replay in [false, true] {
                app.launch()
                #if os(macOS)
                app.activate()
                #endif
                let chief = app.descendants(matching: .any)["sidebar.row.t-chief"].firstMatch
                XCTAssertTrue(chief.waitForExistence(timeout: 10))
                press(chief)
                let bash = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Ran go test ./...'")).firstMatch
                XCTAssertTrue(bash.waitForExistence(timeout: 10))
                XCTAssertTrue(app.staticTexts["Second reply from the same turn."].waitForExistence(timeout: 10))
                XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Ran go test ./...'")).count, 1,
                               "Tool rows must draw once for a turn with two replies")
                XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Read 3 files'")).firstMatch.exists)
                XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Edited ChatPane.swift'")).firstMatch.exists)
                XCTAssertFalse(app.staticTexts["go test ./...\nok polymux 0.2s"].exists)
                capture(app, theme: theme, state: "tools-\(replay ? "replay" : "before")")
                press(bash)
                XCTAssertTrue(app.staticTexts["go test ./...\nok polymux 0.2s"].waitForExistence(timeout: 2))
                let failed = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Ran false'")).firstMatch
                press(failed)
                XCTAssertTrue(app.staticTexts["false\nCommand exited with status 1\n[redacted]"].waitForExistence(timeout: 2))
                capture(app, theme: theme, state: "tools-after-\(replay)")
                app.terminate()
            }
        }
    }

    func testApprovalStates() {
        for theme in ["light", "dark"] {
            let app = XCUIApplication()
            app.launchArguments = ["--verify-approval"] + (theme == "dark" ? ["--approval-dark"] : [])
            app.launch()
            #if os(macOS)
            app.activate()
            XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10), "Approval launch opens a window")
            #endif
            capture(app, theme: theme, state: "launch")
            let option = app.buttons["A. Plan my day"]
            XCTAssertTrue(option.waitForExistence(timeout: 10))
            XCTAssertEqual(app.buttons["Fail answer"].value as? String, theme)
            capture(app, theme: theme, state: "unanswered")
            press(option)
            XCTAssertTrue(app.staticTexts["Plan my day"].waitForExistence(timeout: 2))
            XCTAssertFalse(option.exists)
            capture(app, theme: theme, state: "optimistic")
            press(app.buttons["Fail answer"])
            XCTAssertTrue(app.staticTexts["Couldn’t record that choice."].waitForExistence(timeout: 10))
            XCTAssertTrue(option.exists)
            capture(app, theme: theme, state: "rollback")
            app.terminate()
        }
    }

    private func press(_ element: XCUIElement) {
        #if os(macOS)
        element.click()
        #else
        element.tap()
        #endif
    }

    private func capture(_ app: XCUIApplication, theme: String, state: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "focus-\(theme)-\(state)"
        shot.lifetime = .keepAlways
        add(shot)
    }

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
            // /health sits behind device auth since P0-208; probe it with the owner token the app uses.
            let token = localToken()
            timed("server.health") {
                var ok = false; let s = DispatchSemaphore(value: 0)
                var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/health")!)
                if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
                URLSession.shared.dataTask(with: request) { _, r, _ in
                    ok = (r as? HTTPURLResponse)?.statusCode == 200; s.signal() }.resume()
                _ = s.wait(timeout: .now() + 2); return ok
            }
        }
        app.launch()
        #if os(macOS)
        // A GUI-session launch can leave the test runner in front.
        app.activate()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10), "Sidebar launch opens a window")
        #endif
        timed("foreground") { app.wait(for: .runningForeground, timeout: 1) }
        capture(app, theme: "system", state: "sidebar-launch")
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
        // Unread rows announce their state without a count; collect the announcement across viewports.
        var announced = Set<String>()
        timed("unread.rows") {
            let rows = any.matching(NSPredicate(format: "identifier BEGINSWITH 'sidebar.row.'"))
            announced.formUnion(rows.allElementsBoundByIndex.filter(announces).map(\.identifier))
            if Self.unreadIDs.allSatisfy({ announced.contains("sidebar.row.\($0)") }) { return true }
            #if os(macOS)
            // The window can extend past the screen; never scroll a list without a hit point.
            if any["chats.list"].isHittable { any["chats.list"].scroll(byDeltaX: 0, deltaY: -400) }
            #else
            any["chats.list"].swipeUp()
            #endif
            return false
        }
        let sidebar = XCTAttachment(screenshot: app.screenshot())
        sidebar.name = "ready-sidebar"; sidebar.lifetime = .keepAlways; add(sidebar)
        let json = XCTAttachment(data: try JSONSerialization.data(withJSONObject: waits, options: [.sortedKeys]),
                                 uniformTypeIdentifier: "public.json")
        // Xcode strips the final extension; keep ready.json for verify.sh's manifest match.
        json.name = "ready.json.json"; json.lifetime = .keepAlways; add(json)
        if env["POLYMUX_VERIFY_PORT"] == nil {
            capture("light", app: app)
            capture("dark", app: app)
        }
    }

    func announces(_ row: XCUIElement) -> Bool {
        #if os(macOS)
        return row.label.components(separatedBy: ", ").contains("Unread")
        #else
        let value = row.value as? String ?? ""
        return value == "Unread" || value.hasPrefix("Unread, ")
        #endif
    }

    func capture(_ mode: String, app: XCUIApplication) {
        app.terminate()
        app.launchEnvironment["POLYMUX_VERIFY_APPEARANCE"] = mode
        app.launch()
        let any = app.descendants(matching: .any)
        timed("appearance.\(mode)", timeout: 20) {
            any["chats.list"].exists && rendered(app, dark: mode == "dark")
        }
        timed("unread.\(mode)") {
            let row = any["sidebar.row.t-aria"]
            return row.exists && announces(row)
        }
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "unread-\(mode)"; shot.lifetime = .keepAlways; add(shot)
    }

    // Check the rendered theme before retaining its screenshot.
    func rendered(_ app: XCUIApplication, dark: Bool) -> Bool {
        guard let value = luminance(app) else { return false }
        return dark ? value < 0.5 : value > 0.5
    }

    // The host owner token is unavailable on iOS.
    func localToken() -> String? {
        #if os(macOS)
        guard let dir = ProcessInfo.processInfo.environment["POLYMUX_DATA_DIR"] else { return nil }
        return try? String(contentsOfFile: dir + "/devices/local-token", encoding: .utf8)
        #else
        return nil
        #endif
    }

    func luminance(_ app: XCUIApplication) -> Double? {
        guard let source = CGImageSourceCreateWithData(app.screenshot().pngRepresentation as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
        let side = 8
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        guard let context = CGContext(data: &pixels, width: side, height: side, bitsPerComponent: 8,
                                      bytesPerRow: side * 4, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
        var total = 0.0
        for i in stride(from: 0, to: pixels.count, by: 4) {
            total += 0.2126 * Double(pixels[i]) + 0.7152 * Double(pixels[i + 1]) + 0.0722 * Double(pixels[i + 2])
        }
        return total / Double(side * side * 255)
    }
}
