import AppKit
import ApplicationServices
import Darwin

enum HelperError: Error { case invalid(String) }
let maxBytes = 2 * 1024 * 1024

func automation(_ identifier: String, prompt: Bool) -> OSStatus {
    var descriptor = AEAddressDesc()
    let bytes = Array(identifier.utf8)
    let status = bytes.withUnsafeBytes { AECreateDesc(DescType(0x62756e64), $0.baseAddress, bytes.count, &descriptor) }
    guard status == noErr else { return OSStatus(status) }
    defer { AEDisposeDesc(&descriptor) }
    return AEDeterminePermissionToAutomateTarget(&descriptor, AEEventClass(0x2a2a2a2a), AEEventID(0x2a2a2a2a), prompt)
}

func browserID(_ value: Any?) throws -> String {
    guard let identifier = value as? String,
          identifier.range(of: "^[A-Za-z0-9]+(?:[A-Za-z0-9.-]*[A-Za-z0-9])?$", options: .regularExpression) != nil,
          let app = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).first,
          let url = app.bundleURL, let bundle = Bundle(url: url),
          let types = bundle.infoDictionary?["CFBundleURLTypes"] as? [[String: Any]],
          types.contains(where: { (($0["CFBundleURLSchemes"] as? [String]) ?? []).contains("http") }),
          bundle.infoDictionary?["OSAScriptingDefinition"] is String else {
        throw HelperError.invalid("a running browser bundle identifier is required")
    }
    return identifier
}

func tabSchema(_ identifier: String) throws -> String {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).first,
          let url = app.bundleURL, let bundle = Bundle(url: url),
          let definition = bundle.infoDictionary?["OSAScriptingDefinition"] as? String,
          (definition as NSString).lastPathComponent == definition else {
        throw HelperError.invalid("browser scripting bundle unavailable")
    }
    let document = try XMLDocument(contentsOf: url.appendingPathComponent("Contents/Resources/" + definition), options: [])
    for node in try document.nodes(forXPath: "//class[@name='tab']") {
        let properties = try node.nodes(forXPath: "property").compactMap { $0 as? XMLElement }
        let names = Set(properties.compactMap { $0.attribute(forName: "name")?.stringValue })
        if names.isSuperset(of: ["id", "title", "URL"]),
           let id = properties.first(where: { $0.attribute(forName: "name")?.stringValue == "id" }),
           id.attribute(forName: "access")?.stringValue == "r",
           id.elements(forName: "cocoa").first?.attribute(forName: "key")?.stringValue == "uniqueID" { return "chromium" }
        if names.isSuperset(of: ["name", "URL", "index"]) { return "safari" }
    }
    throw HelperError.invalid("browser does not expose a supported native tab scripting contract")
}

func run(_ executable: URL, _ arguments: [String], seconds: Double = 10) throws -> [String: Any] {
    let process = Process(), output = Pipe(), errors = Pipe()
    process.executableURL = executable; process.arguments = arguments
    process.standardOutput = output; process.standardError = errors
    process.standardInput = FileHandle.nullDevice
    try process.run()
    // Drain both pipes while the child runs. A bounded child cannot stall the parent
    // with a full pipe. Only the child's own PID is terminated on timeout.
    let group = DispatchGroup()
    let guardLock = NSLock()
    var stdout = Data(), stderr = Data()
    for (pipe, isError) in [(output, false), (errors, true)] {
        group.enter()
        DispatchQueue.global().async {
            while true {
                let data = pipe.fileHandleForReading.availableData
                if data.isEmpty { break }
                guardLock.lock()
                let length = isError ? stderr.count : stdout.count
                if length + data.count <= maxBytes {
                    if isError { stderr.append(data) } else { stdout.append(data) }
                } else if process.isRunning { process.terminate() }
                guardLock.unlock()
            }
            group.leave()
        }
    }
    let deadline = Date().addingTimeInterval(seconds)
    while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
    if process.isRunning { kill(process.processIdentifier, SIGKILL) }
    process.waitUntilExit()
    guard group.wait(timeout: .now() + 1) == .success else { throw HelperError.invalid("helper output did not close") }
    return ["exit_code": Int(process.terminationStatus), "stdout": String(decoding: stdout, as: UTF8.self),
            "stderr": String(decoding: stderr, as: UTF8.self)]
}

func dispatch(_ request: [String: Any]) throws -> [String: Any] {
    let operation = request["operation"] as? String ?? ""
    let helperDir = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers")
    switch operation {
    case "status":
        return ["name": Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as Any? ?? "",
                "bundle_id": Bundle.main.bundleIdentifier ?? "", "pid": getpid(),
                "accessibility": AXIsProcessTrusted(), "screen_capture": CGPreflightScreenCaptureAccess(),
                "dock_icon": false]
    case "request-accessibility":
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        return ["accessibility": AXIsProcessTrustedWithOptions(options), "requested": "accessibility"]
    case "request-screen-capture":
        return ["screen_capture": CGRequestScreenCaptureAccess(), "requested": "screen_capture"]
    case "request-automation":
        let identifier = try browserID(request["browser"])
        return ["browser": identifier, "automation_status": Int(automation(identifier, prompt: true)), "requested": "automation"]
    case "native":
        return try run(helperDir.appendingPathComponent("state"), [], seconds: 3)
    case "metadata":
        let identifier = try browserID(request["browser"])
        guard automation(identifier, prompt: false) == noErr else { throw HelperError.invalid("Control Skill automation permission is unavailable") }
        let schema = try tabSchema(identifier)
        let script = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/tabs.js")
        return try run(URL(fileURLWithPath: "/usr/bin/osascript"), ["-l", "JavaScript", script.path, identifier, schema], seconds: 2)
    case "window":
        guard let arguments = request["arguments"] as? [String], let command = arguments.first,
              ["app-identity", "validate-identity", "list", "capture", "inspect", "tabs", "press", "set-value"].contains(command),
              arguments.count <= 40, arguments.allSatisfy({ $0.utf8.count <= 32768 }) else {
            throw HelperError.invalid("invalid native window request")
        }
        // The normal window.py entry point owns the lease/action fence. This is
        // its bundled native backend, subject to the same cooperative contract.
        return try run(helperDir.appendingPathComponent("window"), arguments, seconds: 12)
    default:
        throw HelperError.invalid("unsupported operation")
    }
}

@main struct ControlSkill {
    static func main() {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)
        guard CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--request" else { return }
        let url = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
        let expected = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Control/mac-requests").standardizedFileURL
        guard url.deletingLastPathComponent() == expected,
              url.lastPathComponent.range(of: "^[0-9a-f]{32}\\.json$", options: .regularExpression) != nil else { return }
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { return }
        let file = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == getuid(), (info.st_mode & S_IFMT) == S_IFREG,
              (info.st_mode & 0o077) == 0, info.st_size <= 65536 else { return }
        let responseURL = url.deletingPathExtension().appendingPathExtension("result")
        var result: [String: Any]
        do {
            guard let data = try file.readToEnd(), let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let deadline = request["expires_at"] as? Double, deadline > Date().timeIntervalSince1970,
                  deadline < Date().timeIntervalSince1970 + 180 else { throw HelperError.invalid("expired or malformed request") }
            result = ["status": "ok", "result": try dispatch(request)]
        } catch { result = ["status": "error", "reason": String(describing: error)] }
        result["permission_identity"] = Bundle.main.bundleIdentifier ?? ""
        do {
            let data = try JSONSerialization.data(withJSONObject: result)
            // The private, same-user request directory is the IPC boundary.
            let output = open(responseURL.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
            guard output >= 0 else { return }
            let handle = FileHandle(fileDescriptor: output, closeOnDealloc: true)
            try handle.write(contentsOf: data); try handle.close()
        } catch { return }
    }
}
