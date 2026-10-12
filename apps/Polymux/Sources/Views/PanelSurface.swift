import SwiftUI

enum PanelSurface {
    static func color(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(.sRGB, red: 30.0 / 255, green: 30.0 / 255, blue: 30.0 / 255) : .white
    }
}
extension View {
    func panelRow() -> some View {
        modifier(PanelRow())
    }
}

private struct PanelRow: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content.listRowBackground(PanelSurface.color(scheme))
    }
}
