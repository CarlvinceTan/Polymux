import Foundation

/// The server and every device paired with it.
public struct NetworkInfo: Codable, Sendable {
    public struct Server: Codable, Sendable {
        public let name: String
        public let build: String
        public let platform: String
        public let role: String
    }

    public struct Device: Codable, Sendable, Identifiable {
        public let id: String
        public let name: String
        public let agent: String
        public let capabilities: [String]
        public let revoked: Bool
        public let connected: Bool
        public let ready: [String]
    }

    public let server: Server
    public let devices: [Device]
}

