import SwiftUI
import PolymuxKit
import AvatarKit

struct HistoryContent<Avatar: View>: View {
    let current: Agent
    let peer: Agent
    let messages: [Message]
    var loading = false
    var issue: String? = nil
    var more = false
    let avatar: (String) -> Avatar
    var retry: () -> Void = {}
    var earlier: () -> Void = {}
    let close: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if loading { ProgressView("Loading history…").frame(maxWidth: .infinity) }
                if let issue {
                    Text(issue).foregroundStyle(ActivityInk.color(scheme))
                    Button("Retry", action: retry)
                } else if !loading && messages.isEmpty {
                    Text("No messages yet").foregroundStyle(ActivityInk.color(scheme)).frame(maxWidth: .infinity)
                }
                if more { Button("Earlier messages", action: earlier) }
                ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                    if startsGroup(index) {
                        Text(message.date, format: ProgressiveTime(separator: true))
                            .font(.caption2.weight(.medium)).foregroundStyle(ActivityInk.color(scheme))
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                    }
                    let author = message.agentID == current.id ? current : peer
                    let first = index == 0 || messages[index - 1].agentID != message.agentID || startsGroup(index)
                    let last = index == messages.count - 1 || messages[index + 1].agentID != message.agentID || startsGroup(index + 1)
                    VStack(alignment: .leading, spacing: 5) {
                        if first {
                            Text(author.name).font(.caption.weight(.medium))
                                .foregroundStyle(HistoryInk.color(author.avatar?.color, scheme: scheme))
                                .padding(.leading, 34)
                        }
                        HStack(alignment: .bottom, spacing: 8) {
                            avatar(author.id).frame(width: 26, height: 26).opacity(last ? 1 : 0)
                            Text(message.text).textSelection(.enabled).padding(12)
                                .background(BubbleStyle.incoming(scheme), in: RoundedRectangle(cornerRadius: BubbleStyle.radius))
                            Spacer(minLength: 20)
                        }
                    }
                    .id(message.id)
                }
            }
            .padding(16).padding(.top, 64).padding(.bottom, 56)
        }
        .defaultScrollAnchor(.bottom)
        .overlay(alignment: .top) {
            HStack(spacing: 8) {
                avatar(current.id).frame(width: 24, height: 24)
                Text(current.name).lineLimit(1)
                Image(systemName: "arrow.left.arrow.right").foregroundStyle(ActivityInk.color(scheme))
                avatar(peer.id).frame(width: 24, height: 24)
                Text(peer.name).lineLimit(1)
            }
            .foregroundStyle(scheme == .dark ? Color.white : .black)
            .padding(12).background(PanelSurface.color(scheme), in: Capsule())
            .glassEffect(.regular, in: Capsule()).padding(16)
        }
        .overlay(alignment: .bottom) {
            Button("Close Chat", action: close)
                .buttonStyle(.bordered).buttonBorderShape(.capsule)
                .keyboardShortcut(.escape, modifiers: []).padding(16)
        }
        .background(PanelSurface.color(scheme))
    }

    private func startsGroup(_ index: Int) -> Bool {
        ChatTime.startsGroup(messages[index].date, after: index == 0 ? nil : messages[index - 1].date)
    }
}

enum HistoryInk {
    static func color(_ id: String?, scheme: ColorScheme) -> Color {
        guard let id, let color = ColorID(rawValue: id), !color.isAdaptive else { return .primary }
        let background = scheme == .dark ? 30.0 / 255 : 1.0
        let surface = luminance(background)
        let target = scheme == .dark ? "#ffffff" : "#000000"
        for step in 0...20 {
            let hex = mixHex(color.hex, target, Double(step) / 20)
            let value = Int(hex.dropFirst(), radix: 16) ?? 0
            let red = Double((value >> 16) & 255) / 255
            let green = Double((value >> 8) & 255) / 255
            let blue = Double(value & 255) / 255
            let ink = 0.2126 * luminance(red) + 0.7152 * luminance(green) + 0.0722 * luminance(blue)
            if (max(ink, surface) + 0.05) / (min(ink, surface) + 0.05) >= 4.5 {
                return Color(.sRGB, red: red, green: green, blue: blue)
            }
        }
        return .primary
    }

    private static func luminance(_ value: Double) -> Double {
        value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
}

struct HistoryOverlay<Content: View>: View {
    let close: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.opacity(0.25).onTapGesture(perform: close)
                content()
                    .frame(width: geometry.size.width, height: geometry.size.height * 0.8)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
    }
}
