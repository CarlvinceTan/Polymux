import SwiftUI
import PolymuxKit

extension Color {
    static var unreadAccent: Color { Color("UnreadAccent") }
}

struct UnreadDot: View {
    var points: CGFloat = 7

    var body: some View {
        Circle()
            .fill(Color.unreadAccent)
            .frame(width: points, height: points)
            .accessibilityHidden(true)
    }
}

/// Pin tiles show the dot on the name line, to the right of the chat name.
struct PinnedChatName: View {
    let name: String
    var unread = false

    var body: some View {
        HStack(spacing: 4) {
            Text(name).lineLimit(1)
            if unread { UnreadDot(points: 7) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(name)
        .accessibilityValue(UnreadAccess.value(count: unread ? 1 : 0))
    }
}

#Preview("Pinned chat") {
    PinnedChatName(name: "Chief", unread: true)
        .padding(8)
        .frame(width: 120)
}
