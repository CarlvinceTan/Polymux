import SwiftUI
import LuceKit

struct AgentEditor: View {
    let agent: Agent
    let session: AppSession
    @Environment(\.panelClose) private var dismiss
    @State private var name: String
    @State private var role: String
    @State private var prompt = ""
    @State private var loaded = false
    @State private var loading = true
    @State private var saving = false
    @State private var issue: String?
    @State private var showAvatar = false
    @State private var avatarHovered = false
    @State private var promptHeight: CGFloat = 72
    @State private var reviews: Proactivity?
    @State private var routines: [Routine] = []
    @State private var scheduleBusy = false

    init(agent: Agent, session: AppSession) {
        self.agent = agent
        self.session = session
        _name = State(initialValue: agent.name)
        _role = State(initialValue: agent.role)
    }

    private var cleanName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var showsEdit: Bool {
        #if os(macOS)
        avatarHovered
        #else
        true
        #endif
    }

    var body: some View {
        PanelView("Edit profile", enabled: !saving && !showAvatar, onClose: { dismiss() }) {
            Form {
                Section("Avatar") {
                    HStack {
                        Spacer()
                        Button { showAvatar = true } label: {
                            AvatarView(options: session.avatars.options(for: agent.id))
                                .frame(width: 100, height: 100)
                                .overlay(alignment: .topTrailing) {
                                    Image(systemName: "pencil")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.primary)
                                        .frame(width: 26, height: 26)
                                        .background(.regularMaterial, in: Circle())
                                        .opacity(showsEdit ? 1 : 0)
                                        .allowsHitTesting(false)
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Edit avatar")
                        .onHover { avatarHovered = $0 }
                        Spacer()
                    }
                    .padding(.vertical, 8)
                    .disabled(saving)
                }
                .panelRow()
                Section("Profile") {
                    LabeledContent("Name") {
                        TextField("Name", text: $name)
                            .autocorrectionDisabled()
                            .labelsHidden()
                            .multilineTextAlignment(.leading)
                    }
                    LabeledContent("Role") {
                        TextField("Role", text: $role)
                            .labelsHidden()
                            .multilineTextAlignment(.leading)
                    }
                }
                .textFieldStyle(.roundedBorder)
                .disabled(saving)
                .panelRow()
                Section {
                    roleEditor
                } header: {
                    Text("Role description")
                } footer: {
                    Text("Describe what this agent should do and how it should respond.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .disabled(!loaded || saving)
                .panelRow()
                if loading {
                    Section { ProgressView("Loading profile…") }
                        .panelRow()
                }
                if let issue {
                    Section {
                        Text(issue).foregroundStyle(.secondary).textSelection(.enabled)
                        if !loaded {
                            Button("Try again") { Task { await load() } }
                                .disabled(loading)
                        }
                    }
                    .panelRow()
                }
                if loaded {
                    scheduleSection
                }
            }
            .formStyle(.grouped)
        } actions: {
            Button { Task { await save() } } label: {
                if saving { ProgressView().controlSize(.small) }
                else { Text("Save") }
            }
            .disabled(!loaded || loading || saving || cleanName.isEmpty)
        }
        .panel(isPresented: $showAvatar) {
            AvatarEditor(agentID: agent.id, name: cleanName.isEmpty ? agent.name : cleanName,
                         client: session.client, store: session.avatars)
        }
        .interactiveDismissDisabled(saving)
        .panelDismiss(enabled: !saving && !showAvatar, onClose: { dismiss() })
        .task { await load() }
    }

    // What this agent does on its own: its review cadence and the routines it scheduled.
    @ViewBuilder private var scheduleSection: some View {
        Section {
            Toggle("Background reviews", isOn: Binding(
                get: { reviews?.enabled ?? false },
                set: { enabled in Task { await setReviews(enabled) } }))
                .disabled(reviews == nil || scheduleBusy)
            ForEach(routines, id: \.id) { routine in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(routine.prompt).lineLimit(2)
                        Text(routine.status == "pending" ? "Waiting for your approval" : nextFire(routine))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Button("Cancel", role: .destructive) { Task { await cancel(routine) } }
                        .buttonStyle(.plain)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .disabled(scheduleBusy)
                        .accessibilityLabel("Cancel \(routine.prompt)")
                }
            }
            if routines.isEmpty && reviews == nil {
                Text("Nothing scheduled yet.").foregroundStyle(.secondary)
            }
        } header: {
            Text("Schedule")
        }
        .panelRow()
    }

    private func nextFire(_ routine: Routine) -> String {
        guard let at = routine.nextAt, let date = WireDate.parse(at) else { return "Scheduled" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    private func setReviews(_ enabled: Bool) async {
        guard !scheduleBusy else { return }
        scheduleBusy = true
        defer { scheduleBusy = false }
        let current = reviews
        reviews = try? await session.client.setProactivity(
            agentID: agent.id,
            settings: Proactivity(enabled: enabled, intervalSeconds: current?.intervalSeconds ?? 14400))
    }

    private func cancel(_ routine: Routine) async {
        guard !scheduleBusy else { return }
        scheduleBusy = true
        defer { scheduleBusy = false }
        _ = try? await session.client.deleteRoutine(agentID: agent.id, routineID: routine.id)
        routines = (try? await session.client.routines(agentID: agent.id)) ?? routines
    }

    private var roleEditor: some View {
        TextEditor(text: $prompt)
            .font(.body)
            .scrollContentBackground(.hidden)
            .scrollIndicators(.hidden)
            .background(Color.clear)
            .frame(height: promptHeight)
            .background(alignment: .topLeading) {
                if prompt.isEmpty {
                    TextEditor(text: .constant("Add a role description…"))
                        .font(.body).foregroundStyle(.tertiary)
                        .scrollContentBackground(.hidden)
                        .scrollIndicators(.hidden)
                        .scrollDisabled(true)
                        .disabled(true)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .background(alignment: .topLeading) {
                Text(prompt.isEmpty ? " " : prompt + "\n")
                    .font(.body)
                    .padding(.horizontal, 5).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { height in
                        promptHeight = min(220, max(72, height))
                    }
                    .hidden()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .accessibilityLabel("Role description")
    }

    private func load() async {
        guard !loaded else { return }
        loading = true
        issue = nil
        defer { loading = false }
        do {
            let profile = try await session.client.agentProfile(id: agent.id)
            try Task.checkCancellation()
            if name == agent.name { name = profile.agent.name }
            if role == agent.role { role = profile.agent.role }
            prompt = profile.prompt
            loaded = true
            async let schedule = session.client.proactivity(agentID: agent.id)
            async let scheduled = session.client.routines(agentID: agent.id)
            reviews = try? await schedule
            routines = (try? await scheduled) ?? []
        } catch is CancellationError {
        } catch {
            issue = "Couldn’t load this profile. \(error.localizedDescription)"
        }
    }

    private func save() async {
        guard loaded, !saving, !cleanName.isEmpty else { return }
        saving = true
        issue = nil
        defer { saving = false }
        do {
            let update = UpdateAgentRequest(name: cleanName,
                                            role: role.trimmingCharacters(in: .whitespacesAndNewlines),
                                            prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines))
            let profile = try await session.client.updateAgent(id: agent.id, request: update)
            session.sidebar.accept(profile.agent)
            await session.sidebar.refresh()
            dismiss()
        } catch {
            issue = "Couldn’t save this profile. \(error.localizedDescription)"
        }
    }
}
