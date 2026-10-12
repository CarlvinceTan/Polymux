import Foundation
import Testing
@testable import PolymuxKit

@Suite @MainActor
struct InstantUIOptimisticToggle {
    @Test func bindingAppliesBeforeTheConfirm() async {
        let toggle = OptimisticToggle(isOn: false)
        let gate = Gate()
        let choice = toggle.binding { _ in await gate.wait() }
        choice.set(true)
        #expect(choice.get())
        #expect(choice.isEnabled())
        #expect(toggle.isPending)
        #expect(toggle.signpostTrace == ["apply true"])
        expectBudgets(toggle.trace, names: ["apply"])
        gate.open()
        await toggle.settled()
        #expect(choice.get())
        #expect(toggle.signpostTrace == ["apply true", "commit true"])
        expectBudgets(toggle.trace, names: ["apply", "commit"])
        #expect(toggle.message == nil)
        #expect(!toggle.isPending)
    }

    @Test func signpostTraceRecordsApplyThenCommit() async {
        let toggle = OptimisticToggle(isOn: true)
        toggle.binding { _ in }.set(false)
        #expect(toggle.signposts == [.apply(false)])
        await toggle.settled()
        #expect(toggle.signposts == [.apply(false), .commit(false)])
        #expect(toggle.signpostTrace == ["apply false", "commit false"])
        expectBudgets(toggle.trace, names: ["apply", "commit"])
    }

    @Test func forcedFailureRollsBackWithMessage() async {
        let toggle = OptimisticToggle(isOn: false)
        let choice = toggle.binding { _ in
            throw ToggleFailure("Couldn’t update background reviews.")
        }
        choice.set(true)
        #expect(choice.get())
        await toggle.settled()
        #expect(!choice.get())
        #expect(toggle.message == "Couldn’t update background reviews.")
        #expect(choice.isEnabled())
        #expect(toggle.signposts == [.apply(true), .rollback(false, "Couldn’t update background reviews.")])
        expectBudgets(toggle.trace, names: ["apply", "rollback"])
    }

    @Test func failureLeavesTheControlEnabled() async {
        let toggle = OptimisticToggle(isOn: true)
        let gate = Gate()
        let choice = toggle.binding { _ in
            await gate.wait()
            throw ToggleFailure("Couldn’t update notification permission.")
        }
        choice.set(false)
        #expect(choice.isEnabled())
        #expect(toggle.isPending)
        gate.open()
        await toggle.settled()
        #expect(choice.get())
        #expect(choice.isEnabled())
        #expect(!toggle.isPending)
        #expect(toggle.message == "Couldn’t update notification permission.")
    }

    @Test func signpostTraceRecordsApplyThenRollback() async {
        let toggle = OptimisticToggle(isOn: false)
        toggle.binding { _ in
            throw ToggleFailure("Couldn’t change background control. Check Login Items in System Settings.")
        }.set(true)
        await toggle.settled()
        #expect(toggle.signpostTrace == [
            "apply true",
            "rollback false Couldn’t change background control. Check Login Items in System Settings."
        ])
        expectBudgets(toggle.trace, names: ["apply", "rollback"])
        #expect(toggle.isEnabled)
    }

    @Test func slowPublishFailsTheBudgetCheck() async throws {
        let toggle = OptimisticToggle(isOn: false)
        let choice = toggle.binding(apply: { _ in block(for: .milliseconds(80)) }) { _ in
            throw ToggleFailure("Couldn’t update background reviews.")
        }
        choice.set(true)
        let apply = try #require(toggle.trace.spans.first { $0.name == "apply" })
        #expect(apply.budget == InstantUI.feedbackBudget)
        #expect(apply.duration > InstantUI.stateBudget)
        #expect(!apply.withinBudget)
        #expect(!toggle.trace.meetsBudgets)
        await toggle.settled()
        let rollback = try #require(toggle.trace.spans.first { $0.name == "rollback" })
        #expect(rollback.budget == InstantUI.feedbackBudget)
        #expect(rollback.duration > InstantUI.stateBudget)
        #expect(!rollback.withinBudget)
        #expect(!toggle.trace.meetsBudgets)
        #expect(!toggle.isOn)
    }

    @Test func emptyFailureUsesAClearMessage() async {
        let toggle = OptimisticToggle(isOn: false)
        toggle.set(true) { _ in throw BlankError() }
        await toggle.settled()
        #expect(!toggle.isOn)
        #expect(toggle.message == "Couldn’t save this change.")
        #expect(toggle.isEnabled)
    }

    @Test func staleFailureDoesNotUndoANewerFlip() async {
        let toggle = OptimisticToggle(isOn: false)
        let entered = Gate()
        let release = Gate()
        var stored = false
        toggle.set(true, apply: { stored = $0 }) { _ in
            entered.open()
            await release.wait()
            throw ToggleFailure("stale")
        }
        for _ in 0..<50 where !entered.opened { await Task.yield() }
        #expect(entered.opened)
        #expect(stored)
        toggle.set(false, apply: { stored = $0 }) { _ in }
        toggle.set(true, apply: { stored = $0 }) { _ in }
        #expect(toggle.isOn)
        #expect(stored)
        release.open()
        await toggle.settled()
        #expect(toggle.isOn)
        #expect(stored)
        #expect(toggle.message == nil)
        #expect(toggle.isEnabled)
        #expect(toggle.signpostTrace == ["apply true", "apply false", "apply true", "commit true"])
    }

    @Test func successClearsThePreviousMessage() async {
        let toggle = OptimisticToggle(isOn: false)
        toggle.binding { _ in throw ToggleFailure("Couldn’t update background reviews.") }.set(true)
        await toggle.settled()
        #expect(toggle.message == "Couldn’t update background reviews.")
        let choice = toggle.binding { _ in }
        choice.set(true)
        #expect(toggle.message == nil)
        #expect(choice.get())
        await toggle.settled()
        #expect(choice.get())
        #expect(toggle.message == nil)
        #expect(toggle.signpostTrace == [
            "apply true",
            "rollback false Couldn’t update background reviews.",
            "apply true",
            "commit true"
        ])
        expectBudgets(toggle.trace, names: ["apply", "rollback", "apply", "commit"])
    }

    @Test func sideEffectRollsBackWithTheValue() async {
        let toggle = OptimisticToggle(isOn: false)
        var stored = false
        toggle.binding(apply: { stored = $0 }) { _ in
            throw ToggleFailure("Couldn’t update background reviews.")
        }.set(true)
        #expect(stored)
        #expect(toggle.isOn)
        await toggle.settled()
        #expect(!stored)
        #expect(!toggle.isOn)
        #expect(toggle.message == "Couldn’t update background reviews.")
    }

    @Test func loadedValueIsAdoptedWhenIdle() {
        let toggle = OptimisticToggle(isOn: false)
        toggle.adopt(true)
        #expect(toggle.isOn)
        #expect(toggle.signposts.isEmpty)
        #expect(toggle.isEnabled)
    }

    @Test func adoptWaitsUntilTheWriteFinishes() async {
        let toggle = OptimisticToggle(isOn: false)
        let gate = Gate()
        toggle.set(true) { _ in await gate.wait() }
        toggle.adopt(false)
        #expect(toggle.isOn)
        #expect(toggle.isEnabled)
        gate.open()
        await toggle.settled()
        #expect(toggle.isOn)
        toggle.adopt(false)
        #expect(!toggle.isOn)
        #expect(toggle.message == nil)
    }

    @Test func sameValueDoesNotStartAnotherWrite() async {
        let toggle = OptimisticToggle(isOn: false)
        var writes = 0
        let choice = toggle.binding { _ in writes += 1 }
        choice.set(false)
        choice.set(true)
        await toggle.settled()
        choice.set(true)
        await toggle.settled()
        #expect(writes == 1)
        #expect(toggle.signpostTrace == ["apply true", "commit true"])
        #expect(choice.isEnabled())
    }

    private func expectBudgets(_ trace: SignpostTrace, names: [String], sourceLocation: SourceLocation = #_sourceLocation) {
        #expect(InstantUI.feedbackBudget == .milliseconds(16), sourceLocation: sourceLocation)
        #expect(InstantUI.stateBudget == .milliseconds(50), sourceLocation: sourceLocation)
        #expect(trace.spans.map(\.name) == names, sourceLocation: sourceLocation)
        #expect(trace.meetsBudgets, sourceLocation: sourceLocation)
        for span in trace.spans {
            let budget = span.name == "commit" ? InstantUI.stateBudget : InstantUI.feedbackBudget
            #expect(span.budget == budget, "\(span.name)", sourceLocation: sourceLocation)
            #expect(span.duration < InstantUI.stateBudget, "\(span.name)", sourceLocation: sourceLocation)
            if span.name != "commit" {
                #expect(span.duration < InstantUI.feedbackBudget, "\(span.name)", sourceLocation: sourceLocation)
            }
            #expect(span.withinBudget, sourceLocation: sourceLocation)
        }
    }
}

private func block(for duration: Duration) {
    let clock = ContinuousClock()
    let start = clock.now
    while start.duration(to: clock.now) < duration {}
}

private struct BlankError: LocalizedError {
    var errorDescription: String? { "" }
}

private final class Gate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var opened = false

    func wait() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            lock.lock()
            if opened {
                lock.unlock()
                continuation.resume()
                return
            }
            self.continuation = continuation
            lock.unlock()
        }
    }

    func open() {
        lock.lock()
        opened = true
        let continuation = continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume()
    }
}
