import SwiftUI
import PolymuxKit

/// First-run question card. The answer paints immediately and rolls back if recording fails.
struct FocusCard: View {
    let part: Part
    let client: APIClient
    let agentID: String
    let bubble: Color
    @State private var choice = ApprovalChoice()
    @State private var clock = ApprovalClock()

    private var answerID: String? { part.answerID ?? choice.shown }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(part.question ?? "").fixedSize(horizontal: false, vertical: true)
            if let answer = answerID {
                HStack(spacing: 8) {
                    Image(systemName: answer == FocusAnswer.dismissed ? "arrow.turn.down.right" : "checkmark")
                        .font(.caption.weight(.semibold))
                    Text(label(answer))
                }
                .foregroundStyle(.secondary)
                .onAppear { clock.answerAppeared() }
            } else {
                ForEach(Array((part.options ?? []).enumerated()), id: \.element.id) { index, option in
                    Button { select(option.id) } label: {
                        HStack(spacing: 10) {
                            Text(letter(index)).font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary).frame(width: 14, alignment: .leading)
                            Text(option.label).multilineTextAlignment(.leading)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(choice.isSending)
                    .accessibilityLabel("\(letter(index)). \(option.label)")
                }
                Button("Skip") { select(FocusAnswer.dismissed) }
                    .font(.caption).buttonStyle(.plain).foregroundStyle(.secondary)
                    .disabled(choice.isSending)
            }
            if choice.failed, part.answerID == nil {
                Text("Couldn’t record that choice.").font(.caption).foregroundStyle(.secondary)
                    .onAppear { clock.rollbackAppeared() }
            }
        }
        .padding(12)
        .background(bubble, in: RoundedRectangle(cornerRadius: BubbleStyle.radius))
    }

    private func letter(_ index: Int) -> String {
        String(UnicodeScalar(UInt8(65 + min(index, 25))))
    }

    private func label(_ answer: String) -> String {
        if answer == FocusAnswer.dismissed { return "Skipped" }
        return (part.options ?? []).first { $0.id == answer }?.label ?? answer
    }

    private func select(_ option: String) {
        let tap = ContinuousClock().now
        Task { await choose(option, tap: tap) }
    }

    private func choose(_ option: String, tap: ContinuousClock.Instant) async {
        guard part.answerID == nil else { return }
        choice = await ApprovalChoice.apply(current: choice, optionID: option, tap: tap, clock: clock, send: {
            _ = try await client.answerFocus(agentID: agentID, optionID: option)
        }, publish: { choice = $0 })
    }
}
