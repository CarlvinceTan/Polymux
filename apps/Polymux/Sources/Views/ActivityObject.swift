import SwiftUI
import PolymuxKit

struct ActivityObject: View {
    let row: PolymuxKit.ActivityRow
    let client: APIClient
    @Environment(\.panelClose) private var close
    @Environment(\.colorScheme) private var scheme
    @State private var content: String?
    @State private var issue: String?

    var body: some View {
        PanelView(row.payload.objectLabel, onClose: { close() }) {
            ScrollView {
                if let content {
                    Text(content.isEmpty ? "No content available" : content).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                } else if let issue {
                    VStack {
                        Text(issue).foregroundStyle(ActivityInk.color(scheme))
                        Button("Retry") { Task { await load() } }
                    }.padding(16)
                } else { ProgressView("Loading…").padding(16) }
            }
        }
        .task { await load() }
    }

    private func load() async {
        issue = nil
        do { content = try await client.activityObject(threadID: row.conversationID, seq: row.seq)["text"] ?? "" }
        catch { issue = error.localizedDescription }
    }
}
