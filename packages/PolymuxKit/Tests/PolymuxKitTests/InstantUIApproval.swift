import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import PolymuxKit

@Suite @MainActor
struct InstantUIApproval {
    @Test func publishWaitsForTheFrame() async {
        let clock = ApprovalClock()
        let settled = await ApprovalChoice.apply(optionID: "day", clock: clock, send: {}, publish: { _ in })
        // Publishing records only the state span; feedback is the answered row's first frame.
        #expect(clock.trace.spans.map(\.name) == ["ApprovalState"])
        #expect(settled.optionID == "day")
        #expect(settled.failed == false)
        #expect(settled.isSending == false)
        #expect(clock.answerAppeared())
        #expect(clock.answerAppeared() == false)
        #expect(clock.trace.spans.map(\.name) == ["ApprovalState", "ApprovalFeedback"])
    }

    @Test func optimisticAnswerMeetsBudgets() async {
        let clock = ApprovalClock()
        let gate = Gate()
        let task = Task { @MainActor in
            await ApprovalChoice.apply(optionID: "day", clock: clock, send: {
                await gate.hold()
            }, publish: { gate.publish($0) })
        }
        let shown = await gate.optimistic()
        await gate.untilStarted()
        #expect(shown.optionID == "day")
        #expect(shown.failed == false)
        #expect(shown.isSending == true)
        #expect(shown.shown == "day")
        #expect(InstantUI.feedbackBudget == .milliseconds(16))
        #expect(InstantUI.stateBudget == .milliseconds(50))
        #expect(clock.answerAppeared())
        expectAppearance(clock.trace, names: ["ApprovalState", "ApprovalFeedback"])
        gate.release()
        let settled = await task.value
        #expect(settled.optionID == "day")
        #expect(settled.failed == false)
        #expect(settled.isSending == false)
        #expect(settled.shown == "day")
    }

    @Test func forcedFailureRollsBack() async {
        let clock = ApprovalClock()
        var seen: [ApprovalChoice] = []
        let settled = await ApprovalChoice.apply(optionID: "research", clock: clock, send: {
            throw ClientError.unavailable
        }, publish: { seen.append($0) })
        #expect(seen.count == 2)
        #expect(seen[0].optionID == "research")
        #expect(seen[0].failed == false)
        #expect(seen[0].isSending == true)
        #expect(clock.trace.spans.map(\.name) == ["ApprovalState"])
        #expect(settled == ApprovalChoice(failed: true))
        #expect(settled.shown == nil)
        #expect(seen[1] == settled)
        #expect(clock.rollbackAppeared())
        #expect(clock.rollbackAppeared() == false)
        expectAppearance(clock.trace, names: ["ApprovalState", "ApprovalRollback"])
    }

    @Test func failedRequestRollsBack() async throws {
        let host = ApprovalProtocol.routes.add(status: 503)
        defer { ApprovalProtocol.routes.remove(host) }
        let client = approvalClient(host)
        let clock = ApprovalClock()
        let gate = Gate()
        var seen: [ApprovalChoice] = []
        let task = Task { @MainActor in
            await ApprovalChoice.apply(optionID: "code", clock: clock, send: {
                await gate.hold()
                _ = try await client.answerFocus(agentID: "agent", optionID: "code")
            }, publish: {
                seen.append($0)
                gate.publish($0)
            })
        }
        let shown = await gate.optimistic()
        #expect(shown.optionID == "code")
        #expect(shown.isSending == true)
        #expect(clock.answerAppeared())
        gate.release()
        let settled = await task.value
        #expect(ApprovalProtocol.routes.optionID(for: host) == "code")
        #expect(seen.first?.optionID == "code")
        #expect(seen.first?.isSending == true)
        #expect(settled == ApprovalChoice(failed: true))
        #expect(settled.shown == nil)
        #expect(clock.rollbackAppeared())
        #expect(clock.trace.spans.map(\.name) == ["ApprovalState", "ApprovalFeedback", "ApprovalRollback"])
        #expect(clock.trace.spans.last?.budget == InstantUI.feedbackBudget)
    }

    @Test func acceptedAnswerStays() async throws {
        let host = ApprovalProtocol.routes.add(status: 200)
        defer { ApprovalProtocol.routes.remove(host) }
        let client = approvalClient(host)
        let clock = ApprovalClock()
        let gate = Gate()
        let task = Task { @MainActor in
            await ApprovalChoice.apply(optionID: "everything", clock: clock, send: {
                await gate.hold()
                _ = try await client.answerFocus(agentID: "agent", optionID: "everything")
            }, publish: { gate.publish($0) })
        }
        let optimistic = await gate.optimistic()
        #expect(optimistic.optionID == "everything")
        #expect(optimistic.isSending == true)
        #expect(clock.answerAppeared())
        expectAppearance(clock.trace, names: ["ApprovalState", "ApprovalFeedback"])
        gate.release()
        let settled = await task.value
        #expect(ApprovalProtocol.routes.optionID(for: host) == "everything")
        #expect(settled.optionID == "everything")
        #expect(settled.failed == false)
        #expect(settled.isSending == false)
    }

    @Test func inflightAnswerIsKept() async {
        let gate = Gate()
        let clock = ApprovalClock()
        let task = Task { @MainActor in
            await ApprovalChoice.apply(optionID: "day", clock: clock, send: {
                await gate.hold()
            }, publish: { gate.publish($0) })
        }
        let first = await gate.optimistic()
        let ignored = ApprovalClock()
        var sent = false
        let second = await ApprovalChoice.apply(current: first, optionID: "code", clock: ignored, send: {
            sent = true
        }, publish: { _ in })
        #expect(sent == false)
        #expect(second == first)
        #expect(ignored.trace.spans.isEmpty)
        gate.release()
        let settled = await task.value
        #expect(settled.optionID == "day")
        #expect(settled.failed == false)
        #expect(settled.isSending == false)
    }

    @Test func skipAppliesOptimistically() async {
        let clock = ApprovalClock()
        var optimistic: ApprovalChoice?
        let settled = await ApprovalChoice.apply(optionID: FocusAnswer.dismissed, clock: clock, send: {}, publish: { choice in
            if optimistic == nil { optimistic = choice }
        })
        #expect(optimistic?.optionID == FocusAnswer.dismissed)
        #expect(optimistic?.isSending == true)
        #expect(optimistic?.shown == FocusAnswer.dismissed)
        #expect(settled.optionID == FocusAnswer.dismissed)
        #expect(settled.failed == false)
        #expect(settled.shown == FocusAnswer.dismissed)
        #expect(clock.answerAppeared())
        expectAppearance(clock.trace, names: ["ApprovalState", "ApprovalFeedback"])
    }

    @Test func slowPublishExceedsBudget() async {
        let clock = ApprovalClock()
        _ = await ApprovalChoice.apply(optionID: "day", clock: clock, send: {}, publish: { _ in
            stall(.milliseconds(80))
        })
        #expect(clock.answerAppeared())
        #expect(clock.trace.meetsBudgets == false)
        let feedback = clock.trace.spans.first { $0.name == "ApprovalFeedback" }
        let state = clock.trace.spans.first { $0.name == "ApprovalState" }
        #expect(feedback?.withinBudget == false)
        #expect(state?.withinBudget == false)
        #expect((feedback?.duration ?? .zero) > InstantUI.feedbackBudget)
        #expect((state?.duration ?? .zero) > InstantUI.stateBudget)
    }

    @Test func staleTapExceedsBudget() async {
        let clock = ApprovalClock()
        let tap = ContinuousClock().now
        stall(.milliseconds(80))
        _ = await ApprovalChoice.apply(optionID: "day", tap: tap, clock: clock, send: {}, publish: { _ in })
        #expect(clock.answerAppeared())
        #expect(clock.trace.meetsBudgets == false)
        let feedback = clock.trace.spans.first { $0.name == "ApprovalFeedback" }
        let state = clock.trace.spans.first { $0.name == "ApprovalState" }
        #expect(feedback?.withinBudget == false)
        #expect(state?.withinBudget == false)
        #expect((feedback?.duration ?? .zero) > InstantUI.feedbackBudget)
        #expect((state?.duration ?? .zero) > InstantUI.stateBudget)
    }

    /// State must land inside 50 ms. Frame spans start at the tap, so a test hop can miss 16 ms;
    /// the stall tests cover that miss.
    private func expectAppearance(_ trace: SignpostTrace, names: [String], sourceLocation: SourceLocation = #_sourceLocation) {
        #expect(trace.spans.map(\.name) == names, sourceLocation: sourceLocation)
        for span in trace.spans {
            let budget = span.name == "ApprovalState" ? InstantUI.stateBudget : InstantUI.feedbackBudget
            #expect(span.budget == budget, sourceLocation: sourceLocation)
            #expect(span.duration > .zero, sourceLocation: sourceLocation)
        }
        let state = trace.spans.first { $0.name == "ApprovalState" }
        #expect(state?.withinBudget == true, sourceLocation: sourceLocation)
    }

    private func approvalClient(_ host: String) -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ApprovalProtocol.self]
        return APIClient(baseURL: URL(string: "http://\(host)")!, session: URLSession(configuration: config))
    }
}

private final class Gate: @unchecked Sendable {
    private let lock = NSLock()
    private var shown: ApprovalChoice?
    private var waiters: [CheckedContinuation<ApprovalChoice, Never>] = []
    private var holders: [CheckedContinuation<Void, Never>] = []
    private var starters: [CheckedContinuation<Void, Never>] = []
    private var open = false
    private var started = false

    func publish(_ choice: ApprovalChoice) {
        lock.lock()
        guard shown == nil, choice.isSending else {
            lock.unlock()
            return
        }
        shown = choice
        let pending = waiters
        waiters.removeAll()
        lock.unlock()
        for waiter in pending { waiter.resume(returning: choice) }
    }

    func optimistic() async -> ApprovalChoice {
        await withCheckedContinuation { continuation in
            lock.lock()
            if let shown {
                lock.unlock()
                continuation.resume(returning: shown)
            } else {
                waiters.append(continuation)
                lock.unlock()
            }
        }
    }

    func untilStarted() async {
        await withCheckedContinuation { continuation in
            lock.lock()
            if started {
                lock.unlock()
                continuation.resume()
            } else {
                starters.append(continuation)
                lock.unlock()
            }
        }
    }

    func hold() async {
        let pending = takeStarters()
        for starter in pending { starter.resume() }
        await withCheckedContinuation { continuation in
            lock.lock()
            if open {
                lock.unlock()
                continuation.resume()
            } else {
                holders.append(continuation)
                lock.unlock()
            }
        }
    }

    private func takeStarters() -> [CheckedContinuation<Void, Never>] {
        lock.lock()
        started = true
        let pending = starters
        starters.removeAll()
        lock.unlock()
        return pending
    }

    func release() {
        lock.lock()
        open = true
        let pending = holders
        holders.removeAll()
        lock.unlock()
        for holder in pending { holder.resume() }
    }
}

private final class ApprovalRoutes: @unchecked Sendable {
    struct Route {
        var status: Int
        var optionID: String?
    }

    private let lock = NSLock()
    private var routes: [String: Route] = [:]

    func add(status: Int) -> String {
        let host = "approval-\(UUID().uuidString.lowercased()).test"
        lock.withLock { routes[host] = Route(status: status) }
        return host
    }

    func optionID(for host: String) -> String? { lock.withLock { routes[host]?.optionID } }

    func setOption(_ optionID: String, for host: String) {
        lock.withLock { routes[host]?.optionID = optionID }
    }

    func status(for host: String) -> Int { lock.withLock { routes[host]?.status ?? 500 } }

    func remove(_ host: String) { lock.withLock { _ = routes.removeValue(forKey: host) } }
}

private final class ApprovalProtocol: URLProtocol {
    static let routes = ApprovalRoutes()

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host?.hasPrefix("approval-") == true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let host = url.host else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        if let answer = try? JSONDecoder().decode(FocusAnswer.self, from: requestBody(request)) {
            Self.routes.setOption(answer.optionID, for: host)
        }
        let status = Self.routes.status(for: host)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        let payload = status == 200 ? Data("{\"posted\":true}".utf8) : Data("{\"message\":\"unavailable\"}".utf8)
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: payload)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private func stall(_ duration: Duration) {
    let clock = ContinuousClock()
    let start = clock.now
    while start.duration(to: clock.now) < duration {}
}

private func requestBody(_ request: URLRequest) -> Data {
    var body = request.httpBody ?? Data()
    if body.isEmpty, let stream = request.httpBodyStream {
        stream.open()
        defer { stream.close() }
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            body.append(contentsOf: buffer.prefix(count))
        }
    }
    return body
}
