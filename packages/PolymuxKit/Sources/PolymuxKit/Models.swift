import Foundation

extension Agent: Identifiable {}
extension Thread: Identifiable {
    public var isGroup: Bool { id != agentID }
    public var participantIDs: [String] { agentIDs.isEmpty ? [agentID] : agentIDs }
}
extension Message: Identifiable {
    public var text: String { parts.compactMap(\.text).joined() }
    public var attachments: [Attachment] { parts.compactMap(\.attachment) }
    public var date: Date { WireDate.parse(createdAt) ?? .distantPast }
    public var replyContext: ReplyContext {
        ReplyContext(messageID: id, role: role, text: text, attachment: attachments.first, agentID: agentID)
    }

    public func replyContext(part index: Int) -> ReplyContext? {
        guard parts.indices.contains(index) else { return nil }
        let part = parts[index]
        switch part.kind {
        case "text":
            guard let text = part.text, !text.isEmpty else { return nil }
            return ReplyContext(messageID: id, role: role, text: text, agentID: agentID, partIndex: Int64(index))
        case "attachment":
            guard let attachment = part.attachment else { return nil }
            return ReplyContext(messageID: id, role: role, attachment: attachment, agentID: agentID, partIndex: Int64(index))
        default:
            return nil
        }
    }
}
extension Attachment: Identifiable {}
extension SearchHit: Identifiable {
    public var id: String { message.id }
}

extension FocusAnswer {
    /// Recorded instead of an option id when the user skips the first-run card.
    public static let dismissed = "_dismissed"
}

public enum WireDate {
    private static let lock = NSLock()
    private nonisolated(unsafe) static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = .gmt
        return formatter
    }()
    private nonisolated(unsafe) static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = .gmt
        return formatter
    }()

    public static func string(_ date: Date = .now) -> String {
        lock.lock()
        defer { lock.unlock() }
        return fractional.string(from: date)
    }

    public static func parse(_ value: String) -> Date? {
        lock.lock()
        defer { lock.unlock() }
        if let date = fractional.date(from: value) { return date }
        return plain.date(from: value)
    }
}

public enum DeliveryFailure: Error, Sendable {
    case interrupted
}

public enum ClientError: LocalizedError, Sendable {
    case response(Int, String)
    case invalidURL
    case unavailable
    case cache(String)
    case gap(expected: Int64, actual: Int64)

    public var errorDescription: String? {
        switch self {
        case let .response(_, message): message
        case .invalidURL: "The server address is invalid."
        case .unavailable: "Couldn’t complete this request."
        case let .cache(message): "Local cache: \(message)"
        case let .gap(expected, actual): "Conversation replay skipped event \(expected) and received \(actual)."
        }
    }
}
