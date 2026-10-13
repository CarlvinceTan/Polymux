import SwiftUI
import PolymuxKit
import AvatarKit

struct ShellView: View {
    let session: AppSession
    @Binding var showSettings: Bool
    @State private var selection: String?
    @Environment(\.scenePhase) private var scenePhase
    @State private var windowID = UUID()
    @State private var visibility = NavigationSplitViewVisibility.all
    @State private var query = ""
    @State private var searching = false
    @State private var columnWidth: CGFloat = 360
    @FocusState private var searchFocused: Bool
    @State private var filter = AgentFilter.all
    @State private var order = AgentOrder.recent
    @State private var adding = false
    @State private var editing: AvatarContact?
    @State private var profiling: AvatarContact?
    @State private var grouping: PolymuxKit.Thread?
    @State private var deleteTarget: AvatarContact?
    @State private var confirmDelete = false
    @State private var deleting: String?
    @State private var deleteError: String?
    @State private var dropped: [URL] = []
    @Environment(\.colorScheme) private var colorScheme
    #if os(macOS)
    @State private var sidebar = SidebarState()
    @State private var sidebarShown = false
    @State private var sidebarOpening = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #endif

    private var sidebarWidth: Double { session.settings.value?.sidebarWidth ?? SidebarWidth.initial }
    private var widthBinding: Binding<Double> {
        Binding(get: { sidebarWidth }, set: { value in
            let width = min(Double(SidebarWidth.maximum), max(Double(SidebarWidth.minimum), value))
            guard abs(width - sidebarWidth) > 0.5 else { return }
            session.settings.edit(SettingsPatch(sidebarWidth: width))
        })
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $visibility) {
            List(selection: $selection) {
                ForEach(conversations) { thread in
                    chatLink(thread)
                }
            }
            .accessibilityIdentifier("chats.list")
            #if os(macOS)
            .listStyle(.sidebar)
            .tint(Color(white: colorScheme == .dark ? 0.24 : 0.87))
            .scrollContentBackground(.hidden)
            .scrollEdgeEffectHidden()
            .background {
                sidebarSurface
                    .ignoresSafeArea(.container, edges: [.top, .bottom])
            }
            #else
            .listStyle(.plain)
            #endif
            .scrollIndicators(.hidden)
            #if os(macOS)
            .navigationTitle("Polymux")
            #else
            .navigationTitle(searching ? "" : "Chats")
            #endif
            #if os(macOS)
            .searchable(text: $query, placement: .sidebar, prompt: "Search")
            .background { SearchFocus(sidebar: true).frame(width: 0, height: 0) }
            #else
            .navigationBarTitleDisplayMode(.inline)
            .simultaneousGesture(TapGesture().onEnded { searchFocused = false }, isEnabled: searching)
            .scrollDismissesKeyboard(.interactively)
            .contentMargins(.bottom, searching ? 0 : 96, for: .scrollContent)
            .overlay(alignment: .bottom) {
                if !searching {
                    VStack {
                        Spacer(minLength: 0)
                        HStack(spacing: 10) {
                            Button("Search agents", systemImage: "magnifyingglass") {
                                withAnimation { searching.toggle() }
                                searchFocused = searching
                            }
                            .labelStyle(.iconOnly).buttonStyle(.plain)
                            .frame(width: 64, height: 64)
                            .glassEffect(.regular.interactive(), in: Circle())
                            Spacer(minLength: 0)
                            Button("New chat", systemImage: "plus") { adding = true }
                                .labelStyle(.iconOnly).buttonStyle(.plain)
                                .frame(width: 64, height: 64)
                                .glassEffect(.regular.interactive(), in: Circle())
                        }
                        .font(.system(size: 24))
                        .padding(.horizontal, 24).padding(.bottom, 24)
                    }
                    .ignoresSafeArea(.container, edges: .bottom)
                }
            }
            #endif
            .overlay {
                if conversations.isEmpty {
                    if !query.isEmpty { ContentUnavailableView.search(text: query) }
                    else if filter != .all {
                        ContentUnavailableView("No \(filter.rawValue.lowercased()) conversations", systemImage: "line.3.horizontal.decrease")
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: SidebarWidth.minimum, ideal: max(SidebarWidth.minimum, CGFloat(sidebarWidth)), max: SidebarWidth.maximum)
            .background {
                #if os(macOS)
                SidebarLimits(width: widthBinding, state: sidebar).frame(width: 0, height: 0)
                #else
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { columnWidth = proxy.size.width }
                        .onChange(of: proxy.size.width) { _, width in columnWidth = width }
                }
                #endif
            }
            .toolbar {
                #if os(macOS)
                if sidebar.stage == .expanded && visibility != .detailOnly {
                    ToolbarSpacer(.flexible, placement: .primaryAction)
                    ToolbarItemGroup(placement: .primaryAction) {
                        Button("New chat", systemImage: "plus") { adding = true }
                        filterMenu
                    }
                    ToolbarSpacer(.fixed, placement: .primaryAction)
                    ToolbarItem(placement: .primaryAction) {
                        Button("Settings", systemImage: "gearshape") { showSettings = true }
                    }
                }
                #else
                if searching {
                    ToolbarItem(placement: .principal) {
                        HStack(spacing: 8) {
                            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                            TextField("Search agents", text: $query)
                                .textFieldStyle(.plain).focused($searchFocused)
                                .focusEffectDisabled()
                                .submitLabel(.search)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 12)
                        .frame(width: max(160, columnWidth - 88))
                        .glassEffect(.regular, in: Capsule())
                        .onAppear { searchFocused = true }
                    }
                    .sharedBackgroundVisibility(.hidden)
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Close search", systemImage: "xmark") {
                            withAnimation { searching = false; query = "" }
                            searchFocused = false
                        }
                    }
                } else {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Settings", systemImage: "gearshape") { showSettings = true }
                            .labelStyle(.iconOnly).buttonStyle(.plain)
                            .frame(width: 44, height: 44)
                            .glassEffect(.regular.interactive(), in: Circle())
                            .padding(.leading, 8)
                    }
                    .sharedBackgroundVisibility(.hidden)
                    ToolbarItem(placement: .topBarTrailing) {
                        filterMenu.labelStyle(.iconOnly)
                            .buttonStyle(.plain)
                            .padding(.trailing, 8)
                    }
                    .sharedBackgroundVisibility(.visible)
                }
                #endif
            }
            .toolbar(removing: .sidebarToggle)
        } detail: {
            if let thread = session.sidebar.threads.first(where: { $0.id == selection }),
               let agent = participants(thread).first {
                ChatPane(agent: agent, thread: thread, session: session, drops: $dropped)
                    .id(thread.id)
            } else {
                ContentUnavailableView("Your conversations", systemImage: "bubble.left.and.bubble.right",
                                       description: Text("Choose an agent to start talking."))
            }
        }
        .navigationSplitViewStyle(.balanced)
        .background {
            Text("Application status")
                .font(.system(size: 1)).opacity(0.01)
                .accessibilityIdentifier("app.status")
                .accessibilityValue("connected=\(session.sidebar.isConnected ? 1 : 0), cache=\(session.sidebar.error == nil && !session.sidebar.threads.isEmpty ? "warm" : "cold")")
        }
        .onChange(of: selection, initial: true) { _, value in
            Notifications.shared.visible(scenePhase == .active ? value : nil, window: windowID)
        }
        .onChange(of: scenePhase) { _, phase in
            Notifications.shared.visible(phase == .active ? selection : nil, window: windowID)
        }
        .onDisappear { Notifications.shared.visible(nil, window: windowID) }
        .onChange(of: Notifications.shared.routeID, initial: true) { _, _ in
            if let thread = Notifications.shared.destination { selection = thread }
        }
        #if os(macOS)
        .dropDestination(for: URL.self) { urls, _ in
            let files = urls.filter(\.isFileURL)
            guard !files.isEmpty, let selection,
                  session.sidebar.threads.contains(where: { $0.id == selection }) else { return false }
            dropped.append(contentsOf: files)
            return true
        }
        #endif
        .toolbar(removing: .sidebarToggle)
        #if os(macOS)
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button("Show sidebar", systemImage: "sidebar.left", action: showSidebar)
                    .labelStyle(.iconOnly).buttonStyle(.plain)
                    .frame(width: 36, height: 36).contentShape(Circle())
                    .glassEffect(.regular.interactive(!sidebarOpening), in: Circle())
                    .opacity(sidebarShown ? 1 : 0)
                    .disabled(sidebarOpening || sidebar.stage != .collapsed)
                    .allowsHitTesting(sidebarShown && !sidebarOpening && sidebar.stage == .collapsed)
                    .accessibilityHidden(!sidebarShown || sidebarOpening)
            }
            .sharedBackgroundVisibility(.hidden)
        }
        .onChange(of: sidebar.stage, initial: true) { _, stage in
            var transaction = Transaction(animation: nil)
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                if stage == .expanded { visibility = .all }
                else if stage == .collapsed { visibility = .detailOnly }
                if !stage.moving { sidebarOpening = false }
            }
            var fade = Transaction(animation: reduceMotion ? nil : .easeInOut(duration: 0.12))
            fade.disablesAnimations = false
            withTransaction(fade) {
                sidebarShown = stage == .collapsing || stage == .collapsed
            }
        }
        #endif
        .panel(isPresented: $adding) {
            NewChatView(session: session, close: { adding = false }) { thread in
                selection = thread.id
                adding = false
            }
        }
        .panel(item: $editing) { contact in
            AvatarEditor(agentID: contact.agent.id, name: contact.agent.name, client: session.client, store: session.avatars)
        }
        .panel(item: $grouping) { thread in
            GroupEditor(thread: thread, session: session)
        }
        .panel(item: $profiling) { contact in
            AgentEditor(agent: contact.agent, session: session)
        }
        .alert("Delete agent?", isPresented: $confirmDelete, presenting: deleteTarget) { contact in
            Button("Delete", role: .destructive) { Task { await delete(contact.agent) } }
            Button("Cancel", role: .cancel) {}
        } message: { contact in
            Text("This will permanently remove \(contact.agent.name) and their conversation.")
        }
        .alert("Couldn’t delete agent", isPresented: Binding(
            get: { deleteError != nil }, set: { if !$0 { deleteError = nil } }
        )) {
            Button("OK") { deleteError = nil }
        } message: { Text(deleteError ?? "") }
        .task {
            while !Task.isCancelled {
                await session.sidebar.refresh()
                if session.sidebar.isConnected {
                    session.avatars.sync(agents: session.sidebar.agents)
                    await session.avatars.flush(client: session.client)
                }
                #if os(macOS)
                if selection == nil { selection = Notifications.shared.destination ?? session.sidebar.threads.first(where: { $0.agentID == "assistant" && !$0.isGroup })?.id ?? conversations.first?.id }
                #endif
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    private func participants(_ thread: PolymuxKit.Thread) -> [Agent] {
        thread.participantIDs.compactMap { id in session.sidebar.agents.first { $0.id == id } }
    }

    #if os(macOS)
    private func showSidebar() {
        guard sidebar.stage == .collapsed, !sidebarOpening else { return }
        sidebarOpening = true
        if !sidebar.reveal() {
            sidebar.stage = .expanding
            visibility = .all
        }
    }
    #endif

    private func title(_ thread: PolymuxKit.Thread) -> String {
        thread.isGroup ? thread.title : participants(thread).first?.name ?? "Chat"
    }

    /// The sidebar's own surface. Row fills composite over it so the system selection fill
    /// cannot show through, and it must match the list background or the rows band visibly.
    private var sidebarSurface: Color {
        #if os(macOS)
        Color(white: colorScheme == .dark ? 38.0 / 255 : 242.0 / 255)
        #else
        AppBackground.color(colorScheme)
        #endif
    }

    private var duplicateAgentNames: Set<String> {
        var seen: [String: Int] = [:]
        for agent in session.sidebar.agents { seen[agent.name, default: 0] += 1 }
        return Set(seen.filter { $0.value > 1 }.map(\.key))
    }

    private var conversations: [PolymuxKit.Thread] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return session.sidebar.threads.filter { thread in
            let members = participants(thread)
            guard !members.isEmpty else { return false }
            let matches = term.isEmpty || title(thread).localizedStandardContains(term) || members.contains {
                $0.name.localizedStandardContains(term) || $0.role.localizedStandardContains(term)
            }
            switch filter {
            case .all: return matches
            case .unread: return matches && thread.unreadCount > 0
            case .active: return matches && members.contains { $0.active }
            }
        }.sorted { lhs, rhs in
            if order == .name { return title(lhs).localizedStandardCompare(title(rhs)) == .orderedAscending }
            let left = lhs.lastMessage?.date ?? .distantPast
            let right = rhs.lastMessage?.date ?? .distantPast
            if left == right { return lhs.id < rhs.id }
            return left > right
        }
    }

    private var filterMenu: some View {
        Menu {
            Picker("Show", selection: $filter) {
                ForEach(AgentFilter.allCases) { Text($0.rawValue).tag($0) }
            }
            Picker("Sort", selection: $order) {
                ForEach(AgentOrder.allCases) { Text($0.rawValue).tag($0) }
            }
        } label: {
            Label("Filter conversations", systemImage: "line.3.horizontal.decrease")
                #if os(iOS)
                .frame(width: 44, height: 44)
                .glassEffect(.regular.interactive(), in: Circle())
                #endif
        }
        .menuIndicator(.hidden)
    }

    private func chatLink(_ thread: PolymuxKit.Thread) -> some View {
        SidebarChatLink(threadID: thread.id, selected: selection == thread.id, surface: sidebarSurface) {
            if thread.isGroup {
                GroupRow(thread: thread, members: participants(thread), activity: session.sidebar.activity, connected: session.sidebar.isConnected)
            } else if let agent = participants(thread).first {
                AgentRow(agent: agent, thread: thread,
                         duplicate: duplicateAgentNames.contains(agent.name),
                         activity: session.sidebar.activity, connected: session.sidebar.isConnected)
            }
        }
        .accessibilityIdentifier("sidebar.row.\(thread.id)")
        #if os(macOS)
        .listRowInsets(EdgeInsets(top: 0, leading: 10, bottom: 0, trailing: 10))
        .overlay {
            if thread.isGroup {
                RowMenu(profile: { grouping = thread }, title: "Edit chat")
                    .accessibilityHidden(true)
            } else if let agent = participants(thread).first {
                RowMenu(profile: { profiling = AvatarContact(agent: agent) },
                        avatar: { editing = AvatarContact(agent: agent) },
                        delete: { requestDelete(agent) })
                    .accessibilityHidden(true)
            }
        }
        .accessibilityActions {
            Button(thread.isGroup ? "Edit chat" : "Edit profile") { edit(thread) }
            if !thread.isGroup, let agent = participants(thread).first {
                Button("Customise avatar") { editing = AvatarContact(agent: agent) }
                Button("Delete") { requestDelete(agent) }
            }
        }
        #else
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        .listRowSeparator(thread.id == conversations.first?.id ? .hidden : .automatic, edges: .top)
        .listRowSeparator(thread.id == conversations.last?.id ? .hidden : .automatic, edges: .bottom)
        .contextMenu {
            if thread.isGroup {
                Button("Edit chat", systemImage: "pencil") { grouping = thread }
            } else if let agent = participants(thread).first {
                Button("Edit profile", systemImage: "pencil") { profiling = AvatarContact(agent: agent) }
                Button("Customise avatar", systemImage: "face.smiling") { editing = AvatarContact(agent: agent) }
                Divider()
                Button("Delete", systemImage: "trash", role: .destructive) { requestDelete(agent) }
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if !thread.isGroup, let agent = participants(thread).first {
                Button("Delete", systemImage: "trash", role: .destructive) { requestDelete(agent) }.tint(.gray)
            }
            Button("Edit", systemImage: "pencil") { edit(thread) }.tint(.gray.opacity(0.7))
        }
        #endif
        .disabled(deleting == thread.agentID)
    }

    private func edit(_ thread: PolymuxKit.Thread) {
        if thread.isGroup { grouping = thread }
        else if let agent = participants(thread).first { profiling = AvatarContact(agent: agent) }
    }

    private func requestDelete(_ agent: Agent) {
        deleteTarget = AvatarContact(agent: agent)
        confirmDelete = true
    }

    private func delete(_ agent: Agent) async {
        deleting = agent.id
        defer { deleting = nil }
        do {
            try await session.client.deleteAgent(id: agent.id)
            session.avatars.remove(id: agent.id)
            await session.sidebar.refresh()
            if !session.sidebar.threads.contains(where: { $0.id == selection }) { selection = conversations.first?.id }
        } catch { deleteError = error.localizedDescription }
    }
}

struct AgentRow: View {
    let agent: Agent
    let thread: PolymuxKit.Thread?
    let duplicate: Bool
    var gap: CGFloat? = nil
    var activity: ActivityStore?
    var connected = true

    var body: some View {
        HStack(spacing: gap ?? rowGap) {
            AgentAvatar(agentID: agent.id, conversationID: thread?.id ?? agent.id,
                        runs: thread?.runs ?? [], activity: activity, connected: connected,
                        unread: (thread?.unreadCount ?? 0) > 0)
                #if os(iOS)
                .frame(width: 60, height: 60)
                #else
                .frame(width: 52, height: 52)
                .frame(width: 34)
                #endif
                .accessibilityHidden(true)
            RowDetails(name: agent.name, preview: preview, thread: thread, active: agent.active)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.name), \(agent.role), \(preview)")
        .accessibilityValue("\(thread?.unreadCount ?? 0) unread messages, \(ActivityStore.present(runs: thread?.runs ?? [], conversationID: thread?.id ?? agent.id, agentID: agent.id, connected: connected).label)")
    }

    private var rowGap: CGFloat {
        #if os(macOS)
        16
        #else
        10
        #endif
    }

    private var presentation: ActivityView {
        ActivityStore.present(runs: thread?.runs ?? [], conversationID: thread?.id ?? agent.id,
                              agentID: agent.id, connected: connected)
    }

    private var preview: String {
        guard let message = thread?.lastMessage else { return duplicate ? agent.role : "" }
        let text: String
        if let question = message.parts.first(where: { $0.kind == "choice" })?.question, !question.isEmpty {
            text = question
        } else if message.status == "streaming" {
            // The reply is shown whole when it finishes; name its activity until then.
            text = presentation.working ? presentation.label : ""
        } else if !message.text.isEmpty {
            text = message.text.replacingOccurrences(of: "\n", with: " ")
        } else if let name = message.parts.compactMap(\.attachment).first?.name {
            text = name
        } else {
            text = ""
        }
        return duplicate ? "\(agent.role) · \(agent.id.prefix(6)) · \(text)" : text
    }
}

struct GroupRow: View {
    let thread: PolymuxKit.Thread
    let members: [Agent]
    var activity: ActivityStore?
    var connected = true

    var body: some View {
        HStack(spacing: gap) {
            #if os(macOS)
            AvatarStack(members: members, conversationID: thread.id, runs: thread.runs, activity: activity, connected: connected).frame(width: 34)
            #else
            AvatarStack(members: members, size: 60, conversationID: thread.id, runs: thread.runs, activity: activity, connected: connected)
            #endif
            RowDetails(name: thread.title, preview: preview, thread: thread, active: members.contains { $0.active })
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(thread.title), \(members.map(\.name).joined(separator: ", ")), \(preview)")
        .accessibilityValue("\(thread.unreadCount) unread messages")
    }

    private var gap: CGFloat {
        #if os(macOS)
        16
        #else
        10
        #endif
    }

    private var preview: String {
        guard let message = thread.lastMessage else { return members.map(\.name).joined(separator: ", ") }
        return message.text.isEmpty ? message.attachments.first?.name ?? "Attachment" : message.text.replacingOccurrences(of: "\n", with: " ")
    }
}

private struct RowDetails: View {
    let name: String
    let preview: String
    let thread: PolymuxKit.Thread?
    let active: Bool

    private var foreground: Color {
        #if os(macOS)
        Color(nsColor: .labelColor)
        #else
        .primary
        #endif
    }

    private var secondary: Color {
        #if os(macOS)
        Color(nsColor: .secondaryLabelColor)
        #else
        .secondary
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Text(name)
                    #if os(iOS)
                    .font(.headline)
                    #else
                    .font(.body.weight(.medium))
                    #endif
                    .foregroundStyle(foreground).lineLimit(1)
                Spacer(minLength: 4)
                if active {
                    Circle().fill(.green).frame(width: 6, height: 6).accessibilityLabel("Active")
                }
                if let date = thread?.lastMessage?.date {
                    Text(date, format: ProgressiveTime())
                        .font(.caption2).foregroundStyle(secondary).lineLimit(1).fixedSize()
                }
            }
            if !preview.isEmpty || (thread?.unreadCount ?? 0) > 0 {
                HStack(spacing: 6) {
                    Text(preview)
                        #if os(iOS)
                        .font(.subheadline)
                        #else
                        .font(.caption)
                        #endif
                        .lineLimit(1).foregroundStyle(secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let count = thread?.unreadCount, count > 0 {
                        Text(count > 9 ? "9+" : "\(count)")
                            .font(.caption2.weight(.semibold))
                            .monospacedDigit()
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .foregroundStyle(Color("OnAccent")).background(Color("AccentColor"), in: Capsule())
                            .fixedSize()
                            .accessibilityHidden(true)
                    }
                }
            }
        }
    }
}

/// Keeps hover highlight local so moving across sidebar rows does not rebuild `NavigationSplitView`.
private struct SidebarChatLink<Content: View>: View {
    let threadID: String
    let selected: Bool
    let surface: Color
    @ViewBuilder var content: () -> Content
    @State private var hovered = false

    private var fill: Color {
        if selected { return Color.primary.opacity(0.11) }
        if hovered { return Color.primary.opacity(0.06) }
        return .clear
    }

    var body: some View {
        NavigationLink(value: threadID) { content() }
            .navigationLinkIndicatorVisibility(.hidden)
            .listRowBackground(
                ZStack {
                    surface
                    RoundedRectangle(cornerRadius: 10)
                        .fill(fill)
                        .padding(.horizontal, 10).padding(.vertical, 2)
                }
            )
            .onHover { hovered = $0 }
    }
}

private struct AvatarContact: Identifiable {
    let agent: Agent
    var id: String { agent.id }
}

private enum AgentFilter: String, CaseIterable, Identifiable {
    case all = "All", unread = "Unread", active = "Active"
    var id: String { rawValue }
}

private enum AgentOrder: String, CaseIterable, Identifiable {
    case recent = "Most recent", name = "Name"
    var id: String { rawValue }
}
