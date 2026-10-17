import SwiftUI
import PolymuxKit

struct RoutinePanel: View {
    let agentID: String
    let row: PolymuxKit.ActivityRow
    let client: APIClient
    @Environment(\.panelClose) private var close
    @Environment(\.colorScheme) private var scheme
    @State private var routine: Routine?
    @State private var prompt = ""
    @State private var loading = true
    @State private var busy = false
    @State private var issue: String?

    private var editable: Bool { routine?.status == "active" || routine?.status == "paused" }
    private var cleanPrompt: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        PanelView("Routine", enabled: !busy, onClose: { close() }) {
            Form {
                if loading {
                    Section { ProgressView("Loading routine…") }.panelRow()
                } else if let routine {
                    Section {
                        TextField("Name", text: $prompt, axis: .vertical)
                            .lineLimit(2...4).disabled(!editable || busy)
                        Toggle("Enabled", isOn: Binding(
                            get: { routine.status == "active" },
                            set: { enabled in Task { await update(enabled: enabled) } }))
                            .disabled(!editable || busy)
                        if let date = routine.nextAt.flatMap(WireDate.parse) {
                            LabeledContent("Next run", value: date.formatted(date: .abbreviated, time: .shortened))
                        } else {
                            Text(routine.status.capitalized).foregroundStyle(ActivityInk.color(scheme))
                        }
                    }
                    .panelRow()
                } else if issue == nil {
                    Section { Text("This routine is no longer available.").foregroundStyle(ActivityInk.color(scheme)) }.panelRow()
                }
                if let issue {
                    Section {
                        Text(issue).foregroundStyle(ActivityInk.color(scheme))
                        if routine == nil { Button("Try again") { Task { await load() } } }
                    }
                    .panelRow()
                }
            }
            .formStyle(.grouped)
        } actions: {
            Button("Save") { Task { await update(prompt: cleanPrompt) } }
                .disabled(!editable || busy || cleanPrompt.isEmpty || cleanPrompt == routine?.prompt)
        }
        .panelDismiss(enabled: !busy, onClose: { close() })
        .task { await load() }
    }

    private func load() async {
        loading = true
        issue = nil
        defer { loading = false }
        do {
            routine = try await client.routines(agentID: agentID).first { $0.id == row.payload.objectID }
            prompt = routine?.prompt ?? row.payload.objectLabel
        } catch { issue = error.localizedDescription }
    }

    private func update(prompt: String? = nil, enabled: Bool? = nil) async {
        guard !busy else { return }
        busy = true
        issue = nil
        defer { busy = false }
        do {
            routine = try await client.updateRoutine(agentID: agentID, routineID: row.payload.objectID, prompt: prompt, enabled: enabled)
        } catch { issue = error.localizedDescription }
    }
}
