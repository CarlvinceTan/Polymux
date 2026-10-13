import SwiftUI
import PolymuxKit
import AvatarKit

struct NewChatView: View {
    let session: AppSession
    let close: () -> Void
    let select: (PolymuxKit.Thread) -> Void
    @State private var query = ""
    @State private var recipients: [Agent] = []
    @State private var title = ""
    @State private var opened = false
    @State private var error: String?
    @State private var focused = false
    @State private var recipientHeight: CGFloat = 28

    var body: some View {
        PanelView("New Chat", onClose: close, header: AnyView(recipientBar)) {
            List {
                if let error {
                    Text(error).font(.caption).foregroundStyle(.secondary)
                        .listRowSeparator(.hidden)
                        .panelRow()
                }
                if contacts.isEmpty {
                    Text(query.isEmpty ? "No available agents." : "No matching agents.")
                        .foregroundStyle(.secondary)
                        .listRowSeparator(.hidden)
                        .panelRow()
                }
                ForEach(contacts, id: \.id) { agent in
                    Button { choose(agent) } label: {
                        AgentRow(agent: agent, thread: session.sidebar.thread(for: agent),
                                 duplicate: session.sidebar.agents.filter { $0.name == agent.name }.count > 1,
                                  gap: 16, activity: session.sidebar.activity, connected: session.sidebar.isConnected)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowInsets(rowInset)
                    .listRowSeparator(agent.id == contacts.first?.id ? .hidden : .automatic, edges: .top)
                    .listRowSeparator(agent.id == contacts.last?.id ? .hidden : .automatic, edges: .bottom)
                    .alignmentGuide(.listRowSeparatorTrailing) { $0[.trailing] }
                    .panelRow()
                }
            }
            .listStyle(.plain)
            .contentMargins(.horizontal, 0, for: .scrollContent)
            .scrollIndicators(.hidden)
        } actions: {
            Button { start() } label: {
                Text("Create")
            }
            .disabled(recipients.isEmpty || opened || !validTitle || recipients.contains { $0.id.hasPrefix("local-") })
            .keyboardShortcut(.defaultAction)
        }
        .panelDismiss(onClose: close)
        .task { focused = true }
    }

    private var recipientBar: some View {
        VStack(spacing: 12) {
            GlassEffectContainer(spacing: 0) {
                HStack(alignment: .top, spacing: 12) {
                    HStack(alignment: .top, spacing: 8) {
                        Text("To:").foregroundStyle(.secondary).frame(height: 28)
                        ScrollViewReader { proxy in
                            ScrollView(.vertical) {
                                RecipientFlow {
                                    ForEach(recipients, id: \.id) { agent in
                                        Button { remove(agent.id) } label: {
                                            HStack(spacing: 5) {
                                                Text(agent.name).lineLimit(1)
                                                Image(systemName: "xmark").font(.caption2.weight(.semibold))
                                            }
                                            .padding(.horizontal, 10).padding(.vertical, 5)
                                            .background(.quaternary, in: Capsule())
                                        }
                                        .buttonStyle(.plain)
                                        .frame(maxWidth: 170)
                                        .accessibilityLabel("Remove \(agent.name)")
                                    }
                                    RecipientField(text: $query, focused: $focused,
                                                   placeholder: recipients.isEmpty ? "Name" : "",
                                                   onSubmit: { chooseFirst() }, onDelete: { removeLast() })
                                        .frame(minWidth: 80, minHeight: 28)
                                        .accessibilityLabel("To")
                                        .id("recipientInput")
                                }
                                .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { recipientHeight = $0 }
                            }
                            .scrollIndicators(.hidden)
                            .frame(height: min(136, max(28, recipientHeight)))
                            .onChange(of: recipientHeight) { _, _ in
                                if focused { proxy.scrollTo("recipientInput", anchor: .bottom) }
                            }
                            .onChange(of: focused) { _, value in
                                if value { proxy.scrollTo("recipientInput", anchor: .bottom) }
                            }
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .glassEffect(.regular, in: .rect(cornerRadius: 22))
                    Button { create() } label: {
                        Image(systemName: "plus").font(.system(size: 17))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.primary)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
                    .glassEffect(.regular.interactive(), in: Circle())
                    .accessibilityLabel("Create new agent")
                    .disabled(recipients.count >= 16)
                }
            }
            if recipients.count > 1 {
                VStack(alignment: .leading, spacing: 6) {
                    TextField("Chat name (optional)", text: $title)
                        .textFieldStyle(.plain)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .frame(minHeight: 44)
                        .glassEffect(.regular, in: Capsule())
                    if !validTitle {
                        Text("Choose a shorter chat name.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var cleanTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var validTitle: Bool { recipients.count < 2 || cleanTitle.utf8.count <= 128 }

    private var rowInset: EdgeInsets {
        #if os(macOS)
        EdgeInsets(top: 0, leading: 8, bottom: 0, trailing: 8)
        #else
        EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16)
        #endif
    }

    private var contacts: [Agent] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return session.sidebar.recentFirst(session.sidebar.agents.filter { agent in
            !recipients.contains(where: { $0.id == agent.id }) && (term.isEmpty || agent.name.localizedStandardContains(term) || agent.role.localizedStandardContains(term))
        })
    }

    private func chooseFirst() {
        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if !recipients.isEmpty { start() }
            return
        }
        guard let first = contacts.first else { return }
        choose(first)
    }

    private func choose(_ agent: Agent) {
        guard !recipients.contains(where: { $0.id == agent.id }) else { return }
        guard recipients.count < 16 else {
            error = "A chat can have up to 16 agents."
            return
        }
        recipients.append(agent)
        query = ""
        focused = true
        error = nil
    }

    private func remove(_ id: String) {
        recipients.removeAll { $0.id == id }
        focused = true
    }

    private func removeLast() {
        guard !recipients.isEmpty else { return }
        recipients.removeLast()
        focused = true
    }

    private func start() {
        guard !opened, !recipients.isEmpty, validTitle, !recipients.contains(where: { $0.id.hasPrefix("local-") }) else { return }
        let launch = InstantChat.start(agents: recipients, title: cleanTitle.isEmpty ? nil : cleanTitle,
                                       sidebar: session.sidebar, client: session.client, begin: {
            opened = true
            error = nil
        }) { thread in
            focused = false
            select(thread)
        }
        Task { @MainActor in
            let failure = await launch.finish()
            if let failure {
                opened = false
                error = failure
                return
            }
        }
    }

    private func create() {
        guard recipients.count < 16 else { return }
        let launch = InstantChat.create(draftAgent(), sidebar: session.sidebar, client: session.client, begin: {
            error = nil
        }) { agent in
            recipients.append(agent)
            query = ""
            focused = true
        }
        Task { @MainActor in
            let failure = await launch.finish()
            if let failure {
                recipients.removeAll { $0.id == launch.agent.id }
                error = failure
                return
            }
            guard let saved = launch.saved, let index = recipients.firstIndex(where: { $0.id == launch.agent.id }) else { return }
            recipients[index] = saved
            session.avatars.sync(agents: session.sidebar.agents)
        }
    }

    private func draftAgent() -> CreateAgentRequest {
        let names = ["Arlo", "Aster", "Cleo", "Echo", "Ember", "Fern", "Milo", "Nova", "Olive", "Pip", "Sage", "Wren"]
        var options = AvatarOptions.default
        options.shape = ShapeID.allCases.randomElement() ?? .circle
        options.color = ColorID.allCases.randomElement() ?? .ink
        return CreateAgentRequest(name: names.randomElement() ?? "Nova", role: "", prompt: "", avatar: options.design)
    }
}

private struct RecipientFlow: Layout {
    private struct Placement {
        let point: CGPoint
        let size: CGSize
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = max(80, proposal.width ?? 300)
        let rows = positions(subviews, width: width)
        let height = rows.map { $0.point.y + $0.size.height }.max() ?? 28
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = positions(subviews, width: bounds.width)
        for (index, row) in rows.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + row.point.x, y: bounds.minY + row.point.y),
                                 proposal: ProposedViewSize(row.size))
        }
    }

    private func positions(_ subviews: Subviews, width: CGFloat) -> [Placement] {
        var rows: [Placement] = []
        var x: CGFloat = 0, y: CGFloat = 0, height: CGFloat = 0
        for index in subviews.indices {
            let field = index == subviews.count - 1
            var size = subviews[index].sizeThatFits(field ? ProposedViewSize(width: max(80, width - x), height: nil) : .unspecified)
            if x > 0 && x + size.width > width {
                x = 0
                y += height + 8
                height = 0
                size = subviews[index].sizeThatFits(ProposedViewSize(width: width, height: nil))
            }
            rows.append(Placement(point: CGPoint(x: x, y: y), size: size))
            x += size.width + 8
            height = max(height, size.height)
        }
        return rows
    }
}
