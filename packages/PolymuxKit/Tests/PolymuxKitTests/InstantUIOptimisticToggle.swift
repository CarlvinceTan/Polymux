import Foundation
import Observation
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
        #expect(toggle.isPending)
        #expect(toggle.signpostTrace == ["apply true"])
        expectBudgets(toggle.trace, names: ["apply"])
        gate.open()
        await toggle.settled()
        #expect(choice.get())
        #expect(toggle.signpostTrace == ["apply true", "commit true"])
        expectBudgets(toggle.trace, names: ["apply"])
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
        expectBudgets(toggle.trace, names: ["apply"])
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
        #expect(toggle.signposts == [.apply(true), .rollback(false, "Couldn’t update background reviews.")])
        expectBudgets(toggle.trace, names: ["apply", "rollback"])
    }

    @Test func failureWhilePendingStillRollsBack() async {
        let toggle = OptimisticToggle(isOn: true)
        let gate = Gate()
        let choice = toggle.binding { _ in
            await gate.wait()
            throw ToggleFailure("Couldn’t update notification permission.")
        }
        choice.set(false)
        #expect(toggle.isPending)
        gate.open()
        await toggle.settled()
        #expect(choice.get())
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
        expectBudgets(toggle.trace, names: ["apply", "rollback", "apply"])
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
    }

    @Test func adoptWaitsUntilTheWriteFinishes() async {
        let toggle = OptimisticToggle(isOn: false)
        let gate = Gate()
        toggle.set(true) { _ in await gate.wait() }
        toggle.adopt(false)
        #expect(toggle.isOn)
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
    }

    @Test func applyPublishIsObserved() async {
        let toggle = OptimisticToggle(isOn: false)
        let observed = Gate()
        observe(toggle) { observed.open() }
        let release = Gate()
        toggle.set(true) { _ in await release.wait() }
        for _ in 0..<20 where !observed.opened { await Task.yield() }
        #expect(observed.opened)
        #expect(toggle.isOn)
        release.open()
        await toggle.settled()
        expectBudgets(toggle.trace, names: ["apply"])
    }

    @Test func successDoesNotRepublishTheSwitch() async {
        let toggle = OptimisticToggle(isOn: false)
        let release = Gate()
        toggle.set(true) { _ in await release.wait() }
        let observed = Gate()
        observe(toggle) { observed.open() }
        release.open()
        await toggle.settled()
        for _ in 0..<20 { await Task.yield() }
        #expect(!observed.opened)
        #expect(toggle.signposts.contains(.commit(true)))
        expectBudgets(toggle.trace, names: ["apply"])
    }

    @Test func rollbackPublishIsObserved() async {
        let toggle = OptimisticToggle(isOn: false)
        let release = Gate()
        toggle.set(true) { _ in
            await release.wait()
            throw ToggleFailure("Allow notifications in system settings.")
        }
        let observed = Gate()
        observe(toggle) { observed.open() }
        release.open()
        await toggle.settled()
        for _ in 0..<20 where !observed.opened { await Task.yield() }
        #expect(observed.opened)
        #expect(!toggle.isOn)
        #expect(toggle.message == "Allow notifications in system settings.")
    }

    @Test func toggleMessageHidesTheSourceIssue() {
        let rollback = "Couldn’t change background control. Check Login Items in System Settings."
        #expect(toggleIssue(rollback, "Pairing wasn’t completed.") == rollback)
        #expect(toggleIssue(nil, "Allow notifications in system settings.") == "Allow notifications in system settings.")
        #expect(toggleIssue(nil, nil) == nil)
    }

    private func observe(_ toggle: OptimisticToggle, _ change: @escaping @Sendable () -> Void) {
        withObservationTracking {
            MainActor.assumeIsolated {
                _ = toggle.isOn
                _ = toggle.message
            }
        } onChange: {
            change()
        }
    }

    private func expectBudgets(_ trace: SignpostTrace, names: [String], sourceLocation: SourceLocation = #_sourceLocation) {
        #expect(InstantUI.feedbackBudget == .milliseconds(16), sourceLocation: sourceLocation)
        #expect(InstantUI.stateBudget == .milliseconds(50), sourceLocation: sourceLocation)
        #expect(trace.spans.map(\.name) == names, sourceLocation: sourceLocation)
        #expect(trace.meetsBudgets, sourceLocation: sourceLocation)
        for span in trace.spans {
            #expect(span.budget == InstantUI.feedbackBudget, "\(span.name)", sourceLocation: sourceLocation)
            #expect(span.duration < InstantUI.feedbackBudget, "\(span.name)", sourceLocation: sourceLocation)
            #expect(span.withinBudget, sourceLocation: sourceLocation)
        }
    }
}

@Suite @MainActor
struct OptimisticRemovalTests {
    @Test func removalDropsTheRowBeforeConfirm() async {
        let removal = OptimisticRemoval()
        var items = ["a", "b"]
        let gate = Gate()
        removal.remove("a", apply: { items.removeAll { $0 == "a" } }, restore: { items.insert("a", at: 0) }) {
            await gate.wait()
        }
        #expect(items == ["b"])
        #expect(removal.message == nil)
        gate.open()
        await removal.settled()
        #expect(items == ["b"])
        #expect(removal.message == nil)
        #expect(removal.trace.spans.map(\.name) == ["apply"])
    }

    @Test func failedRemovalRestoresTheRowAndOneMessage() async {
        let removal = OptimisticRemoval()
        var items = ["a", "b"]
        removal.remove("a", apply: { items.removeAll { $0 == "a" } }, restore: { items.insert("a", at: 0) }) {
            throw ToggleFailure("Couldn’t cancel this routine.")
        }
        #expect(items == ["b"])
        await removal.settled()
        #expect(items == ["a", "b"])
        #expect(removal.message == "Couldn’t cancel this routine.")
        #expect(removal.trace.spans.map(\.name) == ["apply", "rollback"])
        #expect(removal.trace.meetsBudgets)
    }

    @Test func staleFailureDoesNotRestoreANewerRemoval() async {
        let removal = OptimisticRemoval()
        var items = ["a"]
        let entered = Gate()
        let release = Gate()
        removal.remove("a", apply: { items.removeAll { $0 == "a" } }, restore: { items.append("a") }) {
            entered.open()
            await release.wait()
            throw ToggleFailure("stale")
        }
        for _ in 0..<50 where !entered.opened { await Task.yield() }
        #expect(items.isEmpty)
        removal.remove("a", apply: { items.removeAll { $0 == "a" } }, restore: { items.append("a") }) { }
        release.open()
        await removal.settled()
        #expect(items.isEmpty)
        #expect(removal.message == nil)
    }

    @Test func slowRemovalMissesTheBudget() async throws {
        let removal = OptimisticRemoval()
        removal.remove("a", apply: { block(for: .milliseconds(80)) }, restore: { block(for: .milliseconds(80)) }) {
            throw ToggleFailure("Couldn’t cancel this routine.")
        }
        let apply = try #require(removal.trace.spans.first { $0.name == "apply" })
        #expect(apply.budget == InstantUI.feedbackBudget)
        #expect(!apply.withinBudget)
        await removal.settled()
        let rollback = try #require(removal.trace.spans.first { $0.name == "rollback" })
        #expect(rollback.budget == InstantUI.feedbackBudget)
        #expect(!rollback.withinBudget)
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
