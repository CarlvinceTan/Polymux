import Foundation

public enum WireValue: Codable, Sendable, Equatable {
    case string(String), number(Double), bool(Bool), array([WireValue]), object([String: WireValue]), null

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let v = try? value.decode(Bool.self) { self = .bool(v) }
        else if let v = try? value.decode(String.self) { self = .string(v) }
        else if let v = try? value.decode(Double.self) { self = .number(v) }
        else if let v = try? value.decode([WireValue].self) { self = .array(v) }
        else { self = .object(try value.decode([String: WireValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .string(let v): try value.encode(v)
        case .number(let v): try value.encode(v)
        case .bool(let v): try value.encode(v)
        case .array(let v): try value.encode(v)
        case .object(let v): try value.encode(v)
        case .null: try value.encodeNil()
        }
    }

    public subscript(_ key: String) -> WireValue? { if case .object(let v) = self { return v[key] }; return nil }
    public var string: String? { if case .string(let v) = self { return v }; return nil }
    public var bool: Bool? { if case .bool(let v) = self { return v }; return nil }
    public var array: [WireValue]? { if case .array(let v) = self { return v }; return nil }
}

public struct PairTicket: Codable, Sendable {
    public let version: Int
    public let url: URL
    public let certificate: Data
    public let code: String
    public let agent: String
    public let capabilities: [String]

    public static func parse(_ input: String, server: URL) throws -> PairTicket {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.hasPrefix("luce-pair:"), text.count < 8192 else { throw ControlError.invalidTicket }
        var encoded = String(text.dropFirst(10)).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded) else { throw ControlError.invalidTicket }
        let ticket = try JSONDecoder().decode(PairTicket.self, from: data)
        guard ticket.version == 1, ticket.url.scheme == "https", ticket.url.host == server.host,
              ticket.url.user == nil, ticket.url.password == nil, ticket.url.query == nil, ticket.url.fragment == nil,
              ticket.url.path.isEmpty || ticket.url.path == "/", ticket.certificate.count < 4096,
              ticket.code.count == 43, !ticket.agent.isEmpty, DevicePolicy.valid(ticket.capabilities) else { throw ControlError.invalidTicket }
        return ticket
    }
}

public struct DeviceCredential: Codable, Sendable {
    public let url: URL
    public let certificate: Data
    public let id: String
    public let token: String
    public let agent: String
    public let capabilities: [String]
}

public struct DeviceTool: Codable, Sendable {
    public let name: String
    public let description: String?
    public let inputSchema: WireValue
}

public struct DeviceContent: Codable, Sendable {
    public let type: String
    public var text: String?
    public var data: String?
    public var mimeType: String?
    public static func text(_ value: String) -> DeviceContent { DeviceContent(type: "text", text: value) }
}

public struct DevicePacket: Codable, Sendable {
    public var type: String
    public var id: String?
    public var operation: String?
    public var arguments: [String: WireValue]?
    public var capabilities: [String]?
    public var tools: [DeviceTool]?
    public var content: [DeviceContent]?
    public var isError: Bool?
    public init(type: String) { self.type = type }
    public static func failure(_ id: String?, _ message: String) -> DevicePacket {
        var packet = DevicePacket(type: "result")
        packet.id = id; packet.isError = true; packet.content = [.text(message)]
        return packet
    }
}

public enum ControlError: Error, LocalizedError {
    case invalidTicket, denied, unavailable, interrupted, badResponse
    public var errorDescription: String? {
        switch self {
        case .invalidTicket: "Use a fresh pairing code from this agent server."
        case .denied: "This capability is not enabled or its permission was revoked."
        case .unavailable: "Mac control is unavailable."
        case .interrupted: "Control was interrupted. Inspect the result before retrying."
        case .badResponse: "The control connection returned an invalid response."
        }
    }
}

public enum DevicePolicy {
    public static func valid(_ capabilities: [String]) -> Bool {
        !capabilities.isEmpty && capabilities.count <= 2 && Set(capabilities).count == capabilities.count &&
        capabilities.allSatisfy { $0 == "native" || $0 == "commands" }
    }

    public static func ready(approved: [String], native: Bool, commands: Bool, accessibility: Bool, screen: Bool, runtime: Bool) -> [String] {
        var result: [String] = []
        if approved.contains("native") && native && accessibility && screen && runtime { result.append("native") }
        if approved.contains("commands") && commands { result.append("commands") }
        return result
    }
}
