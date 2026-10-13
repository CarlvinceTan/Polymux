#if DEBUG
import Foundation
import PolymuxKit

// Only the explicit UI-test launch uses this isolated, deterministic transport.
final class VerifyFixture: URLProtocol, @unchecked Sendable {
    static var enabled: Bool { CommandLine.arguments.contains("--verify-fixture") }
    static let ids = ["t-chief", "t-aria", "t-milo", "t-nova", "t-long", "t-stream", "t-approval",
                      "grp-trip", "t-media", "t-activity", "t-fern", "grp-empty"]
    static let agents = ["Chief", "Aria", "Milo", "Nova", "Approval", "Fern"].map {
        Agent(id: $0.lowercased(), name: $0, active: true)
    }
    static let threads = ids.enumerated().map { index, id in
        let agent = agents[index % agents.count]
        return PolymuxKit.Thread(id: id, agentID: id.hasPrefix("grp-") ? "" : agent.id,
                                 title: id, agentIDs: id.hasPrefix("grp-") ? [agents[0].id, agents[1].id] : [agent.id])
    }
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
            switch request.url?.lastPathComponent {
            case "agents": data = try JSONEncoder().encode(Self.agents)
            case "threads": data = try JSONEncoder().encode(Self.threads)
            case "settings": data = try JSONEncoder().encode(Settings(appearance: "system", sidebarWidth: 360))
            default: data = Data("{}".utf8)
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
