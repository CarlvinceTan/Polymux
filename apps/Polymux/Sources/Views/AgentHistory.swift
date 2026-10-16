import SwiftUI
import PolymuxKit

struct AgentHistory: View {
    let current: Agent
    let peer: Agent
    let client: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var messages: [Message] = []
    @State private var loading = true
    @State private var issue: String?
    @State private var more = false

    var close: (() -> Void)? = nil

    var body: some View {
        HistoryContent(current: current, peer: peer, messages: messages, loading: loading,
                       issue: issue, more: more, avatar: { AgentAvatar(agentID: $0) },
                       retry: { Task { await load() } }, earlier: { Task { await load(earlier: true) } },
                       close: { if let close { close() } else { dismiss() } })
            .presentationDetents([.large])
            .task { await load() }
    }

    private func load(earlier: Bool = false) async {
        loading = true
        issue = nil
        defer { loading = false }
        do {
            let batch = try await client.peerHistory(agentID: current.id, peerID: peer.id,
                                                     before: earlier ? messages.map(\.seq).min() : nil)
            more = batch.count >= 50
            let fresh = batch.filter { item in !messages.contains { $0.id == item.id } }
            messages = (messages + fresh).sorted { $0.date == $1.date ? $0.id < $1.id : $0.date < $1.date }
        } catch { issue = error.localizedDescription }
    }
}
