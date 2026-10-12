import Foundation
import Observation
#if os(macOS) || os(iOS)
import os
#endif

public enum ToggleSignpost: Equatable, Sendable {
    case apply(Bool)
    case commit(Bool)
    case rollback(Bool, String)
}

public struct ToggleFailure: LocalizedError, Equatable, Sendable {
    public let message: String

    public init(_ message: String) { self.message = message }

    public var errorDescription: String? { message }
}

public struct ToggleBinding {
    public var get: @MainActor () -> Bool
    public var set: @MainActor (Bool) -> Void
    public var isEnabled: @MainActor () -> Bool

    public init(get: @escaping @MainActor () -> Bool, set: @escaping @MainActor (Bool) -> Void,
                isEnabled: @escaping @MainActor () -> Bool) {
        self.get = get
        self.set = set
        self.isEnabled = isEnabled
    }
}

#if canImport(SwiftUI)
import SwiftUI

extension ToggleBinding {
    public var isOn: Binding<Bool> { Binding(get: get, set: set) }
}
#endif

/// Flips on the calling turn, then confirms. A failed confirm restores the previous value and a message.
@MainActor @Observable
public final class OptimisticToggle {
    public private(set) var isOn: Bool
    public private(set) var message: String?
    /// In-flight confirms stay tappable. Disabling the switch is what left it grey.
    public var isEnabled: Bool { true }
    @ObservationIgnored public private(set) var signposts: [ToggleSignpost] = []
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var settledGeneration = 0
    @ObservationIgnored private var tail: Task<Void, Never>?

    public init(isOn: Bool = false) { self.isOn = isOn }

    public var isPending: Bool { generation != settledGeneration }

    public var signpostTrace: [String] {
        signposts.map { event in
            switch event {
            case .apply(let value): "apply \(value)"
            case .commit(let value): "commit \(value)"
            case .rollback(let value, let message): "rollback \(value) \(message)"
            }
        }
    }

    /// One binding for every optimistic switch: read the visible value, write it immediately, confirm in the background.
    public func binding(apply: (@MainActor (Bool) -> Void)? = nil,
                        commit: @escaping @MainActor (Bool) async throws -> Void) -> ToggleBinding {
        ToggleBinding(
            get: { self.isOn },
            set: { self.set($0, apply: apply, commit: commit) },
            isEnabled: { self.isEnabled }
        )
    }

    public func set(_ next: Bool, apply: (@MainActor (Bool) -> Void)? = nil,
                    commit: @escaping @MainActor (Bool) async throws -> Void) {
        guard next != isOn else { return }
        generation += 1
        let token = generation
        let previous = isOn
        isOn = next
        message = nil
        mark(.apply(next))
        apply?(next)
        let prior = tail
        let job = Task { @MainActor in
            await prior?.value
            guard token == generation else { return }
            do {
                try await commit(next)
                guard token == generation else { return }
                self.mark(.commit(next))
            } catch {
                // A newer flip owns the value; an older failure must not restore it.
                guard token == generation else { return }
                self.isOn = previous
                let text = Self.describe(error)
                self.message = text
                apply?(previous)
                self.mark(.rollback(previous, text))
            }
            if token == generation { self.settledGeneration = token }
        }
        tail = job
    }

    /// Takes a loaded source value when no confirm is in flight.
    public func adopt(_ source: Bool) {
        guard !isPending else { return }
        if isOn != source { message = nil }
        isOn = source
    }

    public func settled() async {
        await tail?.value
    }

    static func describe(_ error: Error) -> String {
        if let described = (error as? LocalizedError)?.errorDescription?.trimmingCharacters(in: .whitespacesAndNewlines),
           !described.isEmpty {
            return described
        }
        let fallback = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        if !fallback.isEmpty { return fallback }
        return "Couldn’t save this change."
    }

    private func mark(_ event: ToggleSignpost) {
        signposts.append(event)
        #if os(macOS) || os(iOS)
        switch event {
        case .apply: InstantUISignpost.signposter.emitEvent("apply")
        case .commit: InstantUISignpost.signposter.emitEvent("commit")
        case .rollback: InstantUISignpost.signposter.emitEvent("rollback")
        }
        #endif
    }
}

#if os(macOS) || os(iOS)
private enum InstantUISignpost {
    static let signposter = OSSignposter(subsystem: "app.polymux", category: "InstantUI")
}
#endif
