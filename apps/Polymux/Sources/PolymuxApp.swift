import CoreImage
import CryptoKit
import SwiftUI
import PolymuxKit
#if os(macOS)
import AppKit
import PolymuxControl
#else
import UIKit
#endif

@main
enum PolymuxMain {
    @MainActor static func main() {
        #if os(macOS)
        if let index = CommandLine.arguments.firstIndex(of: "--verify-accessibility") {
            guard CommandLine.arguments.indices.contains(index + 1),
                  let nonce = UUID(uuidString: CommandLine.arguments[index + 1]) else { return }
            let result = FileManager.default.temporaryDirectory
                .appending(path: "polymux-ui-accessibility-\(nonce.uuidString).json")
            let value = ["accessibility": ControlPermissions.accessibility]
            if let data = try? JSONEncoder().encode(value) { try? data.write(to: result, options: .atomic) }
            return
        }
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
        FrameLog.install()
        #if os(macOS)
        #if DEBUG
        if !VerifyFixture.enabled && !CommandLine.arguments.contains("--verify-approval") {
            _ = ServerRuntime.shared
            ControlCoordinator.shared.start()
        }
        #else
        _ = ServerRuntime.shared
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
    @AppStorage("serverAddress") private var address = "http://127.0.0.1:7337"
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
            while !Task.isCancelled {
                do {
                    let opened = try await AppSession(address: address)
                    session = opened
                    error = nil
                    #if DEBUG
                    if !VerifyFixture.local { Notifications.shared.connect(opened.client) }
                    #else
                    Notifications.shared.connect(opened.client)
                    #endif
                    while !Task.isCancelled {
                        await opened.settings.refresh()
                        if !opened.sidebar.isConnected { break }
                        do { try await Task.sleep(for: .seconds(3)) }
                        catch { break }
                    }
                } catch {
                    session = nil
                    self.error = error.localizedDescription
                }
                if Task.isCancelled { break }
                try? await Task.sleep(for: .seconds(2))
            }
        }
        .onOpenURL { handleConnect($0) }
        .onAppear {
            URLRouter.shared.handler = { handleConnect($0) }
            #if os(macOS)
            if ServerRuntime.shared.enabled { address = ServerRuntime.address }
            #endif
        }
        .panel(isPresented: $showSettings) {
            ConnectionView(address: $address, settings: session?.settings, client: session?.client,
                           onClose: { showSettings = false })
                .id(address)
        }
        .panelHost()
        .environment(session?.avatars)
        .appAppearance(appearance)
        #if os(macOS)
        .background { InputFocus().frame(width: 0, height: 0).accessibilityHidden(true) }
        #endif
    }

    private func handleConnect(_ url: URL) {
        guard url.scheme == "polymux", url.host == "connect",
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let target = parts.queryItems?.first(where: { $0.name == "url" })?.value,
              let token = parts.queryItems?.first(where: { $0.name == "token" })?.value,
              let parsed = ServerAddress.parse(target) else { return }
        let file = ClientPaths.token(parsed.absoluteString)
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        try? token.write(to: file, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        address = parsed.absoluteString
    }

    private var appearance: String {
        #if DEBUG
        if VerifyFixture.enabled { return UserDefaults.standard.string(forKey: "AppleInterfaceStyle")?.lowercased() ?? "system" }
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
    let client: APIClient?
    let onClose: () -> Void
    @State private var draft = ""
    @State private var notificationToggle = OptimisticToggle(isOn: Notifications.shared.enabled)
    @FocusState private var serverFocused: Bool
    #if os(macOS)
    @ObservedObject private var server = ServerRuntime.shared
    #endif
    @State private var network: NetworkInfo?
    @State private var networkIssue: String?
    @State private var invite: NetworkInvite?
    @State private var migrating = false
    @State private var migrationError: String?
    @State private var confirmMigration = false

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
                Section("Devices") {
                    if let network {
                        HStack(spacing: 16) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(network.server.name).font(.headline)
                                Text(network.server.role.capitalized)
                                Text(network.server.platform)
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("Server").font(.caption).foregroundStyle(.secondary)
                        }
                        if let invite {
                            HStack(spacing: 16) {
                                QRCodeView(text: inviteLink(invite))
                                    .frame(width: 112, height: 112)
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Connect a device").font(.headline)
                                    Text("Scan the code, or copy the link and open it on another device.")
                                        .font(.footnote).foregroundStyle(.secondary)
                                    Text("The link grants access to this server. Share it only with your own devices.")
                                        .font(.caption2).foregroundStyle(.secondary)
                                    Button("Copy link") { copy(inviteLink(invite)) }
                                }
                            }
                        }
                        ForEach(network.devices) { device in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(device.name)
                                    Text(device.agent == "local" ? "This server" : device.agent)
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(device.agent == "local" ? "Server" : (device.connected ? "Online" : "Offline"))
                                    .font(.caption)
                                    .foregroundStyle(device.agent == "local" || device.connected ? Color.green : Color.secondary)
                            }
                        }
                        if network.devices.isEmpty {
                            Text("No other devices are linked yet.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    } else if let networkIssue {
                        Text(networkIssue)
                            .font(.footnote).foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity, minHeight: 96, alignment: .center)
                    } else {
                        HStack {
                            Spacer()
                            ProgressView().controlSize(.small)
                            Spacer()
                        }
                        .frame(height: 96)
                    }
                    #if os(macOS)
                    if !server.enabled {
                        if network == nil {
                            Button("Start a local server") {
                                server.setEnabled(true)
                                draft = ServerRuntime.address
                                address = ServerRuntime.address
                            }
                            .disabled(migrating)
                        } else {
                            Button("Make this device the server") { confirmMigration = true }
                                .disabled(migrating)
                        }
                    } else {
                        Text("This device is the server.")
                            .font(.footnote).foregroundStyle(.secondary)
                        Toggle("Keep it running", isOn: Binding(get: { server.autoRepair },
                                                                 set: { server.setAutoRepair($0) }))
                    }
                    if migrating {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text(server.migration ?? "Preparing migration…")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 32, alignment: .center)
                    }
                    if let migrationError {
                        Text(migrationError).font(.footnote).foregroundStyle(.red)
                    }
                    #endif
                    Button("Refresh") { Task { await loadNetwork() } }
                        .disabled(migrating)
                }
                .panelRow()
                if let settings {
                    VoiceSettings(store: settings)
                }
                Section("Notifications") {
                    let choice = notificationToggle.binding { enabled in
                        await Notifications.shared.allow(enabled)
                        guard Notifications.shared.enabled == enabled else {
                            throw ToggleFailure(Notifications.shared.issue ?? "Couldn’t update notification permission.")
                        }
                    }
                    Toggle("Allow notifications", isOn: choice.isOn)
                    if let issue = toggleIssue(notificationToggle.message, Notifications.shared.issue) {
                        Text(issue).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .panelRow()
                .onChange(of: Notifications.shared.enabled, initial: true) { _, enabled in
                    notificationToggle.adopt(enabled)
                }
                DisclosureGroup("Advanced") {
                    Section("Connection") {
                        TextField("Server address", text: $draft)
                            .lineLimit(1)
                            .multilineTextAlignment(.leading)
                            .autocorrectionDisabled()
                            .focused($serverFocused)
                            .onSubmit { save() }
                        if let issue = settings?.error {
                            Text(issue).font(.footnote).foregroundStyle(.red)
                            Button("Retry") { Task { await settings?.retry() } }
                        }
                    }
                    #if os(macOS)
                    Section("This Mac") {
                        HStack {
                            Button("Open logs") { server.openLogs() }
                            Button("Show data") { server.openData() }
                            Button("Install command line tool") { server.installCLI() }
                        }
                        if let message = server.cliMessage {
                            Text(message).font(.footnote).foregroundStyle(.secondary)
                        }
                        if server.binaryURL == nil {
                            Text("The server binary is missing. Reinstall Polymux, or install it at ~/.polymux/bin/polymux-server.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    ControlSettings(server: ServerAddress.parse(address))
                    #endif
                }
                .panelRow()
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
        .task { await loadNetwork() }
        .onChange(of: address) { _, _ in Task { await loadNetwork() } }
        .confirmationDialog("Make this device the server?", isPresented: $confirmMigration) {
            Button("Copy data and switch") { Task { await migrateHere() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Polymux copies the current server's data, verifies its checksum, and starts this device as the server. The old copy stays in place until you remove it.")
        }
    }

    private func migrateHere() async {
        guard let url = ServerAddress.parse(address), let client else {
            migrationError = "Connect to the current server first."
            return
        }
        migrating = true
        migrationError = nil
        defer { migrating = false }
        do {
            let (data, expected) = try await client.exportNetwork()
            let actual = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            guard actual == expected.lowercased() else {
                throw MigrationError("The copied data did not match its checksum.")
            }
            let file = FileManager.default.temporaryDirectory.appending(path: "polymux-export-\(UUID().uuidString).tar.gz")
            try data.write(to: file, options: .atomic)
            defer { try? FileManager.default.removeItem(at: file) }
            #if os(macOS)
            let started = await server.importArchive(file)
            guard started else {
                throw MigrationError(server.migration ?? "The new server did not start.")
            }
            draft = ServerRuntime.address
            address = ServerRuntime.address
            await loadNetwork()
            #else
            _ = url
            throw MigrationError("Only a desktop Polymux can be the server.")
            #endif
        } catch {
            migrationError = error.localizedDescription
        }
    }

    private func inviteLink(_ invite: NetworkInvite) -> String {
        var parts = URLComponents()
        parts.scheme = "polymux"
        parts.host = "connect"
        parts.queryItems = [URLQueryItem(name: "url", value: invite.url),
                            URLQueryItem(name: "token", value: invite.token)]
        return parts.string ?? invite.url
    }

    private func copy(_ value: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
        #else
        UIPasteboard.general.string = value
        #endif
    }

    private func loadNetwork() async {
        guard let url = ServerAddress.parse(address) else { return }
        do {
            let api = client?.baseURL == url ? client! : APIClient(baseURL: url)
            network = try await api.network()
            invite = try? await api.networkInvite()
            networkIssue = nil
        } catch {
            network = nil
            invite = nil
            networkIssue = error.localizedDescription
        }
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


private struct QRCodeView: View {
    let text: String

    var body: some View {
        if let image = qrImage {
            Image(decorative: image, scale: 1)
                .interpolation(.none)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .accessibilityLabel("Connection QR code")
        } else {
            Image(systemName: "qrcode")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .foregroundStyle(.secondary)
        }
    }

    private var qrImage: CGImage? {
        let filter = CIFilter(name: "CIQRCodeGenerator")
        filter?.setValue(Data(text.utf8), forKey: "inputMessage")
        filter?.setValue("M", forKey: "inputCorrectionLevel")
        guard let output = filter?.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        return CIContext().createCGImage(scaled, from: scaled.extent)
    }
}

private struct MigrationError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
