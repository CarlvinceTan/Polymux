import AppKit
import Foundation

struct Options {
    let bundleID: String
    let expectedPriorPID: pid_t
    let durationMilliseconds: Int
    let readyFile: String
    let resultFile: String
}

func parseOptions() -> Options {
    var values: [String: String] = [:]
    var index = 1
    while index < CommandLine.arguments.count {
        guard CommandLine.arguments[index].hasPrefix("--"),
              index + 1 < CommandLine.arguments.count else { exit(2) }
        values[String(CommandLine.arguments[index].dropFirst(2))] = CommandLine.arguments[index + 1]
        index += 2
    }
    guard let bundleID = values["bundle-id"], !bundleID.isEmpty,
          let expectedPriorText = values["expected-prior-pid"],
          let expectedPriorPID = Int32(expectedPriorText), expectedPriorPID > 0,
          let durationText = values["duration-ms"],
          let duration = Int(durationText), duration > 0,
          let readyFile = values["ready-file"],
          let resultFile = values["result-file"] else { exit(2) }
    return Options(bundleID: bundleID, expectedPriorPID: expectedPriorPID,
                   durationMilliseconds: duration,
                   readyFile: readyFile, resultFile: resultFile)
}

func write(_ text: String, to path: String) {
    do {
        try text.data(using: .utf8)!.write(
            to: URL(fileURLWithPath: path), options: .atomic)
    } catch {
        exit(6)
    }
}

func finish(_ status: String, takeovers: Int, recoveries: Int,
            maximumLatencyMilliseconds: Int, expectedPriorPID: pid_t,
            finalFrontmostPID: pid_t?, transientUnavailableSamples: Int,
            path: String, exitCode: Int32) -> Never {
    let result: [String: Any] = [
        "status": status,
        "takeovers": takeovers,
        "recoveries": recoveries,
        "maximum_recovery_latency_ms": maximumLatencyMilliseconds,
        "expected_prior_pid": expectedPriorPID,
        "final_frontmost_pid": finalFrontmostPID.map { Int($0) } ?? NSNull(),
        "transient_unavailable_samples": transientUnavailableSamples,
    ]
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    write(String(data: data, encoding: .utf8)! + "\n", to: path)
    exit(exitCode)
}

@main
struct Main {
    static func main() {
        let options = parseOptions()
        let workspace = NSWorkspace.shared
        guard let initialFrontmost = workspace.frontmostApplication,
              initialFrontmost.bundleIdentifier != options.bundleID,
              initialFrontmost.processIdentifier == options.expectedPriorPID else {
            finish("prior_state_changed", takeovers: 0, recoveries: 0,
                   maximumLatencyMilliseconds: 0,
                   expectedPriorPID: options.expectedPriorPID,
                   finalFrontmostPID: workspace.frontmostApplication?.processIdentifier,
                   transientUnavailableSamples: 0,
                   path: options.resultFile, exitCode: 6)
        }
        var takeovers = 0
        var recoveries = 0
        var maximumLatencyMilliseconds = 0
        var transientUnavailableSamples = 0

        write("ready\n", to: options.readyFile)
        let deadline = Date().addingTimeInterval(
            Double(options.durationMilliseconds) / 1000.0)

        func processEvents() {
            _ = RunLoop.current.run(
                mode: .default,
                before: Date().addingTimeInterval(0.005))
        }

        while Date() < deadline {
            guard let frontmost = workspace.frontmostApplication else {
                transientUnavailableSamples += 1
                processEvents()
                continue
            }

            if frontmost.bundleIdentifier != options.bundleID {
                if frontmost.processIdentifier != options.expectedPriorPID {
                    finish("prior_state_changed", takeovers: takeovers,
                           recoveries: recoveries,
                           maximumLatencyMilliseconds: maximumLatencyMilliseconds,
                           expectedPriorPID: options.expectedPriorPID,
                           finalFrontmostPID: frontmost.processIdentifier,
                           transientUnavailableSamples: transientUnavailableSamples,
                           path: options.resultFile, exitCode: 6)
                }
                processEvents()
                continue
            }

            takeovers += 1
            let started = Date()
            var requested = false
            if let prior = NSRunningApplication(processIdentifier: options.expectedPriorPID),
               !prior.isTerminated {
                requested = prior.activate(options: [])
            }
            if !requested {
                requested = frontmost.hide()
            }

            let recoveryDeadline = Date().addingTimeInterval(0.8)
            while Date() < recoveryDeadline {
                if workspace.frontmostApplication?.processIdentifier == options.expectedPriorPID {
                    recoveries += 1
                    let latency = Int(Date().timeIntervalSince(started) * 1000.0)
                    maximumLatencyMilliseconds = max(maximumLatencyMilliseconds, latency)
                    break
                }
                processEvents()
            }

            if workspace.frontmostApplication?.processIdentifier != options.expectedPriorPID {
                finish("recovery_failed", takeovers: takeovers, recoveries: recoveries,
                       maximumLatencyMilliseconds: maximumLatencyMilliseconds,
                       expectedPriorPID: options.expectedPriorPID,
                       finalFrontmostPID: workspace.frontmostApplication?.processIdentifier,
                       transientUnavailableSamples: transientUnavailableSamples,
                       path: options.resultFile, exitCode: 4)
            }
            processEvents()
        }

        guard let finalFrontmost = workspace.frontmostApplication else {
            finish("state_unavailable", takeovers: takeovers, recoveries: recoveries,
                   maximumLatencyMilliseconds: maximumLatencyMilliseconds,
                   expectedPriorPID: options.expectedPriorPID,
                   finalFrontmostPID: nil,
                   transientUnavailableSamples: transientUnavailableSamples,
                   path: options.resultFile, exitCode: 6)
        }
        finish(finalFrontmost.processIdentifier == options.expectedPriorPID
                   ? (takeovers == 0 ? "clear" : "recovered")
                   : "prior_state_changed",
               takeovers: takeovers, recoveries: recoveries,
               maximumLatencyMilliseconds: maximumLatencyMilliseconds,
               expectedPriorPID: options.expectedPriorPID,
               finalFrontmostPID: finalFrontmost.processIdentifier,
               transientUnavailableSamples: transientUnavailableSamples,
               path: options.resultFile,
               exitCode: finalFrontmost.processIdentifier == options.expectedPriorPID ? 0 : 6)
    }
}
