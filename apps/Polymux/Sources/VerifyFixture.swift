#if DEBUG
import Foundation
import SwiftUI
import PolymuxKit

// Only the explicit UI-test launch uses this isolated, deterministic transport.
final class VerifyFixture: URLProtocol, @unchecked Sendable {
    static var enabled: Bool { CommandLine.arguments.contains("--verify-fixture") }
    static var local: Bool { enabled && UserDefaults.standard.string(forKey: "PolymuxServer") == nil }
    static let ids = ["t-chief", "t-aria", "t-milo", "t-nova", "t-long", "t-stream", "t-approval",
                      "grp-trip", "t-media", "t-activity", "t-fern", "grp-empty"]
    static let agents = ["Chief", "Aria", "Milo", "Nova", "Approval", "Fern"].map {
        Agent(id: "t-" + $0.lowercased(), name: $0, active: true)
    }
    static let threads = ids.map { id in
        let direct = agents.first { $0.id == id }
        let members: [String]
        switch id {
        case "t-long": members = ["t-chief", "t-aria"]
        case "t-stream", "grp-empty": members = ["t-nova", "t-fern"]
        case "grp-trip": members = ["t-chief", "t-aria", "t-milo"]
        case "t-media": members = ["t-aria", "t-milo"]
        case "t-activity": members = ["t-chief", "t-milo"]
        default: members = [id]
        }
        return PolymuxKit.Thread(id: id, agentID: members[0], title: direct == nil ? id : "",
                                 agentIDs: members)
    }
    private static let answers = Answers()

    static func failAnswers() { answers.fail() }

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VerifyFixture.self]
        return URLSession(configuration: configuration)
    }
    static let activity: [Event] = {
        let thread = "t-activity"
        let at = "2026-10-13T12:00:00Z"
        let message = Message(id: "fixture-request", threadID: thread, role: "user",
                              parts: [Part(kind: "text", text: "Review the release and remember the rollout plan.")],
                              createdAt: at, status: "done", seq: 1)
        let rows = [
            Activity(kind: "tool.called", verb: "Checked", objectLabel: "release status", iconOrAgentID: "terminal", at: at),
            Activity(kind: "agent.messaged", verb: "Messaged", at: at, agentIDs: ["t-chief", "t-milo"]),
            Activity(kind: "tool.called", verb: "Searched", iconOrAgentID: "magnifyingglass", at: at),
            Activity(kind: "tool.called", verb: "Searched", iconOrAgentID: "magnifyingglass", at: at),
            Activity(kind: "tool.called", verb: "Searched", iconOrAgentID: "magnifyingglass", at: at),
            Activity(kind: "memory.created", verb: "Saved", objectID: "rollout-plan", objectLabel: "Rollout plan", at: at)
        ]
        return [Event(seq: 1, conversationID: thread, type: "message.done", message: message, createdAt: at)]
            + rows.enumerated().map { index, row in
                Event(seq: Int64(index + 2), conversationID: thread, type: "activity", agentID: "t-chief",
                      createdAt: at, payload: row)
            }
    }()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.url?.lastPathComponent == "answer" {
            Self.answers.add(self)
            return
        }
        do {
            let data: Data
            switch request.url?.lastPathComponent {
            case "agents": data = try JSONEncoder().encode(Self.agents)
            case "threads": data = try JSONEncoder().encode(Self.threads)
            case "settings":
                let theme = CommandLine.arguments.contains("--verify-dark") ? "dark" : "light"
                data = try JSONEncoder().encode(Settings(appearance: theme, sidebarWidth: 360))
            case "messages": data = try JSONEncoder().encode([Message]())
            case "events":
                let after = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?
                    .first { $0.name == "after" }?.value.flatMap(Int64.init) ?? 0
                let seeded = request.url?.path.contains("/t-activity/") == true ? Self.activity : []
                data = try JSONEncoder().encode(seeded.filter { $0.seq > after })
            default:
                data = request.url?.path.contains("/activity/") == true
                    ? try JSONEncoder().encode(["text": "Rollout plan: verify the release before enabling the routine."])
                    : Data("{}".utf8)
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                           headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { Self.answers.remove(self) }

    private func fail() {
        client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
    }

    private final class Answers: @unchecked Sendable {
        private let lock = NSLock()
        private var pending: [VerifyFixture] = []
        private var failed = false

        func add(_ fixture: VerifyFixture) {
            let fail = lock.withLock {
                if failed { return true }
                pending.append(fixture)
                return false
            }
            if fail { fixture.fail() }
        }

        func remove(_ fixture: VerifyFixture) {
            lock.withLock { pending.removeAll { $0 === fixture } }
        }

        func fail() {
            let requests = lock.withLock {
                failed = true
                defer { pending.removeAll() }
                return pending
            }
            for request in requests { request.fail() }
        }
    }
}

struct ApprovalFixture: View {
    @Environment(\.colorScheme) private var scheme
    private let part = Part(kind: "focus", question: "What should we focus on today?", options: [
        ChoiceOption(id: "day", label: "Plan my day"),
        ChoiceOption(id: "code", label: "Build something")
    ])
    private let client = APIClient(baseURL: URL(string: "http://approval.invalid")!,
                                   session: VerifyFixture.session(), token: "")

    var body: some View {
        VStack(spacing: 16) {
            FocusCard(part: part, client: client, agentID: "t-approval", bubble: BubbleStyle.incoming(scheme))
            Button("Fail answer") { VerifyFixture.failAnswers() }
                .accessibilityValue(scheme == .dark ? "dark" : "light")
        }
            .frame(maxWidth: 340)
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .neutralBackground()
            .preferredColorScheme(CommandLine.arguments.contains("--approval-dark") ? .dark : .light)
    }
}
#endif
