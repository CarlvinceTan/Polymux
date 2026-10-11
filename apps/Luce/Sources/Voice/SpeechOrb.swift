import SwiftUI

struct SpeechOrb: View {
    let phase: VoicePhase
    let level: Float
    let muted: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scene
    @State private var started = Date()

    private let source = CGSize(width: 1254, height: 1254)
    private let bounds = CGRect(x: 164, y: 163, width: 909, height: 895)
    private var animated: Bool { !reduceMotion && !muted && phase != .failed && scene == .active }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: !animated)) { tick in
            let time = animated ? tick.date.timeIntervalSince(started) : 0
            GeometryReader { geometry in
                let size = min(geometry.size.width, geometry.size.height)
                Image("SpeechOrb")
                    .resizable()
                    .interpolation(.high)
                    .frame(width: size * source.width / bounds.width,
                           height: size * source.height / bounds.width)
                    .offset(x: size * (source.width / 2 - bounds.midX) / bounds.width,
                            y: size * (source.height / 2 - bounds.midY) / bounds.width)
                    .frame(width: size, height: size)
                    .clipShape(Circle())
                    .brightness(0.012 * sin(time * 2 * .pi / 5))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onChange(of: animated) { _, _ in started = Date() }
        .aspectRatio(1, contentMode: .fit)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
