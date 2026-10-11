#if os(macOS)
import SwiftUI
import AppKit
import ServiceManagement
import PolymuxControl

@MainActor @Observable
final class ControlCoordinator {
    static let shared = ControlCoordinator()
    private(set) var settings = ControlState()
    private(set) var status = ControlStatus()
    private(set) var agent: String?
    private(set) var server: String?
    private(set) var approved: [String] = []
    private(set) var issue: String?
    private(set) var background = false
    private(set) var approvalNeeded = false
    private(set) var busy = false
    private(set) var accessibility = false
    private(set) var screen = false
    private let root: URL
    private let service = SMAppService.agent(plistName: "com.flarehq.polymux.app.control.plist")
    private let channel: DeviceChannel
    private var lease: ControlLease?
    private var monitor: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?
    private var active: UUID?
    private var stopping = false

    private init() {
        root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "Polymux/control", directoryHint: .isDirectory)
        channel = DeviceChannel(root: root, binary: Bundle.main.bundleURL.appending(path: "Contents/Helpers/cua-driver"),
                                bundleID: Bundle.main.bundleIdentifier ?? "com.flarehq.polymux.app")
    }

    func start() {
        guard monitor == nil, !stopping else { return }
        monitor = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.refresh()
                do { try await Task.sleep(for: .seconds(3)) } catch { return }
            }
        }
    }

    private func refresh() async {
        guard !stopping, !busy else { return }
        if let refreshTask { await refreshTask.value; return }
        let task = Task { await synchronize() }
        refreshTask = task
        await task.value
        refreshTask = nil
    }

    private func synchronize() async {
        background = service.status == .enabled || service.status == .requiresApproval
        approvalNeeded = service.status == .requiresApproval
        accessibility = ControlPermissions.accessibility; screen = ControlPermissions.screen
        do {
            try Task.checkCancellation()
            settings = try ControlState.load(root)
            let credential = try Pairing.load()
            agent = credential?.agent; approved = credential?.capabilities ?? []
            server = credential?.url.host
            guard settings.enabled, let credential else {
                if lease != nil {
                    await channel.stop(); active = nil
                    status = ControlStatus(); status.save(root); lease = nil
                }
                status = ControlStatus()
                return
            }
            if lease == nil { lease = ControlLease(root: root) }
            guard lease != nil else { status = ControlStatus.load(root) ?? ControlStatus(); return }
            // A paired Mac asks for its permissions once instead of waiting to be prompted.
            if settings.native, !settings.permissionRequest, !(accessibility && screen) {
                requestPermissions()
            }
            if active != settings.revision {
                try await channel.connect(credential, settings: settings)
                try Task.checkCancellation()
                active = settings.revision
            } else { try await channel.refresh() }
            status = await channel.status
            status.updated = Date(); status.save(root)
        } catch {
            await channel.stop(); active = nil
            status = ControlStatus(); status.issue = error.localizedDescription; status.save(root)
        }
    }

    @discardableResult
    func update(enabled: Bool? = nil, native: Bool? = nil, commands: Bool? = nil) -> Bool {
        do {
            var next = try ControlState.load(root)
            if let enabled { next.enabled = enabled }
            if let native { next.native = native }
            if let commands { next.commands = commands }
            next.revision = UUID()
            try next.save(root); settings = next; issue = nil
            Task { await refresh() }
            return true
        } catch { issue = "Couldn’t save Mac control settings."; return false }
    }

    func pair(_ ticket: PairTicket, native: Bool, commands: Bool) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do {
            guard try Pairing.load() == nil else { throw ControlError.denied }
            var caps: [String] = []
            if native { caps.append("native") }
            if commands { caps.append("commands") }
            let credential = try await Pairing.enroll(ticket, capabilities: caps, name: Host.current().localizedName ?? "Mac")
            do { try Pairing.save(credential) }
            catch {
                try? await Pairing.revoke(credential)
                throw error
            }
            var next = ControlState(); next.enabled = true; next.native = native; next.commands = commands
            try next.save(root)
            issue = nil
            await refresh()
        } catch { issue = "Pairing wasn’t completed. Inspect device list on the server before creating another code." }
    }

    func requestPermissions() {
        guard settings.native else { return }
        ControlPermissions.request()
        do {
            var next = try ControlState.load(root)
            next.permissionRequest = true; next.revision = UUID(); try next.save(root)
        } catch { issue = "Couldn’t save permission status." }
        accessibility = ControlPermissions.accessibility; screen = ControlPermissions.screen
    }

    func setBackground(_ enabled: Bool) async {
        do {
            if enabled { try service.register() }
            else { try await service.unregister() }
            background = service.status == .enabled || service.status == .requiresApproval
            approvalNeeded = service.status == .requiresApproval
            issue = nil
        } catch { issue = "Couldn’t change background control. Check Login Items in System Settings." }
    }

    func forget(clearData: Bool) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        guard update(enabled: false) else { return }
        refreshTask?.cancel()
        await channel.stop()
        await refreshTask?.value
        active = nil
        do {
            if service.status == .enabled || service.status == .requiresApproval { try await service.unregister() }
            if lease == nil {
                for _ in 0..<100 {
                    lease = ControlLease(root: root)
                    if lease != nil { break }
                    try await Task.sleep(for: .milliseconds(50))
                }
            }
            guard lease != nil else { throw ControlError.unavailable }
            if let credential = try Pairing.load() { try await Pairing.revoke(credential) }
            try Pairing.remove()
            if clearData { try FileManager.default.removeItem(at: root) }
            agent = nil; server = nil; approved = []; settings = ControlState(); status = ControlStatus(); background = false
            issue = nil
        } catch { issue = "Control is stopped locally. Server revocation or cleanup couldn’t be confirmed; the pairing is retained for review." }
        lease = nil
    }

    func stop() async {
        stopping = true
        monitor?.cancel(); let task = monitor; monitor = nil
        refreshTask?.cancel()
        await channel.stop()
        await refreshTask?.value
        await task?.value
        active = nil; lease = nil
    }
}

@MainActor
final class CompanionDelegate: NSObject, NSApplicationDelegate {
    private var opening = false
    func applicationDidFinishLaunching(_ notification: Notification) { ControlCoordinator.shared.start() }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        guard !opening else { return false }
        opening = true
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        configuration.arguments = ["--client"]
        Task {
            defer { opening = false }
            _ = try? await NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration)
        }
        return false
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Task { await ControlCoordinator.shared.stop(); sender.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
    }
}
#endif
