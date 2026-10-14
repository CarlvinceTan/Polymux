import SwiftUI
import PolymuxKit
struct HeaderCapsule: View {
    let title: String
    let members: [Agent]
    var conversationID = ""
    var runs: [Run] = []
    var activity: ActivityStore?
    var connected = true
    var speakingID: String?
    let edit: () -> Void
    var body: some View {
        Button(action: edit) {
            HStack(spacing: 6) {
                HStack(spacing: -8) {
                    ForEach(members.prefix(3), id: \.id) { member in
                        AgentAvatar(agentID: member.id, conversationID: conversationID,
                                    runs: runs, activity: activity, connected: connected,
                                    speaking: speakingID == member.id)
                            .frame(width: 24, height: 24)
                    }
                }
                .accessibilityHidden(true)
                if members.count > 3 {
                    Text("+\(members.count - 3)")
                }
                Text(title).lineLimit(1).truncationMode(.tail)
            }
            .font(.headline)
            .frame(height: 24)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .glassEffect(.regular, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("header.capsule")
        .accessibilityValue("\(min(3, members.count)) avatars")
    }
}
