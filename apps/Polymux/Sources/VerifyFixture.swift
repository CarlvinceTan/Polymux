#if DEBUG
import Foundation
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
    static func prompt(_ name: String) -> String { "\(name) keeps the workspace on track and reports back." }
    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VerifyFixture.self]
        return URLSession(configuration: configuration)
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let data: Data
            if let agent = Self.agents.first(where: { $0.id == request.url?.lastPathComponent }) {
                // The profile editors load an AgentProfile, not an empty object, in UI checks.
                data = try JSONEncoder().encode(AgentProfile(agent: agent, prompt: Self.prompt(agent.name)))
            } else {
                switch request.url?.lastPathComponent {
                case "agents": data = try JSONEncoder().encode(Self.agents)
                case "threads": data = try JSONEncoder().encode(Self.threads)
                case "settings": data = try JSONEncoder().encode(Settings(appearance: "system", sidebarWidth: 360))
                default: data = Data("{}".utf8)
                }
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                           headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
#endif
