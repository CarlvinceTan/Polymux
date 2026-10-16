import SwiftUI
import PolymuxKit

@main
enum PolymuxMain {
    @MainActor static func main() {
        #if os(macOS)
        if CommandLine.arguments.contains("--companion") {
            let app = NSApplication.shared
            app.setActivationPolicy(.accessory)
            let delegate = CompanionDelegate()
            app.delegate = delegate
            withExtendedLifetime(delegate) { app.run() }
            return
        }
        #endif
        PolymuxApp.main()
    }
}

struct PolymuxApp: App {
    #if os(macOS)
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    #else
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    #endif

    init() {
        _ = Notifications.shared
        #if os(macOS)
        #if DEBUG
        if !VerifyFixture.enabled && !CommandLine.arguments.contains("--verify-approval") {
            ControlCoordinator.shared.start()
        }
        #else
        ControlCoordinator.shared.start()
        #endif
        #endif
    }
    var body: some Scene {
        WindowGroup {
            AppRoot()
                .tint(Color("AccentColor"))
                #if os(macOS)
                .frame(minWidth: 780, minHeight: 500)
                #else
                .frame(minWidth: 360, minHeight: 500)
                #endif
        }
        #if os(macOS)
        .defaultSize(width: 1060, height: 760)
        .commands {
            CommandGroup(replacing: .sidebar) {}
        }
        #endif
    }
}

@MainActor
final class AppSession {
    let client: APIClient
    let cache: LocalCache
    let sidebar: SidebarStore
    let settings: SettingsStore
    let avatars: AvatarStore

    init(address: String) async throws {
        guard let url = ServerAddress.resolve(address, defaults: .standard) else {
            throw URLError(.badURL)
        }
        #if DEBUG
        client = APIClient(baseURL: url, session: VerifyFixture.local ? VerifyFixture.session() : .shared,
                           token: VerifyFixture.local ? "" : nil)
        #else
        client = APIClient(baseURL: url)
        #endif
        cache = try await Task.detached {
            let file = ClientPaths.cache(address)
            let directory = file.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            return try LocalCache(url: file)
        }.value
        sidebar = SidebarStore(client: client, cache: cache)
        await sidebar.load()
        settings = SettingsStore(client: client)
        avatars = AvatarStore(sidebar: sidebar)
    }
}

struct AppRoot: View {
    @AppStorage("serverAddress") private var address = "http://cvmini.taila465a3.ts.net:8787"
    @State private var session: AppSession?
    @State private var error: String?
    @State private var showSettings = false

    var body: some View {
        Group {
            #if DEBUG
            if CommandLine.arguments.contains("--verify-approval") {
                ApprovalFixture()
            } else {
                content
            }
            #else
            content
            #endif
        }
        #if os(macOS)
        .allowsWindowActivationEvents()
        #endif
        .neutralBackground()
        .task(id: address) {
            #if DEBUG
            guard !CommandLine.arguments.contains("--verify-approval") else { return }
            #endif
            do {
                session = try await AppSession(address: address)
                error = nil
                if let session {
                    #if DEBUG
                    if !VerifyFixture.local { Notifications.shared.connect(session.client) }
                    #else
                    Notifications.shared.connect(session.client)
                    #endif
                    while !Task.isCancelled {
                        await session.settings.refresh()
                        do { try await Task.sleep(for: .seconds(3)) }
                        catch { break }
                    }
                }
            } catch {
                session = nil
                self.error = error.localizedDescription
            }
        }
        .panel(isPresented: $showSettings) {
            ConnectionView(address: $address, settings: session?.settings, onClose: { showSettings = false })
                .id(address)
        }
        .panelHost()
        .environment(session?.avatars)
        .appAppearance(appearance)
        #if os(macOS)
        .background { InputFocus().frame(width: 0, height: 0).accessibilityHidden(true) }
        #endif
    }

    private var appearance: String {
        #if DEBUG
        if CommandLine.arguments.contains("--verify-approval") {
            return CommandLine.arguments.contains("--approval-dark") ? "dark" : "light"
        }
        #endif
        return session?.settings.value?.appearance ?? "system"
    }

    private var content: some View {
        Group {
            if let session {
                ShellView(session: session, showSettings: $showSettings)
                    .id(address)
            } else {
                ContentUnavailableView {
                    Label("Connect to Polymux", systemImage: "network")
                } description: {
                    Text(error ?? "Opening your conversations…")
                } actions: {
                    Button("Connection settings") { showSettings = true }
                }
            }
        }
    }
}

struct ConnectionView: View {
    @Binding var address: String
    let settings: SettingsStore?
    let onClose: () -> Void
    @State private var draft = ""
    @FocusState private var serverFocused: Bool

    var body: some View {
        PanelView("Settings", onClose: close) {
            Form {
                if let settings, let value = settings.value {
                    Section("Appearance") {
                        Picker("Theme", selection: Binding(get: { settings.value?.appearance ?? value.appearance },
                                                          set: { settings.edit(SettingsPatch(appearance: $0)) })) {
                            Text("Light").tag("light")
                            Text("Dark").tag("dark")
                            Text("System").tag("system")
                        }
                        .disabled(!settings.isConnected)
                    }
                    .panelRow()
                }
                Section("Agent server") {
                    TextField("Server address", text: $draft)
                        .labelsHidden()
                        .lineLimit(1)
                        .multilineTextAlignment(.leading)
                        .autocorrectionDisabled()
                        .focused($serverFocused)
                        .onSubmit { save() }
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                }
                .panelRow()
                if let settings {
                    VoiceSettings(store: settings)
                    if let issue = settings.error {
                        Section {
                            Text(issue).font(.footnote).foregroundStyle(.red)
                            Button("Retry") { Task { await settings.retry() } }
                        }
                        .panelRow()
                    } else if settings.value == nil {
                        Section { ProgressView() }
                            .panelRow()
                    }
                }
                Section("Notifications") {
                    Toggle("Allow notifications", isOn: Binding(get: { Notifications.shared.enabled },
                        set: { enabled in Task { await Notifications.shared.allow(enabled) } }))
                    if let issue = Notifications.shared.issue {
                        Text(issue).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .panelRow()
                #if os(macOS)
                ControlSettings(server: ServerAddress.parse(address))
                #endif
            }
            .formStyle(.grouped)
            .defaultFocus($serverFocused, false)
        }
        .panelDismiss(onClose: close)
        #if os(macOS)
        .background { SettingsFocus().frame(width: 0, height: 0).accessibilityHidden(true) }
        #endif
        .onAppear { draft = address; serverFocused = false }
        .task(id: draft) {
            guard ServerAddress.parse(draft) != nil else { return }
            do { try await Task.sleep(for: .milliseconds(600)) }
            catch { return }
            save()
        }
        .onDisappear { save() }
    }

    private func save() {
        guard let url = ServerAddress.parse(draft), url.absoluteString != address else { return }
        address = url.absoluteString
    }

    private func close() {
        save()
        onClose()
    }
}

#if os(macOS)
import AppKit

private struct SettingsFocus: NSViewRepresentable {
    func makeNSView(context: Context) -> SettingsAnchor { SettingsAnchor() }
    func updateNSView(_ view: SettingsAnchor, context: Context) {}
}

private final class SettingsAnchor: NSView {
    override var acceptsFirstResponder: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard let window else { return }
        // Native form focus settles after the panel is inserted, even when SwiftUI focus starts false.
        DispatchQueue.main.async { [weak self, weak window] in
            DispatchQueue.main.async { [weak self, weak window] in
                guard let self, let window, self.window === window, window.isKeyWindow else { return }
                if window.firstResponder is NSTextField || (window.firstResponder as? NSTextView)?.isFieldEditor == true {
                    window.makeFirstResponder(self)
                }
            }
        }
    }
}
#endif
