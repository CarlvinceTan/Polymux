import SwiftUI
import PolymuxKit

struct MessageMenu: View {
    let anchor: CGRect
    let container: CGSize
    let share: () -> Void
    var trace = SignpostTrace()
    let react: (String) -> Void
    let expand: () -> Void
    let reply: () -> Void
    let copy: () -> Void

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 0) {
                ForEach(["👍", "👎", "❤️", "😂", "🎉", "😮"], id: \.self) { emoji in
                    Button { perform { react(emoji) } } label: {
                        Text(emoji).font(.system(size: 22)).frame(maxWidth: .infinity).frame(height: 36)
                    }
                    .accessibilityLabel("React with \(emoji)")
                }
                Button { perform(expand) } label: {
                    Image(systemName: "face.smiling")
                        .overlay(alignment: .bottomTrailing) {
                            Image(systemName: "plus.circle.fill").font(.system(size: 9))
                        }
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel("Add emoji")
            }
            Divider()
            row("Reply", icon: "arrowshape.turn.up.left", action: reply)
            row("Copy", icon: "doc.on.doc", action: copy)
            row("Share", icon: "square.and.arrow.up", action: share)
        }
        .buttonStyle(.plain)
        .padding(8)
        .messagePosition(anchor: anchor, container: container, preferred: CGSize(width: 280, height: 184))
    }

    private func perform(_ action: () -> Void) {
        InstantUI.interval("MessageAction", budget: InstantUI.stateBudget, trace: trace, action)
    }

    private func row(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button { perform(action) } label: {
            Label(title, systemImage: icon)
                .frame(maxWidth: .infinity, alignment: .leading).padding(8)
                .contentShape(Rectangle())
        }
    }
}

struct MessagePosition: ViewModifier {
    let anchor: CGRect
    let container: CGSize
    let preferred: CGSize
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let size = CGSize(width: min(preferred.width, max(0, container.width - 16)),
                          height: min(preferred.height, max(0, container.height - 16)))
        let origin = MenuPlacement.origin(anchor: CGPoint(x: anchor.minX, y: anchor.maxY),
                                          size: size, bounds: CGRect(origin: .zero, size: container))
        ScrollView { content }
            .frame(width: size.width, height: size.height)
            .background(PanelSurface.color(scheme), in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).stroke(.primary.opacity(0.5), lineWidth: 1) }
            .clipped()
            .offset(x: origin.x, y: origin.y)
            .frame(width: container.width, height: container.height, alignment: .topLeading)
    }
}

extension View {
    func messagePosition(anchor: CGRect, container: CGSize, preferred: CGSize) -> some View {
        modifier(MessagePosition(anchor: anchor, container: container, preferred: preferred))
    }
}
