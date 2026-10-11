import SwiftUI
import LuceKit

@main
enum LuceMain {
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
        LuceApp.main()
    }
}

struct LuceApp: App {
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

    init(address: String) throws {
        guard let url = ServerAddress.parse(address) else {
            throw URLError(.badURL)
        }
        client = APIClient(baseURL: url)
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let key = address.utf8.reduce(UInt64(5381)) { ($0 &* 33) &+ UInt64($1) }
        let directory = support.appending(path: "Luce/\(key)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        cache = try LocalCache(url: directory.appending(path: "cache.sqlite"))
        sidebar = SidebarStore(client: client, cache: cache)
        settings = SettingsStore(client: client)
        avatars = AvatarStore(sidebar: sidebar)
    }
}

struct AppRoot: View {
    @AppStorage("serverAddress") private var address = "http://100.127.193.111:7337"
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
                    Label("Connect to Luce", systemImage: "network")
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
                session = try AppSession(address: address)
                error = nil
                if let session {
                    Notifications.shared.connect(session.client)
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
