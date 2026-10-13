import UIKit
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

        assertChrome(app, nav: nav, fade: fade, name: name)
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
        assertChrome(app, nav: nav, fade: fade, name: name)
        attach(name: "chats-header-\(name)-after")

        app.buttons["Search agents"].tap()
        XCTAssertTrue(app.textFields["Search agents"].waitForExistence(timeout: 3))
        XCTAssertTrue(fade.exists)
        XCTAssertFalse(fade.isHittable)
        assertAlpha(fade)
        assertHairline(XCUIScreen.main.screenshot().image, nav: nav)
        XCTAssertTrue(app.buttons["Close search"].isHittable)
        attach(name: "chats-header-\(name)-search")
        app.buttons["Close search"].tap()
    }

    private func assertChrome(_ app: XCUIApplication, nav: XCUIElement, fade: XCUIElement, name: String) {
        XCTAssertTrue(nav.exists)
        XCTAssertTrue(fade.exists)
        XCTAssertFalse(fade.isHittable, "the header fade should not take taps")
        assertAlpha(fade)
        let inline = nav.staticTexts["Chats"]
        let title = inline.exists ? inline : app.staticTexts["Chats"]
        XCTAssertTrue(title.waitForExistence(timeout: 2), "the Chats title should be on screen")
        let shot = XCUIScreen.main.screenshot().image
        assertHairline(shot, nav: nav)
        assertContrast(shot, title: title.frame, name: name)
        XCTAssertLessThanOrEqual(fade.frame.minY, nav.frame.minY + 1, "the fade should cover the navigation bar")
        let below = fade.frame.maxY - nav.frame.maxY
        XCTAssertEqual(below, 28, accuracy: 4, "the fade should end about 28pt below the header, was \(below)")
        XCTAssertTrue(app.buttons["Settings"].isHittable)
        XCTAssertTrue(app.buttons["Filter conversations"].isHittable)
    }

    /// Alphas are read from the bar's background views, not a fixed string.
    private func assertAlpha(_ fade: XCUIElement) {
        let raw = fade.value as? String ?? ""
        XCTAssertNotEqual(raw, "none", "expected navigation background views to inspect")
        let alphas = Self.parsedAlphas(raw)
        XCTAssertFalse(alphas.isEmpty, "expected measured navigation bar background alphas, got \(raw)")
        for alpha in alphas {
            XCTAssertLessThanOrEqual(alpha, 0, "navigation bar background alpha \(alpha)")
        }
    }

    /// A hairline is a luminance step at the bar's bottom edge. 2% of the 0...1 range.
    private func assertHairline(_ image: UIImage, nav: XCUIElement) {
        guard let bitmap = Bitmap(image) else {
            XCTFail("could not read the screenshot")
            return
        }
        guard let top = bitmap.row(nav.frame.maxY), let below = bitmap.row(nav.frame.maxY + 2),
              let x0 = bitmap.column(nav.frame.minX), let x1 = bitmap.column(nav.frame.maxX) else {
            XCTFail("the navigation bar edge is outside the screenshot")
            return
        }
        guard top != below else {
            XCTFail("the hairline rows must be two points apart")
            return
        }
        guard x1 > x0 else {
            XCTFail("the navigation bar has no width to sample")
            return
        }
        var deltas: [Double] = []
        deltas.reserveCapacity(x1 - x0)
        for x in x0..<x1 {
            guard let left = bitmap.luminance(x: x, y: top), let right = bitmap.luminance(x: x, y: below) else {
                XCTFail("hairline sample fell outside the screenshot")
                return
            }
            deltas.append(abs(left - right))
        }
        let delta = median(deltas)
        XCTAssertLessThan(delta, 0.02, String(format: "hairline luminance delta %.2f%% at the navigation bar edge", delta * 100))
    }

    private func assertContrast(_ image: UIImage, title: CGRect, name: String) {
        guard let bitmap = Bitmap(image) else {
            XCTFail("could not read the screenshot")
            return
        }
        guard let x0 = bitmap.column(title.minX), let x1 = bitmap.column(title.maxX),
              let y0 = bitmap.row(title.minY), let y1 = bitmap.row(title.maxY), x1 > x0, y1 > y0 else {
            XCTFail("the Chats title is outside the screenshot")
            return
        }
        var values: [Double] = []
        values.reserveCapacity((x1 - x0) * (y1 - y0))
        for y in y0..<y1 {
            for x in x0..<x1 {
                if let sample = bitmap.luminance(x: x, y: y) { values.append(sample) }
            }
        }
        XCTAssertGreaterThanOrEqual(values.count, 32, "the Chats title did not cover enough pixels")
        let background = dominantLuminance(values)
        let peak = values.map { abs($0 - background) }.max() ?? 0
        let cores = values.filter { abs($0 - background) >= max(peak * 0.65, 0.02) }
        XCTAssertGreaterThanOrEqual(cores.count, 8, "could not separate the \(name) title from the gradient behind it")
        let foreground = median(cores)
        let lighter = max(background, foreground)
        let darker = min(background, foreground)
        let ratio = (lighter + 0.05) / (darker + 0.05)
        XCTAssertGreaterThanOrEqual(ratio, 4.5, String(format: "%@ title contrast %.2f:1 is below 4.5:1", name, ratio))
    }

    /// The flat gradient fills most of the title rect, so its luminance bin is the background.
    private func dominantLuminance(_ values: [Double]) -> Double {
        var bins = [Int](repeating: 0, count: 32)
        for value in values { bins[min(31, Int(value * 32))] += 1 }
        let bin = bins.enumerated().max(by: { $0.element < $1.element })?.offset ?? 0
        let members = values.filter { min(31, Int($0 * 32)) == bin }
        guard !members.isEmpty else { return 0 }
        return median(members)
    }

    private func waitUntilFadeSettles(_ fade: XCUIElement, below nav: XCUIElement) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard fade.exists, fade.frame.height > 40, fade.frame.maxY > nav.frame.maxY + 20 else { return false }
            return Self.alphaReady(fade.value as? String)
        }, object: nil)
        wait(for: [expectation], timeout: 6)
    }

    private static func alphaReady(_ raw: String?) -> Bool {
        guard let raw, !raw.isEmpty else { return false }
        if raw == "none" { return false }
        return !parsedAlphas(raw).isEmpty
    }

    private static func parsedAlphas(_ raw: String) -> [Double] {
        raw.split(separator: ",").compactMap { part in
            let scanner = Scanner(string: String(part))
            scanner.locale = Locale(identifier: "en_US_POSIX")
            guard let value = scanner.scanDouble(), scanner.isAtEnd else { return nil }
            return value
        }
    }

    private func median(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        let sorted = values.sorted()
        let mid = sorted.count / 2
        if sorted.count.isMultiple(of: 2) { return (sorted[mid - 1] + sorted[mid]) / 2 }
        return sorted[mid]
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
        func match(_ query: XCUIElementQuery) -> XCUIElement {
            query.matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch
        }
        let cell = match(app.cells)
        if cell.exists { return cell }
        let button = match(app.buttons)
        if button.exists { return button }
        return match(app.descendants(matching: .any))
    }

    private func attach(name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

/// Screenshot pixels with the top row at y = 0, matching XCUIElement frames.
private struct Bitmap {
    let pixels: [UInt8]
    let width: Int
    let height: Int
    let size: CGSize

    init?(_ image: UIImage) {
        guard let source = image.cgImage, image.size.width > 0, image.size.height > 0 else { return nil }
        let width = source.width
        let height = source.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drew = pixels.withUnsafeMutableBytes { raw -> Bool in
            guard let context = CGContext(
                data: raw.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            context.translateBy(x: 0, y: CGFloat(height))
            context.scaleBy(x: 1, y: -1)
            context.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drew else { return nil }
        self.pixels = pixels
        self.width = width
        self.height = height
        size = image.size
    }

    func column(_ point: CGFloat) -> Int? {
        index(point, extent: size.width, pixels: width)
    }

    func row(_ point: CGFloat) -> Int? {
        index(point, extent: size.height, pixels: height)
    }

    func luminance(x: Int, y: Int) -> Double? {
        guard x >= 0, y >= 0, x < width, y < height else { return nil }
        let offset = (y * width + x) * 4
        let alpha = pixels[offset + 3]
        let scale = alpha == 0 ? 0 : 255.0 / Double(alpha)
        let red = min(255, Double(pixels[offset]) * scale)
        let green = min(255, Double(pixels[offset + 1]) * scale)
        let blue = min(255, Double(pixels[offset + 2]) * scale)
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }

    private func index(_ point: CGFloat, extent: CGFloat, pixels: Int) -> Int? {
        let value = Int((point * CGFloat(pixels) / extent).rounded())
        guard value >= 0, value < pixels else { return nil }
        return value
    }

    private func linear(_ channel: Double) -> Double {
        let value = channel / 255
        if value <= 0.04045 { return value / 12.92 }
        return pow((value + 0.055) / 1.055, 2.4)
    }
}
