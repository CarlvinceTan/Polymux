// macOS backend for safe contained on-demand background launches.
import AppKit
import Foundation

struct Options {
    let app: String
    let process: String
    let bundleID: String
    let appPath: String?
    let checkOnly: Bool
    let allowFrontmostRequested: Bool
    let launchArguments: [String]
}

func emit(_ status: String, code: Int32 = 0, fields: [String: Any] = [:]) -> Never {
    var result = fields
    result["status"] = status
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    exit(code)
}

func parseOptions() -> Options {
    guard CommandLine.arguments.dropFirst().first == "prepare" else {
        emit("blocked_usage", code: 2)
    }
    var app = ""
    var process = ""
    var bundleID = ""
    var appPath: String?
    var checkOnly = false
    var allowFrontmostRequested = false
    var launchArguments: [String] = []
    var index = 2
    while index < CommandLine.arguments.count {
        let option = CommandLine.arguments[index]
        if option == "--check-only" {
            checkOnly = true
            index += 1
            continue
        }
        if option == "--allow-frontmost-requested" {
            allowFrontmostRequested = true
            index += 1
            continue
        }
        guard index + 1 < CommandLine.arguments.count else {
            emit("blocked_usage", code: 2)
        }
        let value = CommandLine.arguments[index + 1]
        switch option {
        case "--app": app = value
        case "--process": process = value
        case "--bundle-id": bundleID = value
        case "--app-path": appPath = value
        case "--launch-arg": launchArguments.append(value)
        default: emit("blocked_usage", code: 2)
        }
        index += 2
    }
    guard !app.isEmpty else { emit("blocked_usage", code: 2) }
    return Options(
        app: app,
        process: process.isEmpty ? app : process,
        bundleID: bundleID,
        appPath: appPath,
        checkOnly: checkOnly,
        allowFrontmostRequested: allowFrontmostRequested,
        launchArguments: launchArguments
    )
}

func resolvedAppURL(options: Options) -> URL? {
    let manager = FileManager.default
    if let path = options.appPath {
        let url = URL(fileURLWithPath: path)
        return manager.fileExists(atPath: url.appendingPathComponent("Contents/Info.plist").path)
            ? url : nil
    }
    if !options.bundleID.isEmpty,
       let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: options.bundleID) {
        return url
    }
    let roots = [
        "/Applications", "/System/Applications", "/System/Applications/Utilities",
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path,
    ]
    for root in roots {
        let url = URL(fileURLWithPath: root).appendingPathComponent("\(options.app).app")
        if manager.fileExists(atPath: url.appendingPathComponent("Contents/Info.plist").path) {
            return url
        }
    }
    return nil
}

func identity(options: Options, url: URL?) -> String {
    if !options.bundleID.isEmpty { return options.bundleID }
    return url.flatMap { Bundle(url: $0)?.bundleIdentifier } ?? ""
}

func targetApplications(options: Options, bundleID: String) -> [NSRunningApplication] {
    let applications = NSWorkspace.shared.runningApplications.filter { !$0.isTerminated }
    if !bundleID.isEmpty {
        return applications.filter { $0.bundleIdentifier == bundleID }
    }
    return applications.filter {
        $0.localizedName == options.process || $0.executableURL?.lastPathComponent == options.process
    }
}

func targetPIDs(options: Options, bundleID: String) -> [Int] {
    targetApplications(options: options, bundleID: bundleID).map { Int($0.processIdentifier) }
}

func recover(prior: NSRunningApplication, target: NSRunningApplication) -> Bool {
    var requested = false
    if !prior.isTerminated {
        requested = prior.activate(options: [])
    }
    if !requested {
        requested = target.hide()
    }
    guard requested else { return false }
    let deadline = Date().addingTimeInterval(0.8)
    while Date() < deadline {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == prior.processIdentifier {
            return true
        }
        _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.005))
    }
    return false
}

@main
struct Main {
    static func main() {
        let options = parseOptions()
        let url = resolvedAppURL(options: options)
        let bundleID = identity(options: options, url: url)
        guard let prior = NSWorkspace.shared.frontmostApplication else {
            emit("blocked_state_unavailable", code: 6, fields: ["app": options.app])
        }
        let existing = targetApplications(options: options, bundleID: bundleID)
        if existing.contains(where: { $0.processIdentifier == prior.processIdentifier }) {
            emit(
                options.allowFrontmostRequested
                    ? "ready_existing_frontmost_requested" : "blocked_user_active",
                code: options.allowFrontmostRequested ? 0 : 3,
                fields: ["app": options.app, "pid": Int(prior.processIdentifier)]
            )
        }
        if !existing.isEmpty {
            emit(
                "ready_existing_background",
                fields: ["app": options.app, "pids": existing.map { Int($0.processIdentifier) }]
            )
        }
        guard let appURL = url, !bundleID.isEmpty else {
            emit("blocked_app_identity_unavailable", code: 2, fields: ["app": options.app])
        }
        if options.checkOnly {
            emit("ready_on_demand_launch", fields: ["app": options.app, "app_path": appURL.path])
        }

        // All state needed for containment is resolved before the launch call.
        let launcher = Process()
        launcher.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        launcher.arguments = ["-g", "-a", appURL.path]
        if !options.launchArguments.isEmpty {
            launcher.arguments! += ["--args"] + options.launchArguments
        }
        var takeovers = 0
        var recoveries = 0
        var recoveryFailed = false
        var priorChanged = false
        let notifications = NSWorkspace.shared.notificationCenter
        let observer = notifications.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { notification in
            guard let active = notification.userInfo?[NSWorkspace.applicationUserInfoKey]
                as? NSRunningApplication else {
                recoveryFailed = true
                return
            }
            if active.bundleIdentifier == bundleID {
                takeovers += 1
                if recover(prior: prior, target: active) {
                    recoveries += 1
                } else {
                    recoveryFailed = true
                }
            } else if active.processIdentifier != prior.processIdentifier {
                priorChanged = true
            }
        }
        defer { notifications.removeObserver(observer) }
        do {
            try launcher.run()
        } catch {
            emit("blocked_launch_failed", code: 5, fields: ["app": options.app])
        }

        let deadline = Date().addingTimeInterval(5.0)
        while Date() < deadline {
            guard let active = NSWorkspace.shared.frontmostApplication else {
                recoveryFailed = true
                break
            }
            if active.bundleIdentifier == bundleID {
                takeovers += 1
                if recover(prior: prior, target: active) {
                    recoveries += 1
                } else {
                    recoveryFailed = true
                    break
                }
            } else if active.processIdentifier != prior.processIdentifier {
                priorChanged = true
                break
            }
            _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.005))
        }
        launcher.waitUntilExit()
        if launcher.terminationStatus != 0 {
            emit("blocked_launch_failed", code: 5, fields: ["app": options.app])
        }
        let pids = targetPIDs(options: options, bundleID: bundleID)
        let finalPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
        if recoveryFailed || priorChanged || finalPID != prior.processIdentifier {
            emit(
                "blocked_foreground_recovery_failed",
                code: 11,
                fields: [
                    "app": options.app, "takeovers": takeovers,
                    "recoveries": recoveries, "prior_changed": priorChanged,
                ]
            )
        }
        if pids.isEmpty {
            emit("blocked_launch_unverified", code: 8, fields: ["app": options.app])
        }
        emit(
            takeovers == 0 ? "ready_background_launch" : "ready_background_recovered_launch",
            fields: [
                "app": options.app, "pids": pids, "takeovers": takeovers,
                "recoveries": recoveries,
                "prior_app": prior.bundleIdentifier ?? prior.localizedName ?? "",
            ]
        )
    }
}
