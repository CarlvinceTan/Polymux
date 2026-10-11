import SwiftUI
import AvatarKit

extension ColorID {
    static let avatarColors = allCases.filter { $0 != .cream }

    var isAdaptive: Bool { self == .ink || self == .cream }
    var avatarID: ColorID { isAdaptive ? .ink : self }
    var avatarLabel: String { isAdaptive ? "Black / White" : label }

    func avatarColor(_ scheme: ColorScheme) -> Color {
        if isAdaptive { return scheme == .dark ? .white : .black }
        return Color(avatarHex: hex)
    }
}

struct AvatarSwatch: View {
    let color: ColorID

    var body: some View {
        Circle()
            .fill(color.isAdaptive ? Color.black : Color(avatarHex: color.hex))
            .overlay {
                if color.isAdaptive { SplitSwatch().fill(.white) }
            }
            .clipShape(Circle())
    }
}

private struct SplitSwatch: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: CGPoint(x: rect.minX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
            path.closeSubpath()
        }
    }
}
