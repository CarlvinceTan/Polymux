import Foundation
import os

/// Click-to-content intervals for chat switches. The perf harness reads these signposts.
enum SwitchTrace {
    private static let log = OSLog(subsystem: "com.polymux.chat", category: "switch")

    static func click(threadID: String, cached: Bool) {
        os_signpost(.event, log: log, name: "click", "id=%{public}s cached=%{public}d", threadID, cached ? 1 : 0)
    }

    static func content(threadID: String, messages: Int) {
        os_signpost(.event, log: log, name: "content", "id=%{public}s messages=%{public}d", threadID, messages)
    }
}
