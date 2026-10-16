import SwiftUI
import PolymuxKit

struct VoiceOverlay: View {
    @State private var store: (any VoiceSession)?
    @State private var closing = false
    @State private var retrying = false
    @State private var retryTask: Task<Void, Never>?
    @State private var lifetime: VoiceLifetime?
    @State private var owner = UUID()
    private let makeStore: () -> any VoiceSession
    private let dismiss: () -> Void

    @MainActor
    init(
        stream: @escaping (String) -> AsyncThrowingStream<VoiceFragment, Error>,
        interrupt: @escaping () async -> Void,
        dismiss: @escaping () -> Void
    ) {
        makeStore = { VoiceStore(reply: ClosureReply(stream: stream, interrupt: interrupt)) }
        self.dismiss = dismiss
    }

    @MainActor
    init(
        send: @escaping (String) async throws -> String,
        interrupt: @escaping () async -> Void,
        dismiss: @escaping () -> Void
    ) {
        makeStore = { VoiceStore(reply: ClosureReply(send: send, interrupt: interrupt)) }
        self.dismiss = dismiss
    }

    @MainActor
    init(store: any VoiceSession, dismiss: @escaping () -> Void) {
        _store = State(initialValue: store)
        makeStore = { store }
        self.dismiss = dismiss
    }

    var body: some View {
        VStack(spacing: 8) {
            if let issue = store?.issue {
                VStack(spacing: 8) {
                    Text(issue)
                        .font(.caption).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Try again", action: retry)
                        .buttonStyle(.glass)
                        .disabled(retrying || closing)
                }
                .frame(maxWidth: 400)
            }
            HStack(alignment: .bottom, spacing: 24) {
                Button(action: mute) {
                    Image(systemName: store?.muted == true ? "mic.slash.fill" : "mic.fill")
                        .font(.system(size: 18))
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: Circle())
                .disabled(store == nil || store?.phase == .failed || closing)
                .accessibilityLabel(store?.muted == true ? "Unmute microphone" : "Mute microphone")
                .accessibilityValue(store?.muted == true ? "Muted" : "On")
                .help(store?.muted == true ? "Unmute microphone" : "Mute microphone")
                Spacer(minLength: 0)
                ZStack {
                    SpeechOrb(phase: store?.phase ?? .preparing, level: store?.level ?? 0,
                              muted: store?.muted == true || closing)
                }
                .frame(width: 96, height: 96)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Speech conversation")
                .accessibilityValue(caption.map { "\(status). \($0)" } ?? status)
                Spacer(minLength: 0)
                Button(action: close) {
                    Image(systemName: "keyboard")
                        .font(.system(size: 18))
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: Circle())
                .disabled(closing)
                .accessibilityLabel("Switch to keyboard")
                .help("Switch to keyboard")
            }
        }
        .frame(maxWidth: .infinity)
        .task {
            guard !closing else { return }
            let next = store ?? makeStore()
            store = next
            let lifetime = VoiceLifetime.shared(next)
            self.lifetime = lifetime
            await lifetime.start(owner)
        }
        .onDisappear {
            retryTask?.cancel()
            lifetime?.stop(owner)
        }
        .onKeyPress(.escape) { close(); return .handled }
    }

    private var status: String {
        if closing { return "Ending speech" }
        if store?.muted == true { return "Microphone muted" }
        switch store?.phase ?? .preparing {
        case .preparing: return "Preparing speech"
        case .failed: return "Speech unavailable"
        case .listening: return "Listening"
        case .thinking: return "Thinking"
        case .speaking: return "Speaking"
        case .interrupted: return "Interrupted"
        }
    }

    private var caption: String? {
        guard !closing, let store, !store.muted, store.phase == .listening, !store.transcript.isEmpty else {
            return nil
        }
        return store.transcript
    }

    private func mute() { store?.toggleMute() }

    private func retry() {
        guard !retrying, !closing, let store else { return }
        retrying = true
        retryTask = Task {
            await store.retry()
            retrying = false
        }
    }

    private func close() {
        guard !closing else { return }
        closing = true
        retryTask?.cancel()
        lifetime?.stop(owner)
        dismiss()
    }
}

@MainActor
private final class VoiceLifetime {
    private static let lifetimes = NSMapTable<AnyObject, VoiceLifetime>(keyOptions: .weakMemory, valueOptions: .strongMemory)
    private static weak var active: VoiceLifetime?
    private static var shutdown: Task<Void, Never>?
    private weak var store: (any VoiceSession)?
    private var owner: UUID?
    private var cleanup: Task<Void, Never>?

    private init(_ store: any VoiceSession) { self.store = store }

    static func shared(_ store: any VoiceSession) -> VoiceLifetime {
        if let lifetime = lifetimes.object(forKey: store) { return lifetime }
        let lifetime = VoiceLifetime(store)
        lifetimes.setObject(lifetime, forKey: store)
        return lifetime
    }

    func start(_ owner: UUID) async {
        guard !Task.isCancelled else { return }
        if let previous = Self.active, let previousOwner = previous.owner, previousOwner != owner {
            previous.stop(previousOwner)
        }
        self.owner = owner
        Self.active = self
        await Self.shutdown?.value
        await cleanup?.value
        guard self.owner == owner, Self.active === self, !Task.isCancelled, let store else { return }
        await store.start()
    }

    func stop(_ owner: UUID) {
        guard self.owner == owner, let store else { return }
        self.owner = nil
        if Self.active === self { Self.active = nil }
        let previous = Self.shutdown
        let task = Task { await previous?.value; await store.stop() }
        cleanup = task
        Self.shutdown = task
    }
}
