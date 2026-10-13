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

final class ReadinessTests: XCTestCase {
    static let seededIDs = ["t-chief", "t-aria", "t-milo", "t-nova", "t-long", "t-stream", "t-approval",
                            "grp-trip", "t-media", "t-activity", "t-fern", "grp-empty"]
    /// The seeded chats that start unread; each announces "Unread", never a count.
    static let unreadIDs = ["t-aria", "t-milo", "t-nova"]
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
