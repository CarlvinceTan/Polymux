#if os(macOS) || os(iOS) || os(visionOS) || os(tvOS) || os(watchOS)
import os
#endif
import Foundation

/// Visible feedback within 16 ms, and the published state change within 50 ms.
public enum InstantUI {
    public static let feedbackBudget: Duration = .milliseconds(16)
    public static let stateBudget: Duration = .milliseconds(50)
    /// PR #41 names the 16 ms budget `paintBudget`.
    public static let paintBudget: Duration = feedbackBudget

    /// Records a signpost from the start of `body` through its return.
    @discardableResult
    public static func interval(_ name: StaticString, budget: Duration, trace: SignpostTrace, _ body: () -> Void) -> SignpostTrace.Span {
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
        return trace.record(signpostName(name), duration: duration, budget: budget)
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

public final class SignpostTrace: @unchecked Sendable {
    public struct Span: Equatable, Sendable {
        public let name: String
        public let duration: Duration
        public let budget: Duration
        public var withinBudget: Bool { duration <= budget }
    }

    public static let shared = SignpostTrace()

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
