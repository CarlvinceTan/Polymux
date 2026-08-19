import AppKit
import CoreGraphics
import Foundation

struct Options {
    let bundleID: String
    let processName: String
    let durationMilliseconds: Int
    let readyFile: String
    let resultFile: String
}

func parseOptions() -> Options {
    var values: [String: String] = [:]
    var index = 1
    while index < CommandLine.arguments.count {
        guard CommandLine.arguments[index].hasPrefix("--"), index + 1 < CommandLine.arguments.count else { exit(2) }
        values[String(CommandLine.arguments[index].dropFirst(2))] = CommandLine.arguments[index + 1]
        index += 2
    }
    guard let processName = values["process"],
          let durationString = values["duration-ms"], let duration = Int(durationString), duration > 0,
          let readyFile = values["ready-file"],
          let resultFile = values["result-file"] else { exit(2) }
    return Options(
        bundleID: values["bundle-id"] ?? "",
        processName: processName,
        durationMilliseconds: duration,
        readyFile: readyFile,
        resultFile: resultFile
    )
}

func rows() -> [[String: Any]] {
    CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
}

func targetPIDs(options: Options, rows: [[String: Any]]) -> Set<pid_t> {
    if !options.bundleID.isEmpty {
        return Set(NSRunningApplication.runningApplications(withBundleIdentifier: options.bundleID).map(\.processIdentifier))
    }
    return Set(rows.compactMap { row -> pid_t? in
        guard (row[kCGWindowOwnerName as String] as? String) == options.processName else { return nil }
        return (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
    })
}

func significantOnscreenWindows(options: Options) -> [[String: Any]] {
    let currentRows = rows()
    let pids = targetPIDs(options: options, rows: currentRows)
    return currentRows.filter { row in
        guard let pid = (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
              pids.contains(pid),
              (row[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              (row[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true,
              let dictionary = row[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: dictionary) else { return false }
        return bounds.width >= 80 && bounds.height >= 60
    }
}

func windowID(_ row: [String: Any]) -> UInt32 {
    (row[kCGWindowNumber as String] as? NSNumber)?.uint32Value ?? 0
}

func write(_ text: String, to path: String) {
    do {
        try text.data(using: .utf8)!.write(to: URL(fileURLWithPath: path), options: .atomic)
    } catch {
        exit(6)
    }
}

@main
struct Main {
    static func main() {
        let options = parseOptions()
        let baseline = Set(significantOnscreenWindows(options: options).map(windowID))
        write("ready\n", to: options.readyFile)
        let deadline = Date().addingTimeInterval(Double(options.durationMilliseconds) / 1000.0)
        while Date() < deadline {
            for row in significantOnscreenWindows(options: options) {
                let id = windowID(row)
                if !baseline.contains(id) {
                    let pid = (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0
                    let title = row[kCGWindowName as String] as? String ?? ""
                    let result: [String: Any] = [
                        "status": "window_exposed",
                        "window_id": id,
                        "pid": pid,
                        "title": title
                    ]
                    let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                    write(String(data: data, encoding: .utf8)! + "\n", to: options.resultFile)
                    exit(4)
                }
            }
            usleep(10_000)
        }
        write("{\"status\":\"clear\"}\n", to: options.resultFile)
    }
}
