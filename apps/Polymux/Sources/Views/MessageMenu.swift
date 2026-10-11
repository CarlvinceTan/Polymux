import SwiftUI
#if os(macOS)
import AppKit
#endif

struct MessageActions {
    let id: String
    let text: String
    let anchor: CGPoint
    let reply: () -> Void
    let copy: () -> Void
    var picker = false
}

struct MessageMenu: View {
    let text: String
    let react: (String) -> Void
    let expand: () -> Void
    let reply: () -> Void
    let copy: () -> Void

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 0) {
                ForEach(["👍", "👎", "❤️", "😂", "🎉", "😮"], id: \.self) { emoji in
                    Button { react(emoji) } label: {
                        Text(emoji).font(.system(size: 22)).frame(maxWidth: .infinity).frame(height: 36)
                    }
                    .accessibilityLabel("React with \(emoji)")
                }
                Button(action: expand) {
                    Image(systemName: "face.smiling")
                        .overlay(alignment: .bottomTrailing) {
                            Image(systemName: "plus.circle.fill").font(.system(size: 9))
                        }
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel("Add emoji")
            }
            Divider()
            row("Reply", icon: "arrowshape.turn.up.left", action: reply)
            row("Copy", icon: "doc.on.doc", action: copy)
            ShareLink(item: text) {
                Label("Share", systemImage: "square.and.arrow.up")
                    .frame(maxWidth: .infinity, alignment: .leading).padding(8)
                    .contentShape(Rectangle())
            }
        }
        .buttonStyle(.plain)
        .padding(8)
    }

    private func row(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .frame(maxWidth: .infinity, alignment: .leading).padding(8)
                .contentShape(Rectangle())
        }
    }
}

struct HoverActions: View {
    let react: (CGPoint) -> Void
    let reply: () -> Void
    let copy: () -> Void
    @State private var anchor = CGPoint.zero

    var body: some View {
        HStack(spacing: 0) {
            Button { react(anchor) } label: {
                Image(systemName: "face.smiling").frame(width: 28, height: 28)
            }
            .accessibilityLabel("React")
            .onGeometryChange(for: CGPoint.self) { geometry in
                let frame = geometry.frame(in: .named("messagePane"))
                return CGPoint(x: frame.minX, y: frame.maxY)
            } action: { anchor = $0 }
            Button(action: reply) { Image(systemName: "arrowshape.turn.up.left").frame(width: 28, height: 28) }
                .accessibilityLabel("Reply")
            Button(action: copy) { Image(systemName: "doc.on.doc").frame(width: 28, height: 28) }
                .accessibilityLabel("Copy")
        }
        .buttonStyle(.plain).foregroundStyle(.secondary)
    }
}

struct TextActions: ViewModifier {
    let user: Bool
    let open: (CGPoint, Bool) -> Void
    let reply: () -> Void
    let copy: () -> Void
    @State private var hovered = false
    @State private var frame = CGRect.zero
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("messagePane")) } action: { frame = $0 }
            #if os(macOS)
            .overlay {
                RightClick { point in open(CGPoint(x: frame.minX + point.x, y: frame.minY + point.y), false) }
            }
            .overlay(alignment: user ? .trailing : .leading) {
                HStack(spacing: 0) {
                    if !user { Color.clear.frame(width: frame.width).allowsHitTesting(false) }
                    HoverActions(react: { open($0, true) }, reply: reply, copy: copy)
                        .opacity(hovered ? 1 : 0)
                        .allowsHitTesting(hovered)
                    if user { Color.clear.frame(width: frame.width).allowsHitTesting(false) }
                }
                .fixedSize(horizontal: true, vertical: false)
                .contentShape(Rectangle())
                .onHover { hovered = $0 }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: hovered)
            #else
            .simultaneousGesture(LongPressGesture().sequenced(before: DragGesture(minimumDistance: 0))
                .onEnded { value in
                    let point: CGPoint
                    switch value {
                    case .first(true):
                        point = CGPoint(x: frame.width / 2, y: frame.height / 2)
                    case let .second(true, drag):
                        point = drag?.startLocation ?? CGPoint(x: frame.width / 2, y: frame.height / 2)
                    default: return
                    }
                    open(CGPoint(x: frame.minX + point.x, y: frame.minY + point.y), false)
                })
            #endif
    }
}

#if os(macOS)
private struct RightClick: NSViewRepresentable {
    let clicked: (CGPoint) -> Void

    func makeNSView(context: Context) -> ClickView { ClickView() }
    func updateNSView(_ view: ClickView, context: Context) { view.clicked = clicked }
}

private final class ClickView: NSView {
    var clicked: (CGPoint) -> Void = { _ in }
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { false }

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard let event = NSApp.currentEvent,
              event.type == .rightMouseDown || (event.type == .leftMouseDown && event.modifierFlags.contains(.control)) else { return nil }
        return super.hitTest(point)
    }

    override func rightMouseDown(with event: NSEvent) { open(event) }
    override func mouseDown(with event: NSEvent) { open(event) }
    override func menu(for event: NSEvent) -> NSMenu? { nil }

    private func open(_ event: NSEvent) {
        clicked(convert(event.locationInWindow, from: nil))
    }
}
#endif
