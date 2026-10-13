#if os(macOS) || os(iOS) || os(visionOS) || os(tvOS) || os(watchOS)
import os
#endif
import Foundation

/// Visible feedback lands inside one frame. The published state change lands inside 50 ms.
public enum InstantUI {
    /// Visible feedback has to finish inside one frame.
    public static let feedbackBudget: Duration = .milliseconds(16)

    /// A published state change has to finish inside this window.
    public static let stateBudget: Duration = .milliseconds(50)

    /// Records a signpost from `tap` through `body` and returns the body's value.
    @discardableResult
    public static func interval<T>(
        _ name: StaticString,
        budget: Duration,
        trace: SignpostTrace,
        from tap: ContinuousClock.Instant? = nil,
        _ body: () -> T
    ) -> T {
        prepare()
        let clock = ContinuousClock()
        #if os(macOS) || os(iOS) || os(visionOS) || os(tvOS) || os(watchOS)
        let state = signposter.beginInterval(name)
        #endif
        let start = tap ?? clock.now
        let value = body()
        let duration = start.duration(to: clock.now)
        #if os(macOS) || os(iOS) || os(visionOS) || os(tvOS) || os(watchOS)
        signposter.endInterval(name, state)
        #endif
        trace.record(signpostName(name), duration: duration, budget: budget)
        return value
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

    /// Publishes the chosen answer before `send`, measured from `tap` through that publish.
    /// A thrown send restores the unanswered card.
    @MainActor
    @discardableResult
    public static func apply(
        current: ApprovalChoice = ApprovalChoice(),
        optionID: String,
        tap: ContinuousClock.Instant? = nil,
        trace: SignpostTrace = SignpostTrace(),
        send: () async throws -> Void,
        publish: (ApprovalChoice) -> Void
    ) async -> ApprovalChoice {
        guard !current.isSending, current.shown == nil else { return current }
        var choice = ApprovalChoice()
        let origin = tap ?? ContinuousClock().now
        InstantUI.interval("ApprovalState", budget: InstantUI.stateBudget, trace: trace, from: origin) {
            InstantUI.interval("ApprovalFeedback", budget: InstantUI.feedbackBudget, trace: trace, from: origin) {
                choice.optionID = optionID
                choice.isSending = true
                publish(choice)
            }
        }
        do {
            try await send()
            choice.isSending = false
            publish(choice)
        } catch {
            InstantUI.interval("ApprovalRollback", budget: InstantUI.feedbackBudget, trace: trace) {
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
        /// Strictly inside the budget. A span that merely ties the limit has missed it.
        public var withinBudget: Bool { duration < budget }
    }

    private let lock = NSLock()
    private var storage: [Span] = []

    public init() {}

    @discardableResult
    public func record(_ name: String, duration: Duration, budget: Duration) -> Span {
        let span = Span(name: name, duration: duration, budget: budget)
        lock.withLock { storage.append(span) }
        return span
    }

    public var spans: [Span] { lock.withLock { storage } }

    public var meetsBudgets: Bool { spans.allSatisfy(\.withinBudget) }
}

private func signpostName(_ name: StaticString) -> String {
    name.withUTF8Buffer { String(decoding: $0, as: UTF8.self) }
}
