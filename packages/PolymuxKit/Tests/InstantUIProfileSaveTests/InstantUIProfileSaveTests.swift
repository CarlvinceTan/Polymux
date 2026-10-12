import Foundation
import Testing

/// Press-to-paint budgets for a profile or avatar save. Feedback has to land on
/// the same frame, and the new value has to be visible before any server reply.
private let feedbackBudget: Duration = .milliseconds(16)
private let stateBudget: Duration = .milliseconds(50)

private enum Mark: Equatable {
    case begin(String)
    case event(String)
    case end(String)
}

@MainActor
private final class SignpostTrace {
    private let clock = ContinuousClock()
    private let opened: ContinuousClock.Instant
    private(set) var marks: [(Mark, Duration)] = []

    init() { opened = ContinuousClock.now }

    func begin(_ name: String) { marks.append((.begin(name), elapsed)) }
    func event(_ name: String) { marks.append((.event(name), elapsed)) }
    func end(_ name: String) { marks.append((.end(name), elapsed)) }

    private var elapsed: Duration { opened.duration(to: clock.now) }

    func meetsBudgets(save: String, sync: String) throws {
        let state = try time(of: .event("StateVisible"))
        let closed = try time(of: .event("SheetClosed"))
        let saveEnd = try time(of: .end(save))
        let syncBegin = try time(of: .begin(sync))
        #expect(state <= stateBudget)
        #expect(closed <= feedbackBudget)
        #expect(saveEnd <= feedbackBudget)
        #expect(syncBegin >= saveEnd)
        #expect(index(of: .begin(save)) < index(of: .event("StateVisible")))
        #expect(index(of: .event("StateVisible")) < index(of: .event("SheetClosed")))
        #expect(index(of: .event("SheetClosed")) < index(of: .end(save)))
        #expect(index(of: .end(save)) < index(of: .begin(sync)))
    }

    private func time(of mark: Mark) throws -> Duration {
        try #require(marks.first { $0.0 == mark }?.1)
    }

    private func index(of mark: Mark) -> Int {
        marks.firstIndex { $0.0 == mark } ?? -1
    }
}

@MainActor
private final class ProfileHarness {
    var name: String
    var open = true
    var notice: String?
    let trace = SignpostTrace()
    private var settled = false
    private var waiter: CheckedContinuation<Void, Never>?

    init(name: String) { self.name = name }

    func press(next: String, sync: @escaping @MainActor () async throws -> Void) {
        let previous = name
        trace.begin("ProfileSave")
        name = next
        trace.event("StateVisible")
        open = false
        trace.event("SheetClosed")
        trace.end("ProfileSave")
        Task {
            trace.begin("ProfileSync")
            do {
                try await sync()
                trace.end("ProfileSync")
            } catch {
                name = previous
                trace.event("RolledBack")
                trace.end("ProfileSync")
                notice = "The previous profile is restored."
            }
            settle()
        }
    }

    func saw(_ mark: Mark) async {
        for _ in 0..<1000 {
            if trace.marks.contains(where: { $0.0 == mark }) { return }
            await Task.yield()
        }
    }

    func finished() async {
        await withCheckedContinuation { continuation in
            if settled { continuation.resume() }
            else { waiter = continuation }
        }
    }

    private func settle() {
        settled = true
        waiter?.resume()
        waiter = nil
    }
}

@MainActor
private final class AvatarHarness {
    var design: String
    var open = true
    var notice: String?
    let trace = SignpostTrace()
    private var settled = false
    private var waiter: CheckedContinuation<Void, Never>?

    init(design: String) { self.design = design }

    func press(next: String, sync: @escaping @MainActor () async throws -> Void) {
        let previous = design
        trace.begin("AvatarSave")
        design = next
        trace.event("StateVisible")
        open = false
        trace.event("SheetClosed")
        trace.end("AvatarSave")
        Task {
            trace.begin("AvatarSync")
            do {
                try await sync()
                trace.end("AvatarSync")
            } catch {
                design = previous
                trace.event("RolledBack")
                trace.end("AvatarSync")
                notice = "The previous avatar is restored."
            }
            settle()
        }
    }

    func saw(_ mark: Mark) async {
        for _ in 0..<1000 {
            if trace.marks.contains(where: { $0.0 == mark }) { return }
            await Task.yield()
        }
    }

    func finished() async {
        await withCheckedContinuation { continuation in
            if settled { continuation.resume() }
            else { waiter = continuation }
        }
    }

    private func settle() {
        settled = true
        waiter?.resume()
        waiter = nil
    }
}

private struct ForcedFailure: Error {}

@Suite("InstantUIProfileSave", .serialized)
@MainActor
struct InstantUIProfileSave {
    @Test func signpostTraceMeetsBudgets() async throws {
        let profile = ProfileHarness(name: "Ada")
        let avatar = AvatarHarness(design: "circle")
        let hold = Hold()
        profile.press(next: "Nova") { await hold.wait() }
        avatar.press(next: "square") { await hold.wait() }
        #expect(!profile.open)
        #expect(profile.name == "Nova")
        #expect(!avatar.open)
        #expect(avatar.design == "square")
        await profile.saw(.begin("ProfileSync"))
        await avatar.saw(.begin("AvatarSync"))
        try profile.trace.meetsBudgets(save: "ProfileSave", sync: "ProfileSync")
        try avatar.trace.meetsBudgets(save: "AvatarSave", sync: "AvatarSync")
        hold.release()
        await profile.finished()
        await avatar.finished()
        #expect(profile.notice == nil)
        #expect(avatar.notice == nil)
    }

    @Test func forcedFailureRollsBackProfile() async throws {
        let profile = ProfileHarness(name: "Ada")
        profile.press(next: "Nova") { throw ForcedFailure() }
        #expect(!profile.open)
        #expect(profile.name == "Nova")
        await profile.finished()
        try profile.trace.meetsBudgets(save: "ProfileSave", sync: "ProfileSync")
        #expect(profile.name == "Ada")
        #expect(profile.notice?.contains("restored") == true)
        #expect(!profile.open)
        #expect(profile.trace.marks.contains { $0.0 == .event("RolledBack") })
    }

    @Test func forcedFailureRollsBackAvatar() async throws {
        let avatar = AvatarHarness(design: "circle")
        avatar.press(next: "square") { throw ForcedFailure() }
        #expect(!avatar.open)
        #expect(avatar.design == "square")
        await avatar.finished()
        try avatar.trace.meetsBudgets(save: "AvatarSave", sync: "AvatarSync")
        #expect(avatar.design == "circle")
        #expect(avatar.notice?.contains("restored") == true)
        #expect(!avatar.open)
        #expect(avatar.trace.marks.contains { $0.0 == .event("RolledBack") })
    }

    @Test func editorsCloseBeforeTheServerWrite() throws {
        let root = sourceRoot()
        let agent = try String(contentsOf: root.appending(path: "apps/Polymux/Sources/Views/AgentEditor.swift"), encoding: .utf8)
        let avatar = try String(contentsOf: root.appending(path: "apps/Polymux/Sources/Avatar/AvatarEditor.swift"), encoding: .utf8)
        let save = try function(agent, "save()")
        let sync = try function(agent, "syncProfile(")
        let finish = try function(avatar, "finish()")
        let avatarSync = try function(avatar, "syncAvatar(")
        try closesBeforeNetwork(save, request: "updateAgent")
        try closesBeforeNetwork(finish, request: "commit(")
        #expect(sync.contains("accept(previous)"))
        #expect(sync.contains("The previous profile is restored"))
        #expect(avatarSync.contains("set(baseline"))
        #expect(avatarSync.contains("The previous avatar is restored"))
        #expect(!agent.contains("ProgressView("))
        #expect(!avatar.contains("ProgressView("))
        #expect(!agent.contains("interactiveDismissDisabled"))
        #expect(!avatar.contains("interactiveDismissDisabled"))
        #expect(agent.contains("Loading profile") == false)
    }
}

@MainActor
private final class Hold {
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var released = false

    func wait() async {
        if released { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func release() {
        released = true
        let pending = waiters
        waiters.removeAll()
        pending.forEach { $0.resume() }
    }
}

private func sourceRoot() -> URL {
    var url = URL(fileURLWithPath: #filePath)
    while url.path != "/" {
        let marker = url.appending(path: "apps/Polymux/Sources/Views/AgentEditor.swift")
        if FileManager.default.fileExists(atPath: marker.path) { return url }
        url.deleteLastPathComponent()
    }
    return URL(fileURLWithPath: "/workspace")
}

private func function(_ source: String, _ name: String) throws -> String {
    let start = try #require(source.range(of: "func \(name)"))
    let rest = source[start.lowerBound...]
    let end = try #require(rest.range(of: "\n}\n"))
    return String(rest[..<end.upperBound])
}

private func closesBeforeNetwork(_ body: String, request: String) throws {
    let state = try #require(body.range(of: "StateVisible"))
    let closed = try #require(body.range(of: "SheetClosed"))
    let dismiss = try #require(body.range(of: "dismiss()"))
    #expect(state.lowerBound < dismiss.lowerBound)
    #expect(dismiss.lowerBound < closed.lowerBound)
    #expect(!body.contains("await"))
    #expect(!body.contains(request))
}
