import Foundation
import os
import Observation
import PolymuxKit

/// Click-to-content intervals. The duration starts at the tap, which `InstantUI` records.
@MainActor
enum SwitchTrace {
    static let state = SwitchState()
    private static var taps: [String: ContinuousClock.Instant] = [:]
    private static let trace = SignpostTrace()
    private static let log = Logger(subsystem: "com.flarehq.polymux.app", category: "InstantUI")

    static func click(threadID: String) {
        taps[threadID] = ContinuousClock().now
    }

    static func content(threadID: String, messages: Int) {
        guard messages > 0, let tap = taps.removeValue(forKey: threadID) else { return }
        let before = trace.spans.count
        InstantUI.interval("ChatSwitchState", budget: InstantUI.stateBudget, trace: trace, from: tap) {}
        guard let span = trace.spans.last, trace.spans.count > before else { return }
        let ms = Double(span.duration.components.seconds) * 1000 + Double(span.duration.components.attoseconds) / 1e15
        let text = String(format: "%.3f", ms)
        state.samples.append(text)
        log.info("ChatSwitchState \(text, privacy: .public)")
    }
}

@MainActor @Observable
final class SwitchState {
    var samples: [String] = []
}
