#if os(macOS)
import SwiftUI
import AppKit
import ServiceManagement
import PolymuxControl
import PolymuxKit

struct ControlSettings: View {
    let server: URL?
    private var control: ControlCoordinator { .shared }
    @State private var code = ""
    @State private var native = true
    @State private var commands = false
    @State private var grantPermissions = false
    @State private var forget = false
    @State private var backgroundToggle = OptimisticToggle(isOn: ControlCoordinator.shared.background)

    private var ticket: PairTicket? {
        guard let server else { return nil }
        return try? PairTicket.parse(code, server: server)
    }

    var body: some View {
        Section("This Mac") {
            if let agent = control.agent {
                LabeledContent("Agent", value: agent)
                if let server = control.server { LabeledContent("Server", value: server) }
                Toggle("Allow Mac control", isOn: Binding(get: { control.settings.enabled }, set: { control.update(enabled: $0) }))
                if control.approved.contains("native") {
                    Toggle("Observe and control apps", isOn: Binding(get: { control.settings.native }, set: { control.update(native: $0) }))
                    if control.settings.native {
                        LabeledContent("Accessibility", value: permission(control.accessibility))
                        LabeledContent("Screen Recording", value: permission(control.screen))
                        if !control.accessibility || !control.screen {
                            Button("Grant permissions") { grantPermissions = true }
                            Button("Open Privacy settings") {
                                let pane = control.accessibility ? "Privacy_ScreenCapture" : "Privacy_Accessibility"
                                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") { NSWorkspace.shared.open(url) }
                            }
                            Text("After changing a grant, quit and reopen Polymux. Chat works without these permissions.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                if control.approved.contains("commands") {
                    Toggle("Commands and files", isOn: Binding(get: { control.settings.commands }, set: { control.update(commands: $0) }))
                }
                let choice = backgroundToggle.binding { enabled in
                    await control.setBackground(enabled)
                    guard control.background == enabled else {
                        throw ToggleFailure(control.issue ?? "Couldn’t change background control. Check Login Items in System Settings.")
                    }
                }
                Toggle("Keep control in background", isOn: choice.isOn)
                if control.approvalNeeded {
                    Button("Approve in Login Items") { SMAppService.openSystemSettingsLoginItems() }
                }
                Text(control.status.issue ?? (control.settings.enabled ? (control.status.connected ?
                    (control.status.ready.isEmpty ? "Connected. No capabilities are ready." : "Connected") : "Connecting…") : "Off"))
                    .font(.footnote).foregroundStyle(.secondary)
                Button("Forget this Mac", role: .destructive) { forget = true }
            } else {
                SecureField("Pairing code", text: $code).lineLimit(1)
                if let ticket {
                    LabeledContent("Agent", value: ticket.agent)
                    LabeledContent("Server", value: ticket.url.host ?? "")
                    if ticket.capabilities.contains("native") {
                        Toggle("Observe and control apps", isOn: $native)
                        if native { Text("Requires Accessibility and Screen Recording. Verification takes one temporary screen capture.").font(.footnote).foregroundStyle(.secondary) }
                    }
                    if ticket.capabilities.contains("commands") {
                        Toggle("Commands and files", isOn: $commands)
                        if commands { Text("Allows commands with your account’s file access. Folder permissions are requested only when needed.").font(.footnote).foregroundStyle(.secondary) }
                    }
                    Button("Pair this Mac") {
                        let useNative = native && ticket.capabilities.contains("native")
                        let useCommands = commands && ticket.capabilities.contains("commands")
                        code = ""
                        Task { await control.pair(ticket, native: useNative, commands: useCommands) }
                    }
                    .disabled(control.busy || (!native && !commands) || (!ticket.capabilities.contains("native") && !commands))
                } else {
                    Text("Create a single-use code on the server with polymux-server device pair -agent ID. Chat does not require pairing.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            if let issue = toggleIssue(backgroundToggle.message, control.issue) {
                Text(issue).font(.footnote).foregroundStyle(.red)
            }
        }
        .onChange(of: control.background, initial: true) { _, enabled in
            backgroundToggle.adopt(enabled)
        }
        .confirmationDialog("Allow app observation and control?", isPresented: $grantPermissions) {
            Button("Request permissions") { control.requestPermissions() }
        } message: {
            Text("Polymux needs Accessibility and Screen Recording. Readiness checks take one screen capture, kept only for the check. Enable Polymux in both Privacy panes, then relaunch it.")
        }
        .confirmationDialog("Forget this Mac?", isPresented: $forget) {
            Button("Forget pairing", role: .destructive) { Task { await control.forget(clearData: false) } }
            Button("Forget and remove control data", role: .destructive) { Task { await control.forget(clearData: true) } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Stops local control, removes the background registration and revokes this pairing. Conversations and independently installed tools are not changed.") }
    }

    private func permission(_ granted: Bool) -> String {
        granted ? "Granted" : (control.settings.permissionRequest ? "Not granted" : "Not requested")
    }
}
#endif
