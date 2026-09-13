import AppKit
import ApplicationServices
import Darwin

func kernelProcessBirth(_ pid: pid_t) -> String? {
    var info = proc_bsdinfo()
    guard pid > 0,
          proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout.size(ofValue: info))) == MemoryLayout.size(ofValue: info),
          info.pbi_pid == UInt32(pid), info.pbi_start_tvsec > 0, info.pbi_start_tvusec < 1_000_000 else { return nil }
    return "\(pid):bsd:\(info.pbi_start_tvsec):\(info.pbi_start_tvusec)"
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func frame(_ window: AXUIElement) -> CGRect? {
    guard let p = attribute(window, kAXPositionAttribute), let s = attribute(window, kAXSizeAttribute),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero; var size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}
func automationAllowed(_ bundle: String) -> Bool {
    var descriptor = AEAddressDesc()
    let bytes = Array(bundle.utf8)
    let status = bytes.withUnsafeBytes { AECreateDesc(DescType(0x62756e64), $0.baseAddress, bytes.count, &descriptor) }
    guard status == noErr else { return false }
    defer { AEDisposeDesc(&descriptor) }
    return AEDeterminePermissionToAutomateTarget(&descriptor, AEEventClass(0x2a2a2a2a), AEEventID(0x2a2a2a2a), false) == noErr
}
let session = CGSessionCopyCurrentDictionary() as? [String: Any]
let sessionID = "quartz:" + String(getuid())
let workspace = NSWorkspace.shared
let front = workspace.frontmostApplication
let accessible = AXIsProcessTrusted() // This check never requests permission.
let raw = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
var apps = [String: Any]()
var surfaces = [[String: Any]]()
var activeWindow: String? = nil
var focusedFrame: CGRect? = nil
if accessible, let pid = front?.processIdentifier,
   let focused = attribute(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute),
   CFGetTypeID(focused) == AXUIElementGetTypeID() {
    focusedFrame = frame(focused as! AXUIElement)
}
var focusedMatches = [String]()
for app in workspace.runningApplications where app.activationPolicy == .regular {
    guard let id = app.bundleIdentifier,
          let instance = app.launchDate.map({ "\(app.processIdentifier):\($0.timeIntervalSince1970)" })
            ?? kernelProcessBirth(app.processIdentifier) else { continue }
    var row: [String: Any] = ["name": app.localizedName ?? id, "pid": app.processIdentifier,
        "app_id": id, "instance_id": instance, "session_id": sessionID, "path": app.executableURL?.path ?? "", "windows": []]
    if let url = app.bundleURL, let bundle = Bundle(url: url),
       let types = bundle.infoDictionary?["CFBundleURLTypes"] as? [[String: Any]] {
        row["browser_candidate"] = types.contains { type in
            let schemes = type["CFBundleURLSchemes"] as? [String] ?? []
            return schemes.contains("http") || schemes.contains("https")
        }
    }
    // Metadata access is attempted only when existing Apple Events consent permits it.
    if id == "com.apple.Safari" || id.lowercased().contains("chrome") || id.lowercased().contains("chromium") {
        row["metadata_allowed"] = automationAllowed(id)
    }
    var windows = [[String: Any]]()
    for item in raw where (item[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier) && (item[kCGWindowLayer as String] as? Int) == 0 {
        guard let number = item[kCGWindowNumber as String] as? Int else { continue }
        let idString = String(number)
        let bounds = item[kCGWindowBounds as String] as? NSDictionary
        let rect = bounds.flatMap { CGRect(dictionaryRepresentation: $0) }
        if let rect = rect, rect.width < 80 || rect.height < 60 { continue }
        if accessible && (item[kCGWindowName as String] as? String ?? "").isEmpty && !(item[kCGWindowIsOnscreen as String] as? Bool ?? false) { continue }
        var window: [String: Any] = ["window_id": idString, "title": item[kCGWindowName as String] as? String ?? "",
            "onscreen": item[kCGWindowIsOnscreen as String] as? Bool ?? false]
        if let rect = rect {
            window["bounds"] = ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height]
            if front?.processIdentifier == app.processIdentifier, let focused = focusedFrame,
               abs(rect.minX-focused.minX)<2 && abs(rect.minY-focused.minY)<2 && abs(rect.width-focused.width)<2 && abs(rect.height-focused.height)<2 {
                focusedMatches.append(idString)
            }
        }
        windows.append(window)
        var surface = window
        surface.merge(["kind": "window", "app_id": id, "instance_id": instance, "pid": app.processIdentifier,
            "identity": "exact", "provider": "macos", "session_id": sessionID, "capabilities": ["observe": true, "background_actions": accessible]]) { _, new in new }
        surfaces.append(surface)
    }
    row["windows"] = windows
    apps["\(id):\(instance)"] = row
}
if focusedMatches.count == 1 { activeWindow = focusedMatches[0] }
for i in surfaces.indices {
    if let front = front {
        if (surfaces[i]["pid"] as? pid_t) != front.processIdentifier { surfaces[i]["human_active"] = false }
        else if let activeWindow = activeWindow { surfaces[i]["human_active"] = (surfaces[i]["window_id"] as? String) == activeWindow }
        else { surfaces[i]["human_active"] = "unknown" }
    } else { surfaces[i]["human_active"] = "unknown" }
}
let result: [String: Any] = ["apps": apps, "surfaces": surfaces,
    "sessions": [["session_id": sessionID, "type": "quartz", "presence": session != nil ? "possible" : "unknown",
                  "observable": session != nil, "on_console": session?[kCGSessionOnConsoleKey as String] as Any? ?? NSNull(),
                  "active": ["app_id": front?.bundleIdentifier as Any? ?? NSNull(), "window_id": activeWindow as Any? ?? NSNull()]]],
    "session_inventory_complete": false, "human_active": session != nil ? true : "unknown",
    "active": ["app_id": front?.bundleIdentifier as Any? ?? NSNull(), "pid": front?.processIdentifier as Any? ?? NSNull(), "window_id": activeWindow as Any? ?? NSNull()],
    "capabilities": ["apps": true, "windows": true, "focused_window": activeWindow != nil, "accessibility": accessible],
    "observed_at": Date().timeIntervalSince1970]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
