// PR #42 iOS check harness. Runs inside a booted simulator via `simctl spawn` (this host has no
// Simulator UI), renders the real NewChatView/ShellView in a UIWindow, and drives the same
// InstantChat/InstantChat.create calls the views run on a tap. The create replies come from the
// proxy in front of the verify fixture server, so the stall and the failure are real HTTP.
// Compiled with -D DICTATION_CHECK against the app sources (except PolymuxApp.swift, whose
// AppSession this file provides) and a release PolymuxKit.
import SwiftUI
import UIKit
import PolymuxKit

@MainActor final class AppSession {
    let client: APIClient
    let cache: LocalCache
    let sidebar: SidebarStore
    let settings: SettingsStore
    let avatars: AvatarStore

    init(client: APIClient, cache: LocalCache) {
        self.client = client
        self.cache = cache
        sidebar = SidebarStore(client: client, cache: cache)
        settings = SettingsStore(client: client)
        avatars = AvatarStore(sidebar: sidebar)
    }
}

private enum Assets {
    static func color(_ name: String, scheme: ColorScheme, root: URL) -> Color {
        let file = root.appending(path: "apps/Polymux/Sources/Assets.xcassets/\(name).colorset/Contents.json")
        guard let data = try? Data(contentsOf: file),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let entries = json["colors"] as? [[String: Any]],
              let entry = entries[scheme == .dark ? 1 : 0]["color"] as? [String: Any],
              let components = entry["components"] as? [String: String],
              let red = components["red"], let green = components["green"], let blue = components["blue"],
              let r = Double(red), let g = Double(green), let b = Double(blue) else { return .gray }
        return Color(red: r, green: g, blue: b)
    }
}

/// One real view in a real window, rendered for one theme.
@MainActor private final class Scene<V: View> {
    private let controller: UIHostingController<AnyView>
    private let window: UIWindow

    init(_ view: V, avatars: AvatarStore, scheme: ColorScheme, root: URL, width: CGFloat, height: CGFloat) {
        let accent = Assets.color("AccentColor", scheme: scheme, root: root)
        let content = AnyView(view
            .frame(width: width, height: height)
            .background(AppBackground.color(scheme))
            .tint(accent).accentColor(accent)
            .environment(avatars)
            .environment(\.colorScheme, scheme))
        controller = UIHostingController(rootView: content)
        window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: height))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.frame = window.bounds
        controller.view.layoutIfNeeded()
        // Without an app lifecycle nothing calls the appearance callbacks, so onAppear never fires.
        controller.beginAppearanceTransition(true, animated: false)
        controller.endAppearanceTransition()
    }

    func settle(_ seconds: Double) async {
        try? await Task.sleep(for: .seconds(seconds))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
    }

    func snapshot(name: String, output: URL) throws {
        controller.view.layoutIfNeeded()
        let renderer = UIGraphicsImageRenderer(bounds: controller.view.bounds)
        let image = renderer.image { context in
            controller.view.layer.render(in: context.cgContext)
        }
        guard let png = image.pngData() else { throw CocoaError(.fileWriteUnknown) }
        try png.write(to: output.appending(path: "ios-\(name).png"))
    }
}

/// ShellView's iOS sidebar (its rows and notice inset) without NavigationSplitView: a split view
/// asserts when rendered without an app bundle, which this simulator process has none of. The
/// rows, inset styling and surface colour are the ones ShellView builds.
@MainActor private struct SidebarScene: View {
    let session: AppSession

    var body: some View {
        List {
            ForEach(conversations) { thread in
                if thread.isGroup {
                    GroupRow(thread: thread, members: participants(thread),
                             activity: session.sidebar.activity, connected: session.sidebar.isConnected)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                } else if let agent = participants(thread).first {
                    AgentRow(agent: agent, thread: thread, duplicate: false,
                             activity: session.sidebar.activity, connected: session.sidebar.isConnected)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                }
            }
        }
        .listStyle(.plain)
        .scrollIndicators(.hidden)
        .safeAreaInset(edge: .top, spacing: 0) {
            if let notice = session.sidebar.notice {
                Text(notice)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
        }
    }

    private var conversations: [PolymuxKit.Thread] {
        session.sidebar.threads
            .filter { !participants($0).isEmpty }
            .sorted { ($0.lastMessage?.date ?? .distantPast) > ($1.lastMessage?.date ?? .distantPast) }
    }

    private func participants(_ thread: PolymuxKit.Thread) -> [Agent] {
        thread.participantIDs.compactMap { id in session.sidebar.agents.first { $0.id == id } }
    }
}

private func setMode(_ control: URL, _ mode: String, hold: String = "6") {
    try? mode.write(to: control.appending(path: "mode"), atomically: false, encoding: .utf8)
    try? hold.write(to: control.appending(path: "hold"), atomically: false, encoding: .utf8)
}

@main private struct NewChatCheckMain {
    @MainActor static func main() async throws {
        setvbuf(stdout, nil, _IONBF, 0)
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let root = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let control = root.appending(path: ".build/ncproof/control")
        let client = APIClient(baseURL: URL(string: "http://127.0.0.1:22508")!)
        let folder = FileManager.default.temporaryDirectory.appending(path: "polymux-nccheck-\(UUID().uuidString)", directoryHint: .isDirectory)
        let cache = try await Task.detached { try LocalCache(url: folder.appending(path: "cache.sqlite")) }.value
        let session = AppSession(client: client, cache: cache)
        await session.sidebar.refresh()
        await session.settings.refresh()
        guard let aria = session.sidebar.agents.first(where: { $0.id == "t-aria" }),
              let milo = session.sidebar.agents.first(where: { $0.id == "t-milo" }) else { fatalError("fixture agents missing") }
        print("seeded \(session.sidebar.agents.count) agents, \(session.sidebar.threads.count) threads")

        var spans: [SignpostTrace.Span] = []
        for scheme in [ColorScheme.light, .dark] {
            let theme = scheme == .dark ? "dark" : "light"
            print("== \(theme)")
            setMode(control, "pass")
            session.sidebar.clearNotice()

            let idle = Scene(NewChatView(session: session, close: {}, select: { _ in }),
                             avatars: session.avatars, scheme: scheme, root: root, width: 440, height: 1250)
            await idle.settle(0.7)
            try idle.snapshot(name: "\(theme)-idle", output: output)

            // The create is stalled: the sidebar row must exist while the POST has no reply yet.
            setMode(control, "stall", hold: "14")
            let trace = SignpostTrace()
            let launch = InstantChat.start(agents: [aria, milo], title: nil, sidebar: session.sidebar,
                                           client: client, trace: trace)
            guard let local = launch.thread?.id, local.hasPrefix("local-") else { fatalError("no optimistic thread") }
            spans.append(launch.feedback)
            spans.append(launch.mark)
            let optimistic = Scene(SidebarScene(session: session),
                                   avatars: session.avatars, scheme: scheme, root: root, width: 440, height: 1250)
            await optimistic.settle(0.8)
            guard session.sidebar.aliases[local] == nil, session.sidebar.threads.contains(where: { $0.id == local }) else {
                fatalError("optimistic row missing or already resolved before the capture")
            }
            try optimistic.snapshot(name: "\(theme)-optimistic", output: output)
            print("optimistic \(local) captured while stalled; notice=\(session.sidebar.notice ?? "none")")

            // The proxy answers 500: the row is rolled back and the notice shows.
            guard let message = await launch.finish(), message.contains("Couldn’t create this chat") else {
                fatalError("stalled create did not fail with the notice message")
            }
            guard session.sidebar.notice == message, !session.sidebar.threads.contains(where: { $0.id == local }) else {
                fatalError("rollback or notice missing after the failure")
            }
            let notice = Scene(SidebarScene(session: session),
                               avatars: session.avatars, scheme: scheme, root: root, width: 440, height: 1250)
            await notice.settle(0.4)
            try notice.snapshot(name: "\(theme)-notice", output: output)
            print("notice captured: \(message)")

            // A failed agent create keeps the panel open and shows the error in it.
            session.sidebar.clearNotice()
            setMode(control, "fail")
            print("agent stage start: mode=fail notice=\(session.sidebar.notice ?? "none") agents=\(session.sidebar.agents.count)")
            NewChatCheck.autoAgent = true
            let panel = Scene(NewChatView(session: session, close: {}, select: { _ in }),
                              avatars: session.avatars, scheme: scheme, root: root, width: 440, height: 1250)
            await panel.settle(1.4)
            try panel.snapshot(name: "\(theme)-error", output: output)
            print("agent stage end: notice=\(session.sidebar.notice ?? "none") agents=\(session.sidebar.agents.count)")
            do {
                let probe = try await client.createAgent(CreateAgentRequest(name: "Probe", role: "", prompt: ""))
                print("probe createAgent ok: \(probe.id)")
            } catch {
                print("probe createAgent failed: \(error)")
            }
            guard let agentNotice = session.sidebar.notice, agentNotice.contains("Couldn’t create this agent") else {
                fatalError("agent failure notice missing")
            }
            print("panel error captured: \(agentNotice)")

            try? await Task.sleep(for: .seconds(8))   // let the notice expire before the next theme
            session.sidebar.clearNotice()
        }

        let budgets: [String: Duration] = ["newChatFeedback": InstantUI.feedbackBudget, "newChat": InstantUI.stateBudget]
        var lines = ["PR #42 iOS check-harness trace (release PolymuxKit) — InstantChat spans around the Create calls",
                     "newChatFeedback budget \(InstantUI.feedbackBudget); newChat budget \(InstantUI.stateBudget)", ""]
        for span in spans {
            let budget = budgets[span.name] ?? span.budget
            lines.append("\(span.name) budget=\(budget) duration=\(span.duration) withinBudget=\(span.withinBudget)")
        }
        let text = lines.joined(separator: "\n") + "\n"
        try text.write(to: output.appending(path: "ios-trace.txt"), atomically: true, encoding: .utf8)
        print(text, terminator: "")
    }
}
