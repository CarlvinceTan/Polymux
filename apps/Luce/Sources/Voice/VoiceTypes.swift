import Foundation
import LuceKit

enum VoicePhase: String {
    case preparing = "Preparing voice"
    case listening = "Listening"
    case thinking = "Thinking"
    case speaking = "Speaking"
    case interrupted = "Interrupted"
    case failed = "Voice unavailable"
}

struct VoiceTranscript: Sendable {
    let text: String
    let start: Double
    let end: Double
    let final: Bool
}

enum VoiceEvent: Sendable {
    case transcript(VoiceTranscript)
    case level(Float)
    case activity(Bool)
}

@MainActor
protocol VoiceSession: AnyObject {
    var phase: VoicePhase { get }
    var agentID: String? { get }
    var transcript: String { get }
    var response: String { get }
    var level: Float { get }
    var issue: String? { get }
    var muted: Bool { get }
    func start() async
    func stop() async
    func retry() async
    func toggleMute()
}

extension VoiceSession {
    var agentID: String? { nil }
}

@MainActor
protocol SpeechInput: AnyObject {
    func start() async throws -> AsyncThrowingStream<VoiceEvent, Error>
    func stop() async
    func setMuted(_ muted: Bool)
    func finishTurn()
    func finalize() async throws
}

extension SpeechInput {
    func finishTurn() {}
    func finalize() async throws {}
}

@MainActor
protocol SpeechOutput: AnyObject {
    var firstAudio: (() -> Void)? { get set }
    func speak(_ text: String) async throws
    func stop()
}

@MainActor
protocol VoiceReply: AnyObject {
    func preview(_ text: String)
    func stream(_ text: String) -> AsyncThrowingStream<VoiceFragment, Error>
    func stop() async
}

@MainActor
final class ClosureReply: VoiceReply {
    private let response: (String) -> AsyncThrowingStream<VoiceFragment, Error>
    private let interruption: () async -> Void
    private let partial: (String) -> Void

    init(
        stream: @escaping (String) -> AsyncThrowingStream<VoiceFragment, Error>,
        interrupt: @escaping () async -> Void,
        preview: @escaping (String) -> Void = { _ in }
    ) {
        response = stream
        interruption = interrupt
        partial = preview
    }

    convenience init(
        send: @escaping (String) async throws -> String,
        interrupt: @escaping () async -> Void
    ) {
        self.init(stream: { text in
            AsyncThrowingStream { continuation in
                let task = Task { @MainActor in
                    do {
                        continuation.yield(VoiceFragment(text: try await send(text)))
                        continuation.finish()
                    } catch {
                        continuation.finish(throwing: error)
                    }
                }
                continuation.onTermination = { _ in task.cancel() }
            }
        }, interrupt: interrupt)
    }

    func preview(_ text: String) { partial(text) }
    func stream(_ text: String) -> AsyncThrowingStream<VoiceFragment, Error> { response(text) }
    func stop() async { await interruption() }
}

enum VoiceFailure: LocalizedError {
    case microphone
    case recognition
    case unavailable
    case locale
    case audio
    case speech
    case echo(String)

    var errorDescription: String? {
        switch self {
        case .microphone:
            "Allow Luce to use the microphone in System Settings."
        case .recognition:
            "Allow Luce to use speech recognition in System Settings."
        case .unavailable:
            "Speech recognition isn’t available on this device right now."
        case .locale:
            "Speech recognition does not support the current language."
        case .audio:
            "No working microphone or speaker was found. Check the selected audio devices."
        case .speech:
            "Speech recognition stopped. Try again."
        case .echo(let detail):
            "This audio route cannot enable echo cancellation. Change the microphone or speaker and retry. \(detail)"
        }
    }
}
