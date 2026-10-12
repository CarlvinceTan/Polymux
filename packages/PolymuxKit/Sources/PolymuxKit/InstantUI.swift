#if os(macOS) || os(iOS) || os(visionOS) || os(tvOS) || os(watchOS)
import os
#endif
import Foundation

/// P0 budgets: one frame to paint, a tenth of a second before the answer is shown.
public enum InstantUI {
    public static let paintBudget: Duration = .milliseconds(16)
    public static let feedbackBudget: Duration = .milliseconds(100)

    /// Records a signpost interval and keeps its duration on `trace`.
    public static func interval(_ name: StaticString, budget: Duration, trace: SignpostTrace, _ body: () -> Void) {
        prepare()
        let clock = ContinuousClock()
        #if os(macOS) || os(iOS) || os(visionOS) || os(tvOS) || os(watchOS)
        let state = signposter.beginInterval(name)
        #endif
        let start = clock.now
        body()
        let duration = start.duration(to: clock.now)
        #if os(macOS) || os(iOS) || os(visionOS) || os(tvOS) || os(watchOS)
        signposter.endInterval(name, state)
        #endif
        trace.record(signpostName(name), duration: duration, budget: budget)
    }

    private static func prepare() {
        #if os(macOS) || os(iOS) || os(visionOS) || os(tvOS) || os(watchOS)
        _ = signposter
        #endif
    }

    #if os(macOS) || os(iOS) || os(visionOS) || os(tvOS) || os(watchOS)
    private static let signposter: OSSignposter = {
        let poster = OSSignposter(subsystem: "com.flarehq.polymux.app", category: "InstantUI")
        let state = poster.beginInterval("InstantUIWarmup")
        poster.endInterval("InstantUIWarmup", state)
        return poster
    }()
    #endif
}

public struct ApprovalChoice: Equatable, Sendable {
    public var optionID: String?
    public var failed: Bool
    public var isSending: Bool

    public init(optionID: String? = nil, failed: Bool = false, isSending: Bool = false) {
        self.optionID = optionID
        self.failed = failed
        self.isSending = isSending
    }

    public var shown: String? { failed ? nil : optionID }

    /// Paints `optionID` before `send`. A thrown send restores the unanswered card.
    @MainActor
    @discardableResult
    public static func apply(
        current: ApprovalChoice = ApprovalChoice(),
        optionID: String,
        trace: SignpostTrace = SignpostTrace(),
        send: () async throws -> Void,
        publish: (ApprovalChoice) -> Void
    ) async -> ApprovalChoice {
        guard !current.isSending, current.shown == nil else { return current }
        var choice = ApprovalChoice()
        InstantUI.interval("ApprovalFeedback", budget: InstantUI.feedbackBudget, trace: trace) {
            InstantUI.interval("ApprovalAnswer", budget: InstantUI.paintBudget, trace: trace) {
                choice.optionID = optionID
                choice.isSending = true
            }
        }
        publish(choice)
        do {
            try await send()
            choice.isSending = false
            publish(choice)
        } catch {
            InstantUI.interval("ApprovalRollback", budget: InstantUI.paintBudget, trace: trace) {
                choice = ApprovalChoice(failed: true)
                publish(choice)
            }
        }
        return choice
    }
}

public final class SignpostTrace: @unchecked Sendable {
    public struct Span: Equatable, Sendable {
        public let name: String
        public let duration: Duration
        public let budget: Duration
        public var withinBudget: Bool { duration <= budget }
    }

    private let lock = NSLock()
    private var storage: [Span] = []

    public init() {}

    public func record(_ name: String, duration: Duration, budget: Duration) {
        lock.withLock { storage.append(Span(name: name, duration: duration, budget: budget)) }
    }

    public var spans: [Span] { lock.withLock { storage } }

    public var meetsBudgets: Bool { spans.allSatisfy(\.withinBudget) }
}

private func signpostName(_ name: StaticString) -> String {
    name.withUTF8Buffer { String(decoding: $0, as: UTF8.self) }
}
