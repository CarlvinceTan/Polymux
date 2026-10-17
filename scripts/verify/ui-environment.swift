import AppKit

func emit(_ value: [String: Any]) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: .sortedKeys) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
    exit(0)
}

if CommandLine.arguments.count == 2, CommandLine.arguments[1] == "windows" {
    let owners: Set<String> = [
        "com.apple.usernotificationcenter", "com.apple.notificationcenterui", "com.apple.securityagent",
        "com.apple.coreservicesuiagent", "com.apple.universalaccessauthwarn", "com.apple.tccd"
    ]
    let names: Set<String> = ["UserNotificationCenter", "NotificationCenter", "SecurityAgent", "CoreServicesUIAgent", "universalAccessAuthWarn"]
    guard let records = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        emit(["available": false, "windows": []])
    }
    let windows = records.compactMap { record -> [String: Any]? in
        guard let pid = record[kCGWindowOwnerPID as String] as? Int32,
              let id = record[kCGWindowNumber as String] as? Int,
              let name = record[kCGWindowOwnerName as String] as? String,
              let bounds = record[kCGWindowBounds as String] as? [String: Double],
              bounds["Width", default: 0] > 1, bounds["Height", default: 0] > 1,
              (record[kCGWindowAlpha as String] as? Double ?? 1) > 0 else { return nil }
        let bundle = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier?.lowercased() ?? ""
        guard owners.contains(bundle) || (bundle.isEmpty && names.contains(name)) else { return nil }
        return ["pid": pid, "window_id": id, "owner": name, "bundle_id": bundle,
                "title": record[kCGWindowName as String] as? String ?? ""]
    }
    emit(["available": true, "windows": windows])
}

guard CommandLine.arguments.count == 3, CommandLine.arguments[1] == "accessibility" else { exit(2) }
let target = URL(fileURLWithPath: CommandLine.arguments[2]).resolvingSymlinksInPath()
guard Bundle(url: target)?.object(forInfoDictionaryKey: "PolymuxVerifyProtocol") as? Int == 1 else {
    emit(["available": false, "reason": "built Polymux lacks the read-only Accessibility probe"])
}
let nonce = UUID()
let result = FileManager.default.temporaryDirectory
    .appending(path: "polymux-ui-accessibility-\(nonce.uuidString).json")
let existing = Set(NSWorkspace.shared.runningApplications.map(\.processIdentifier))
let configuration = NSWorkspace.OpenConfiguration()
configuration.activates = false
configuration.addsToRecentItems = false
configuration.createsNewApplicationInstance = true
configuration.promptsUserIfNeeded = false
configuration.arguments = ["--verify-accessibility", nonce.uuidString]
var owned: NSRunningApplication?
NSWorkspace.shared.openApplication(at: target, configuration: configuration) { application, _ in
    DispatchQueue.main.async {
        if let application, !existing.contains(application.processIdentifier),
           application.bundleURL?.resolvingSymlinksInPath() == target { owned = application }
    }
}
let deadline = Date().addingTimeInterval(5)
Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
    if let data = try? Data(contentsOf: result),
       let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let trusted = value["accessibility"] as? Bool {
        try? FileManager.default.removeItem(at: result)
        emit(["available": true, "accessibility": trusted])
    }
    if Date() >= deadline {
        owned?.terminate()
        emit(["available": false, "reason": "Polymux Accessibility probe did not answer"])
    }
}
RunLoop.main.run()
