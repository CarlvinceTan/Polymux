// Reconnect WeChat's background-send signal chain without activating WeChat.
//
// WeChat 4 rebuilds its chat InputView after a restart, page change, or a long
// idle. The local daemon cannot emit through that Qt signal chain until one
// chat row has been selected. This helper performs exactly that semantic
// accessibility action while another application remains frontmost.

import AppKit
import ApplicationServices
import Darwin
import Foundation

func emit(_ payload: [String: Any]) -> Never {
    let data = try? JSONSerialization.data(withJSONObject: payload)
    print(data.flatMap { String(data: $0, encoding: .utf8) } ?? "{\"ok\":false}")
    exit(0)
}

func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name, &value) == .success ? value : nil
}

func stringAttribute(_ element: AXUIElement, _ name: CFString) -> String {
    attribute(element, name) as? String ?? ""
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] ?? []
}

func attributeNames(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyAttributeNames(element, &names) == .success else {
        return []
    }
    return names as? [String] ?? []
}

func descendants(_ element: AXUIElement, depth: Int = 0) -> [AXUIElement] {
    if depth > 20 { return [] }
    return children(element).flatMap { [$0] + descendants($0, depth: depth + 1) }
}

/** Selects a chat semantically through Accessibility. AXPress opens a detached
 * chat in WeChat 4, while synthetic pointer events can interfere with another
 * foreground app, so neither is appropriate for background recovery. */
func selectRow(_ element: AXUIElement) -> Bool {
    guard attributeNames(element).contains(kAXSelectedAttribute) else {
        return false
    }
    return AXUIElementSetAttributeValue(
        element,
        kAXSelectedAttribute as CFString,
        kCFBooleanTrue
    ) == .success
}

let bundleID = "com.tencent.xinWeChat"
let frontmostBefore = NSWorkspace.shared.frontmostApplication?.processIdentifier
let candidates = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
    .filter { !$0.isTerminated }

guard !candidates.isEmpty else {
    emit(["ok": false, "reason": "wechat_not_running"])
}
guard !candidates.contains(where: { $0.processIdentifier == frontmostBefore }) else {
    emit(["ok": false, "reason": "wechat_frontmost"])
}

for running in candidates {
    let application = AXUIElementCreateApplication(running.processIdentifier)
    guard let windows = attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement]
    else { continue }

    for window in windows {
        let controls = descendants(window)
        guard controls.contains(where: {
            stringAttribute($0, kAXIdentifierAttribute as CFString) == "session_list"
        }) else { continue }

        let ordinaryRows = controls.filter { element in
            let identifier = stringAttribute(element, kAXIdentifierAttribute as CFString)
            guard identifier.hasPrefix("session_item_") else { return false }
            return ![
                "session_item_Minimized Groups",
                "session_item_Service Accounts",
                "session_item_Official Accounts",
            ].contains(identifier)
        }
        guard let row = ordinaryRows.first else { continue }
        guard selectRow(row) else {
            emit(["ok": false, "reason": "chat_selection_failed"])
        }
        Thread.sleep(forTimeInterval: 0.1)
        let frontmostAfter = NSWorkspace.shared.frontmostApplication?.processIdentifier
        guard frontmostAfter == frontmostBefore else {
            emit(["ok": false, "reason": "wechat_took_focus"])
        }
        emit([
            "ok": true,
            "primed": true,
            "pid": running.processIdentifier,
        ])
    }
}

emit(["ok": false, "reason": "wechat_chat_list_unavailable"])
