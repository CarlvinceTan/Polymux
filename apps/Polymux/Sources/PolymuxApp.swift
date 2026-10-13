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
        ControlCoordinator.shared.start()
        #endif
    }
    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if CommandLine.arguments.contains("--verify-approval") {
                ApprovalFixture()
            } else {
                root
            }
            #else
            root
            #endif
        }
        #if os(macOS)
        .defaultSize(width: 1060, height: 760)
        .commands {
            CommandGroup(replacing: .sidebar) {}
        }
        #endif
    }

    private var root: some View {
            AppRoot()
                .tint(Color("AccentColor"))
                #if os(macOS)
                .frame(minWidth: 780, minHeight: 500)
                #else
                .frame(minWidth: 360, minHeight: 500)
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
        guard let url = ServerAddress.parse(UserDefaults.standard.string(forKey: "PolymuxServer") ?? address) else {
            throw URLError(.badURL)
        }
        #if DEBUG
        client = APIClient(baseURL: url, session: VerifyFixture.local ? VerifyFixture.session() : .shared)
        #else
        client = APIClient(baseURL: url)
        #endif
        let key = address.utf8.reduce(UInt64(5381)) { ($0 &* 33) &+ UInt64($1) }
        cache = try await Task.detached {
            let support = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
            )
            let directory = ProcessInfo.processInfo.environment["POLYMUX_DATA_DIR"].map {
                URL(fileURLWithPath: $0, isDirectory: true)
                    .appending(path: "app-\(key)", directoryHint: .isDirectory)
            } ?? support.appending(path: "Polymux/\(key)", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            return try LocalCache(url: directory.appending(path: "cache.sqlite"))
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
        #if os(macOS)
        .allowsWindowActivationEvents()
        #endif
        .neutralBackground()
        .task(id: address) {
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
        .appAppearance(session?.settings.value?.appearance ?? "system")
        #if os(macOS)
        .background { InputFocus().frame(width: 0, height: 0).accessibilityHidden(true) }
        #endif
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
