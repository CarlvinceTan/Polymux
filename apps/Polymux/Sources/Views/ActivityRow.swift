import SwiftUI
import PolymuxKit
#if os(macOS)
import AppKit
#endif

struct ActivityLine<Avatar: View>: View {
    let row: PolymuxKit.ActivityRow
    let names: [String: String]
    let currentAgent: String
    let avatar: (String) -> Avatar
    let open: (String) -> Void
    var openObject: (() -> Void)? = nil
    @State private var bots = false
    @State private var hovered = false
    @Environment(\.colorScheme) private var scheme
    private var interactive: Bool { row.payload.kind == "agent.messaged" || openObject != nil }

    var body: some View {
        HStack(spacing: 5) {
            if row.payload.kind == "agent.messaged" {
                Button(row.label) {
                    if row.agents.count > 2 { bots = true }
                    else if let peer = row.agents.first(where: { $0 != currentAgent }) { open(peer) }
                }
                if row.agents.count > 2 {
                    Button { bots = true } label: {
                        HStack(spacing: 5) {
                            HStack(spacing: -5) {
                                ForEach(Array(row.agents.prefix(3)), id: \.self) { id in
                                    avatar(id).frame(width: 14, height: 14).accessibilityHidden(true)
                                }
                            }
                            Text("\(row.agents.count) Bots")
                        }
                    }
                    .popover(isPresented: $bots, arrowEdge: .top) {
                        BotsList(agents: row.agents, names: names, currentAgent: currentAgent, avatar: avatar) { id in
                            bots = false
                            open(id)
                        }
                        .presentationCompactAdaptation(.popover)
                    }
                } else {
                    ForEach(Array(row.agents.enumerated()), id: \.element) { index, id in
                        if index > 0 { Text("and") }
                        Button { open(id == currentAgent ? row.agents.first(where: { $0 != currentAgent }) ?? id : id) } label: {
                            HStack(spacing: 5) {
                                avatar(id).frame(width: 14, height: 14).accessibilityHidden(true)
                                Text(names[id] ?? id).lineLimit(1)
                            }
                        }
                    }
                }
            } else {
                if let openObject {
                    Button(action: openObject) { object }
                } else { object }
            }
        }
        .font(.caption)
        .foregroundStyle(ActivityInk.color(scheme))
        .buttonStyle(.plain)
        .lineLimit(1).truncationMode(.tail)
        .padding(.horizontal, 8).padding(.vertical, 14)
        .background(hovered ? Color.secondary.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .onHover { hovered = $0 && interactive }
        #if os(macOS)
        .onHover { active in
            guard interactive else { return }
            if active { NSCursor.pointingHand.push() } else { NSCursor.pop() }
        }
        #endif
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(row.label + (row.agents.isEmpty ? "" : " " + row.agents.map { names[$0] ?? $0 }.joined(separator: " and ")))
    }

    private var object: some View {
        HStack(spacing: 5) {
            Text([row.payload.verb, row.count > 1 ? String(row.count) : "", row.noun].filter { !$0.isEmpty }.joined(separator: " "))
            Image(systemName: row.icon).accessibilityHidden(true)
            if row.count == 1 { Text(row.payload.objectLabel).lineLimit(1).truncationMode(.tail) }
        }
    }
}

struct BotsList<Avatar: View>: View {
    let agents: [String]
    let names: [String: String]
    var currentAgent = ""
    let avatar: (String) -> Avatar
    let pick: (String) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Group {
            if agents.count > 8 {
                ScrollView { rows }
                    .scrollBounceBehavior(.basedOnSize)
                    .frame(height: 352)
            } else { rows }
        }
        .frame(width: 240)
        .padding(8)
        .background(PanelSurface.color(scheme))
    }

    private var rows: some View {
        VStack(alignment: .leading, spacing: 0) {
            if agents.isEmpty {
                Text("No agents").foregroundStyle(ActivityInk.color(scheme)).padding(10)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            ForEach(agents, id: \.self) { id in
            BotChoice(name: names[id] ?? id, avatar: avatar(id), enabled: id != currentAgent) { pick(id) }
            }
        }
    }
}

enum ActivityInk {
    static func color(_ scheme: ColorScheme) -> Color {
        let value = scheme == .dark ? 0.65 : 0.36
        return Color(.sRGB, red: value, green: value, blue: value)
    }
}

private struct BotChoice<Avatar: View>: View {
    let name: String
    let avatar: Avatar
    let enabled: Bool
    let pick: () -> Void
    @State private var hovered = false
    @FocusState private var focused: Bool

    var body: some View {
        Button(action: pick) {
            BotLabel(name: name, avatar: avatar, hovered: hovered && enabled, focused: focused)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .focused($focused)
        .onHover { hovered = $0 }
        .disabled(!enabled)
        .accessibilityLabel(enabled ? "Open chat with \(name)" : "\(name), current chat")
    }
}

struct BotLabel<Avatar: View>: View {
    let name: String
    let avatar: Avatar
    var hovered = false
    var focused = false

    var body: some View {
        HStack(spacing: 10) {
            avatar.frame(width: 24, height: 24).accessibilityHidden(true)
            Text(name).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .padding(10).contentShape(Rectangle())
        .background(hovered ? Color.primary.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .overlay { RoundedRectangle(cornerRadius: 6).strokeBorder(focused ? Color.primary : .clear, lineWidth: 2) }
    }
}
