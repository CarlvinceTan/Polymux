import Foundation
#if os(macOS) || os(iOS)
import os
#endif

struct InstantSignpost: Equatable, Sendable {
    let name: String
    let duration: Duration
}

enum InstantBudget {
    /// One frame. The row leaves the sidebar before the server answers.
    static let rowRemoval: Duration = .milliseconds(16)
    /// Restoring a row after a failed delete is the same local update.
    static let rollback: Duration = .milliseconds(16)
}

enum InstantTrace {
    static let row = "agentDelete.row"
    static let rollback = "agentDelete.rollback"

    #if os(macOS) || os(iOS)
    private static let poster = OSSignposter(subsystem: "com.flarehq.polymux.app", category: "InstantUI")
    private static let rowName: StaticString = "agentDelete.row"
    private static let rollbackName: StaticString = "agentDelete.rollback"
    #endif

    static func measure(_ name: String, _ body: () -> Void) -> InstantSignpost {
        let start = ContinuousClock.now
        #if os(macOS) || os(iOS)
        if name == rollback {
            let state = poster.beginInterval(rollbackName)
            body()
            poster.endInterval(rollbackName, state)
        } else {
            let state = poster.beginInterval(rowName)
            body()
            poster.endInterval(rowName, state)
        }
        #else
        body()
        #endif
        return InstantSignpost(name: name, duration: start.duration(to: ContinuousClock.now))
    }
}
