import Foundation

public struct Activity: Codable, Hashable, Sendable {
    public var kind: String
    public var verb: String
    public var objectID: String
    public var objectLabel: String
    public var iconOrAgentID: String
    public var at: String
    public var agentIDs: [String]?
    public var messageIDs: [String]?
    public var countsUnread: Bool { kind == "agent.messaged" || kind == "subagent.finished" }

    public init(kind: String, verb: String, objectID: String = "", objectLabel: String = "",
                iconOrAgentID: String = "", at: String = WireDate.string(), agentIDs: [String]? = nil, messageIDs: [String]? = nil) {
        self.kind = kind
        self.verb = verb
        self.objectID = objectID
        self.objectLabel = objectLabel
        self.iconOrAgentID = iconOrAgentID
        self.at = at
        self.agentIDs = agentIDs
        self.messageIDs = messageIDs
    }
}

public struct ActivityRow: Identifiable, Hashable, Sendable {
    public var id: String { conversationID + ":activity:" + String(seq) }
    public var conversationID: String
    public var seq: Int64
    public var lastSeq: Int64
    public var lastDate: Date
    public var payload: Activity
    public var count = 1
    public var agents: [String]
    public var date: Date { WireDate.parse(payload.at) ?? .distantPast }

    public var label: String {
        if payload.kind == "agent.messaged" { return "\(count) \(count == 1 ? "message" : "messages") with" }
        let noun = self.noun
        if count > 1 { return "\(payload.verb) \(count) \(noun)".trimmingCharacters(in: .whitespaces) }
        return [payload.verb, noun, payload.objectLabel].filter { !$0.isEmpty }.joined(separator: " ")
    }

    public var noun: String {
        switch payload.kind.split(separator: ".").first {
        case "routine": return count > 1 ? "routines" : "routine"
        case "memory": return count > 1 ? "memories" : "memory"
        case "skill": return count > 1 ? "skills" : "skill"
        case "subagent": return count > 1 ? "subagents" : ""
        case "connector": return count > 1 ? "connectors" : ""
        case "device": return count > 1 ? "devices" : ""
        case "instructions": return "instructions"
        default: return count > 1 ? "activities" : ""
        }
    }

    public var icon: String {
        if payload.kind != "agent.messaged", !payload.iconOrAgentID.isEmpty { return payload.iconOrAgentID }
        switch payload.kind.split(separator: ".").first {
        case "routine": return "clock"
        case "memory": return "brain"
        case "skill": return "sparkles"
        case "subagent": return "arrow.triangle.branch"
        case "connector": return "powerplug"
        case "device": return "desktopcomputer"
        case "instructions": return "doc.text"
        default: return "bubble.left.and.bubble.right"
        }
    }

    public static func collapse(_ events: [Event], messages: [Message] = []) -> [ActivityRow] {
        var rows: [ActivityRow] = []
        var seen: Set<String> = []
        let sequences = Dictionary(grouping: messages, by: \.threadID).mapValues { $0.map(\.seq).sorted() }
        func hasMessage(_ thread: String, after: Int64, before: Int64) -> Bool {
            let values = sequences[thread] ?? []
            var lower = 0
            var upper = values.count
            while lower < upper {
                let middle = (lower + upper) / 2
                if values[middle] <= after { lower = middle + 1 } else { upper = middle }
            }
            return lower < values.count && values[lower] < before
        }
        for event in events.sorted(by: { $0.seq < $1.seq }) {
            guard event.type == "activity", let payload = event.payload else { continue }
            let id = event.conversationID + ":" + String(event.seq)
            guard seen.insert(id).inserted else { continue }
            var agents = (payload.agentIDs ?? []).reduce(into: [String]()) { ids, id in
                if !id.isEmpty && !ids.contains(id) { ids.append(id) }
            }
            if payload.kind == "agent.messaged" && agents.isEmpty {
                for id in [event.agentID, payload.iconOrAgentID].compactMap({ $0 }) where !id.isEmpty && !agents.contains(id) {
                    agents.append(id)
                }
            }
            let row = ActivityRow(conversationID: event.conversationID, seq: event.seq,
                                  lastSeq: event.seq, lastDate: WireDate.parse(payload.at) ?? .distantPast,
                                  payload: payload, agents: agents)
            if let previous = rows.last {
                let peers = payload.kind == "agent.messaged"
                let gap = row.date.timeIntervalSince(peers ? previous.lastDate : previous.date)
                let interrupted = hasMessage(event.conversationID, after: previous.lastSeq, before: event.seq)
                let same = previous.conversationID == event.conversationID && previous.payload.kind == payload.kind
                    && (peers || previous.payload.verb == payload.verb)
                let dated = WireDate.parse(payload.at) != nil && WireDate.parse(previous.payload.at) != nil
                let repeats = same && dated && gap >= 0 && gap <= (peers ? 1800 : 60) && !interrupted
                    && (!peers || !ChatTime.startsGroup(row.date, after: previous.lastDate))
                if repeats {
                    let index = rows.count - 1
                    rows[index].count += 1
                    rows[index].lastSeq = event.seq
                    rows[index].lastDate = row.date
                    for agent in agents where !rows[index].agents.contains(agent) { rows[index].agents.append(agent) }
                    continue
                }
            }
            rows.append(row)
        }
        return rows
    }
}

public enum TranscriptRow: Identifiable, Sendable {
    case message(Message)
    case activity(ActivityRow)

    public var id: String {
        switch self {
        case .message(let message): return message.id
        case .activity(let row): return row.id
        }
    }
    public var date: Date {
        switch self {
        case .message(let message): return message.date
        case .activity(let row): return row.date
        }
    }
    public var lastDate: Date {
        switch self {
        case .message(let message): return message.date
        case .activity(let row): return row.lastDate
        }
    }
    public static func ordered(messages: [Message], events: [Event]) -> [TranscriptRow] {
        let hidden = Set(events.filter { $0.type == "activity" }.flatMap { $0.payload?.messageIDs ?? [] })
        let visible = messages.filter { !hidden.contains($0.id) }
        let rows = visible.map { ($0.seq == 0 ? Int64.max : $0.seq, TranscriptRow.message($0)) }
            + ActivityRow.collapse(events, messages: visible).map { ($0.seq, TranscriptRow.activity($0)) }
        return rows.sorted { $0.0 == $1.0 ? $0.1.date < $1.1.date : $0.0 < $1.0 }.map(\.1)
    }
}

public enum ChatTime {
    public static func startsGroup(_ current: Date, after previous: Date?) -> Bool {
        guard let previous else { return true }
        return !Calendar.current.isDate(previous, inSameDayAs: current) || current.timeIntervalSince(previous) > 1800
    }
}
