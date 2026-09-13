// Exact-window capture and accessibility backend for Control on macOS.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ScreenCaptureKit

enum ControllerError: Error {
    case message(String, Int32)
}

struct Options {
    let command: String
    let pid: pid_t
    let windowID: CGWindowID?
    let output: String?
    let matchAttribute: String?
    let matchValue: String?
    let newValue: String?
    let expectedValue: String?
}

func fail(_ status: String, code: Int32 = 2, details: [String: Any] = [:]) -> Never {
    var result = details
    result["status"] = status
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    exit(code)
}

func optionValues() -> [String: String] {
    var values: [String: String] = [:]
    var index = 2
    while index < CommandLine.arguments.count {
        let key = CommandLine.arguments[index]
        guard key.hasPrefix("--"), index + 1 < CommandLine.arguments.count else {
            fail("blocked_usage")
        }
        values[String(key.dropFirst(2))] = CommandLine.arguments[index + 1]
        index += 2
    }
    return values
}

func validateIdentity() {
    let values = optionValues()
    guard let lockWindowID = values["lock-window-id"],
          let nativeValue = values["native-window-id"],
          let nativeWindowID = UInt32(nativeValue) else {
        fail("blocked_usage")
    }
    guard lockWindowID == String(nativeWindowID) else {
        fail("blocked_lock_window_mismatch", code: 3)
    }
    printJSON(["status": "valid"])
}

func printAppIdentity() {
    let values = optionValues()
    guard let pidString = values["pid"], let pid = Int32(pidString),
          let application = NSRunningApplication(processIdentifier: pid) else {
        fail("blocked_app_identity_unavailable", code: 3)
    }
    let appID = application.bundleIdentifier ?? application.executableURL?.path ?? ""
    guard !appID.isEmpty else { fail("blocked_app_identity_unavailable", code: 3) }
    printJSON(["status": "identified", "app_id": appID])
}

func parseOptions() -> Options {
    guard CommandLine.arguments.count >= 2 else { fail("blocked_usage") }
    let command = CommandLine.arguments[1]
    let values = optionValues()
    guard ["list", "capture", "inspect", "tabs", "press", "set-value"].contains(command),
          let pidString = values["pid"], let parsedPID = Int32(pidString) else {
        fail("blocked_usage")
    }
    let parsedID = values["window-id"].flatMap(UInt32.init)
    if command != "list" && parsedID == nil { fail("blocked_usage") }
    if command == "capture" && values["output"] == nil { fail("blocked_usage") }
    if ["press", "set-value"].contains(command) &&
        (values["match-attribute"] == nil || values["match-value"] == nil) {
        fail("blocked_usage")
    }
    if command == "set-value" && values["new-value"] == nil { fail("blocked_usage") }
    return Options(
        command: command,
        pid: parsedPID,
        windowID: parsedID,
        output: values["output"],
        matchAttribute: values["match-attribute"],
        matchValue: values["match-value"],
        newValue: values["new-value"],
        expectedValue: values["expected-value"]
    )
}

func cgWindowRow(pid: pid_t, windowID: CGWindowID) -> [String: Any] {
    guard let rows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]],
          let row = rows.first(where: {
              ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid &&
              ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == windowID &&
              ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
          }) else {
        fail("blocked_exact_window_missing", code: 3)
    }
    return row
}

func listWindows(pid: pid_t) -> [String: Any] {
    guard let rows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else {
        fail("blocked_window_list_unavailable", code: 3)
    }
    let windows = rows.compactMap { row -> [String: Any]? in
        guard (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              (row[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let id = (row[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
              let dictionary = row[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: dictionary),
              bounds.width >= 80, bounds.height >= 60 else { return nil }
        return [
            "window_id": id,
            "title": row[kCGWindowName as String] as? String ?? "",
            "onscreen": (row[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue ?? false,
            "x": bounds.origin.x,
            "y": bounds.origin.y,
            "width": bounds.width,
            "height": bounds.height
        ]
    }
    return ["status": "listed", "pid": pid, "windows": windows]
}

func cgBounds(_ row: [String: Any]) -> CGRect {
    guard let dictionary = row[kCGWindowBounds as String] as? NSDictionary,
          let bounds = CGRect(dictionaryRepresentation: dictionary) else {
        fail("blocked_window_bounds_unavailable", code: 3)
    }
    return bounds
}

func axAttribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name, &value) == .success ? value : nil
}

func axString(_ element: AXUIElement, _ name: CFString) -> String {
    axAttribute(element, name) as? String ?? ""
}

func axPoint(_ element: AXUIElement) -> CGPoint? {
    guard let raw = axAttribute(element, kAXPositionAttribute as CFString),
          CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    return AXValueGetValue(raw as! AXValue, .cgPoint, &point) ? point : nil
}

func axSize(_ element: AXUIElement) -> CGSize? {
    guard let raw = axAttribute(element, kAXSizeAttribute as CFString),
          CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
    var size = CGSize.zero
    return AXValueGetValue(raw as! AXValue, .cgSize, &size) ? size : nil
}

func closeEnough(_ lhs: CGFloat, _ rhs: CGFloat) -> Bool { abs(lhs - rhs) < 1.1 }

func uniqueAXElements(_ elements: [AXUIElement]) -> [AXUIElement] {
    var unique: [AXUIElement] = []
    for element in elements where !unique.contains(where: { CFEqual($0, element) }) {
        unique.append(element)
    }
    return unique
}

func ownedAXWindows(_ app: AXUIElement) -> [AXUIElement] {
    // Gecko lazily exposes its accessibility tree after a standard app-role
    // read (Mozilla bug 1845364). Do not set accessibility flags or focus it.
    _ = axAttribute(app, kAXRoleAttribute as CFString)
    var pending = (axAttribute(app, kAXWindowsAttribute as CFString) as? [AXUIElement] ?? [])
    for name in [kAXMainWindowAttribute, kAXFocusedWindowAttribute] {
        if let value = axAttribute(app, name as CFString), CFGetTypeID(value) == AXUIElementGetTypeID() {
            pending.append(value as! AXUIElement)
        }
    }
    pending += axChildren(app).filter {
        ["AXWindow", "AXDialog", "AXSheet"].contains(axString($0, kAXRoleAttribute as CFString))
    }
    var result: [AXUIElement] = []
    while !pending.isEmpty && result.count < 256 {
        let element = pending.removeFirst()
        if result.contains(where: { CFEqual($0, element) }) { continue }
        result.append(element)
        pending += axAttribute(element, "AXSheets" as CFString) as? [AXUIElement] ?? []
        pending += axChildren(element).filter {
            ["AXWindow", "AXDialog", "AXSheet"].contains(axString($0, kAXRoleAttribute as CFString))
        }
    }
    return result
}

func exactAXWindow(pid: pid_t, cgRow: [String: Any]) -> AXUIElement {
    guard AXIsProcessTrusted() else { fail("blocked_accessibility_not_trusted", code: 4) }
    let app = AXUIElementCreateApplication(pid)
    let uniqueWindows = uniqueAXElements(ownedAXWindows(app))
    guard !uniqueWindows.isEmpty else {
        var windowsValue: CFTypeRef?
        let windowsError = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsValue)
        var roleValue: CFTypeRef?
        let roleError = AXUIElementCopyAttributeValue(app, kAXRoleAttribute as CFString, &roleValue)
        fail("blocked_accessibility_windows_unavailable", code: 4, details: [
            "windows_error": windowsError.rawValue, "role_error": roleError.rawValue,
            "application_role": roleValue as? String ?? "",
            "application_hidden": axAttribute(app, kAXHiddenAttribute as CFString) as? Bool ?? false
        ])
    }
    let bounds = cgBounds(cgRow)
    let cgTitle = cgRow[kCGWindowName as String] as? String ?? ""
    var matches = uniqueWindows.filter { window in
        guard let point = axPoint(window), let size = axSize(window) else { return false }
        return closeEnough(point.x, bounds.origin.x) && closeEnough(point.y, bounds.origin.y) &&
            closeEnough(size.width, bounds.width) && closeEnough(size.height, bounds.height)
    }
    if matches.count > 1 && !cgTitle.isEmpty {
        matches = matches.filter { axString($0, kAXTitleAttribute as CFString) == cgTitle }
    }
    if matches.isEmpty && !cgTitle.isEmpty {
        let titleMatches = uniqueWindows.filter {
            let role = axString($0, kAXRoleAttribute as CFString)
            return ["AXWindow", "AXDialog", "AXSheet"].contains(role) &&
                axString($0, kAXTitleAttribute as CFString) == cgTitle
        }
        if titleMatches.count == 1 {
            return titleMatches[0]
        }
        if titleMatches.count > 1 {
            fail(
                "blocked_accessibility_window_ambiguous",
                code: 4,
                details: ["matches": titleMatches.count]
            )
        }
    }
    guard matches.count == 1, let window = matches.first else {
        fail(
            matches.isEmpty ? "blocked_accessibility_window_missing" : "blocked_accessibility_window_ambiguous",
            code: 4,
            details: ["matches": matches.count]
        )
    }
    return window
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    axAttribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] ?? []
}

func walk(_ element: AXUIElement, depth: Int = 0) -> [AXUIElement] {
    guard depth < 24 else { return [] }
    return [element] + axChildren(element).flatMap { walk($0, depth: depth + 1) }
}

func matchValue(_ element: AXUIElement, attribute: String) -> String {
    switch attribute {
    case "role": return axString(element, kAXRoleAttribute as CFString)
    case "title": return axString(element, kAXTitleAttribute as CFString)
    case "description": return axString(element, kAXDescriptionAttribute as CFString)
    case "identifier": return axString(element, "AXIdentifier" as CFString)
    default: fail("blocked_match_attribute_invalid")
    }
}

func exactElement(window: AXUIElement, attribute: String, value: String) -> AXUIElement {
    let matches = uniqueAXElements(walk(window)).filter { matchValue($0, attribute: attribute) == value }
    guard matches.count == 1, let element = matches.first else {
        fail(
            matches.isEmpty ? "blocked_control_missing" : "blocked_control_ambiguous",
            code: 5,
            details: ["matches": matches.count]
        )
    }
    return element
}

func frontmostPID() -> pid_t? { NSWorkspace.shared.frontmostApplication?.processIdentifier }

func ensureNoActivation(pid: pid_t, before: pid_t?) {
    let after = frontmostPID()
    if before != pid && after == pid {
        fail("blocked_target_became_frontmost", code: 8)
    }
}

func capture(pid: pid_t, windowID: CGWindowID, output: String) async -> [String: Any] {
    guard #available(macOS 14.0, *) else {
        fail("blocked_capture_requires_macos_14", code: 6)
    }
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let target = content.windows.first(where: {
            $0.windowID == windowID && $0.owningApplication?.processID == pid
        }) else { fail("blocked_capture_window_missing", code: 6) }
        let filter = SCContentFilter(desktopIndependentWindow: target)
        let config = SCStreamConfiguration()
        config.width = max(1, Int(target.frame.width * 2))
        config.height = max(1, Int(target.frame.height * 2))
        config.showsCursor = false
        config.ignoreShadowsSingleWindow = true
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        let representation = NSBitmapImageRep(cgImage: image)
        guard let data = representation.representation(using: .png, properties: [:]) else {
            fail("blocked_capture_encoding_failed", code: 6)
        }
        try data.write(to: URL(fileURLWithPath: output), options: .atomic)
        return ["status": "captured", "output": output, "width": image.width, "height": image.height]
    } catch {
        fail("blocked_capture_failed", code: 6, details: ["error": String(describing: error)])
    }
}

// Read tab-strip metadata, pruning webpage content and keeping native selection.
func browserTabs(_ window: AXUIElement, windowID: CGWindowID) -> [String: Any] {
    var pending: [(AXUIElement, Bool, Int)] = [(window, false, 0)]
    var seen: [AXUIElement] = []
    var tabs: [[String: Any]] = []
    var pageURLs: [String] = []
    var truncated = false
    func url(_ element: AXUIElement) -> String? {
        guard let raw = axAttribute(element, kAXURLAttribute as CFString) else { return nil }
        let text = (raw as? URL)?.absoluteString ?? (raw as? String) ?? ""
        return text.isEmpty ? nil : text
    }
    while !pending.isEmpty && seen.count < 1000 {
        let (element, inTabs, depth) = pending.removeLast()
        if seen.contains(where: { CFEqual($0, element) }) { continue }
        seen.append(element)
        let role = axString(element, kAXRoleAttribute as CFString)
        if role == "AXWebArea" {
            if let address = url(element) { pageURLs.append(address) }
            continue
        }
        let tabGroup = inTabs || role == "AXTabGroup"
        if inTabs && ["AXRadioButton", "AXTab"].contains(role) {
            let selected = (axAttribute(element, kAXSelectedAttribute as CFString) as? NSNumber)?.boolValue
                ?? (axAttribute(element, kAXValueAttribute as CFString) as? NSNumber)?.boolValue
            var row: [String: Any] = ["title": axString(element, kAXTitleAttribute as CFString),
                                      "selected": selected as Any? ?? NSNull(), "url_status": "unavailable"]
            if let address = url(element) { row["url"] = address; row["url_status"] = "available" }
            tabs.append(row)
            continue
        }
        if depth >= 24 { truncated = true; continue }
        for child in axChildren(element).reversed() {
            if pending.count >= 1000 { truncated = true; break }
            pending.append((child, tabGroup, depth + 1))
        }
    }
    if !pending.isEmpty { truncated = true }
    let selected = tabs.indices.filter { tabs[$0]["selected"] as? Bool == true }
    if selected.count == 1 && pageURLs.count == 1 && tabs[selected[0]]["url"] == nil {
        tabs[selected[0]]["url"] = pageURLs[0]
        tabs[selected[0]]["url_status"] = "available"
    }
    return ["status": "inventoried", "window_id": String(windowID), "tabs": tabs,
            "reason": truncated ? "Accessibility traversal limit reached" : "Accessible tab-strip metadata only; hidden tabs and background URLs may be unavailable"]
}

func printJSON(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}

@main
struct Main {
    static func main() async {
        if CommandLine.arguments.dropFirst().first == "validate-identity" {
            validateIdentity()
            return
        }
        if CommandLine.arguments.dropFirst().first == "app-identity" {
            printAppIdentity()
            return
        }
        let options = parseOptions()
        let before = frontmostPID()
        if options.command == "list" {
            let result = listWindows(pid: options.pid)
            ensureNoActivation(pid: options.pid, before: before)
            printJSON(result)
            return
        }
        let windowID = options.windowID!
        let row = cgWindowRow(pid: options.pid, windowID: windowID)

        if options.command == "capture" {
            let result = await capture(pid: options.pid, windowID: windowID, output: options.output!)
            ensureNoActivation(pid: options.pid, before: before)
            printJSON(result)
            return
        }

        let window = exactAXWindow(pid: options.pid, cgRow: row)
        if options.command == "tabs" {
            let result = browserTabs(window, windowID: windowID)
            ensureNoActivation(pid: options.pid, before: before)
            printJSON(result)
            return
        }
        if options.command == "inspect" {
            let controls = uniqueAXElements(walk(window)).prefix(500).map { element -> [String: Any] in
                var actionNames: CFArray?
                AXUIElementCopyActionNames(element, &actionNames)
                var row: [String: Any] = [
                    "role": axString(element, kAXRoleAttribute as CFString),
                    "title": axString(element, kAXTitleAttribute as CFString),
                    "description": axString(element, kAXDescriptionAttribute as CFString),
                    "value": axString(element, kAXValueAttribute as CFString),
                    "identifier": axString(element, "AXIdentifier" as CFString),
                    "actions": actionNames as? [String] ?? []
                ]
                // Screen frame of the control, so a caller can show the user
                // where an action is about to happen. Reading it costs two AX
                // round trips per control and never activates the app.
                if let origin = axPoint(element), let size = axSize(element) {
                    row["frame"] = [
                        "x": origin.x,
                        "y": origin.y,
                        "width": size.width,
                        "height": size.height
                    ]
                }
                return row
            }.filter { row in
                row.contains { key, value in key != "actions" && key != "frame" && String(describing: value) != "" }
            }
            ensureNoActivation(pid: options.pid, before: before)
            printJSON(["status": "inspected", "window_id": windowID, "controls": controls])
            return
        }

        let element = exactElement(
            window: window,
            attribute: options.matchAttribute!,
            value: options.matchValue!
        )
        if let expected = options.expectedValue, axString(element, kAXValueAttribute as CFString) != expected {
            fail("conflict", code: 9, details: ["reason": "control_value_changed", "action_performed": false])
        }
        if options.command == "set-value" && options.expectedValue == nil { fail("blocked_usage") }
        if options.command == "press" {
            let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
            guard result == .success else {
                fail("blocked_action_failed", code: 7, details: ["ax_error": result.rawValue])
            }
            printJSON(["status": "pressed", "window_id": windowID, "foreground_changed": frontmostPID() != before])
            return
        }

        let result = AXUIElementSetAttributeValue(
            element,
            kAXValueAttribute as CFString,
            options.newValue! as CFTypeRef
        )
        guard result == .success else {
            fail("blocked_action_failed", code: 7, details: ["ax_error": result.rawValue])
        }
        guard axString(element, kAXValueAttribute as CFString) == options.newValue! else {
            fail("blocked_value_verification_failed", code: 7)
        }
        printJSON(["status": "value_set", "window_id": windowID, "foreground_changed": frontmostPID() != before])
    }
}
