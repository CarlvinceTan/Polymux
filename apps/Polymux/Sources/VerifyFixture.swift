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

    private static var toolEvents: [Event] {
        let date = "2026-10-14T12:00:00Z"
        let tools = [
            ToolActivity(id: "bash", runID: "tool-run", name: "bash", status: "completed",
                         summary: "go test ./...", output: "ok polymux 0.2s"),
            ToolActivity(id: "read-1", runID: "tool-run", name: "read", status: "completed", summary: "one.swift"),
            ToolActivity(id: "read-2", runID: "tool-run", name: "read", status: "completed", summary: "two.swift"),
            ToolActivity(id: "read-3", runID: "tool-run", name: "read", status: "completed", summary: "three.swift"),
            ToolActivity(id: "edit", runID: "tool-run", name: "edit", status: "completed", summary: "ChatPane.swift"),
            ToolActivity(id: "failed", runID: "tool-run", name: "bash", status: "failed",
                         summary: "false", output: "Command exited with status 1\n[redacted]")
        ]
        let run = Run(id: "tool-run", conversationID: "t-chief", trigger: "message", tools: tools,
                      attempt: 1, seq: 1, createdAt: date, updatedAt: date, activity: "generating",
                      agentID: "t-chief", status: "completed", summary: "Checked the project")
        let message = Message(runID: run.id, id: "tool-message", threadID: "t-chief", role: "assistant",
                              parts: [Part(kind: "text", text: "Checked the project and edited ChatPane.swift.")],
                              createdAt: date, status: "completed", seq: 2, agentID: "t-chief")
        return [Event(seq: 1, conversationID: "t-chief", type: "run.done", createdAt: date, run: run),
                Event(seq: 2, conversationID: "t-chief", type: "message.done", message: message, createdAt: date)]
    }

    static func failAnswers() { answers.fail() }

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VerifyFixture.self]
        return URLSession(configuration: configuration)
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if CommandLine.arguments.contains("--verify-tools"), request.url?.lastPathComponent == "stream" {
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                           headerFields: ["Content-Type": "text/event-stream"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(": connected\n\n".utf8))
            return
        }
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
                let theme = CommandLine.arguments.contains("--verify-tools")
                    ? (CommandLine.arguments.contains("--tools-dark") ? "dark" : "light") : "system"
                data = try JSONEncoder().encode(Settings(appearance: theme, sidebarWidth: 360))
            case "events" where CommandLine.arguments.contains("--verify-tools"):
                let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
                let after = Int64(query?.first { $0.name == "after" }?.value ?? "0") ?? 0
                let events = request.url!.path.contains("/t-chief/") ? Self.toolEvents.filter { $0.seq > after } : []
                data = try JSONEncoder().encode(events)
            default: data = Data("{}".utf8)
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
