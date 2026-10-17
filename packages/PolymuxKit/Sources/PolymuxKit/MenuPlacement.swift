import Foundation
import CoreGraphics

public enum MenuPlacement {
    /// Ports polymux-archive old-old-midas/src/renderer/lib/layout/submenuPosition.ts (positionSubmenu) and tooltipPosition.ts (tooltipTop).
    public static func origin(anchor: CGPoint, size: CGSize, bounds: CGRect, inset: CGFloat = 8) -> CGPoint {
        let x = anchor.x + size.width > bounds.maxX - inset ? anchor.x - size.width : anchor.x
        let y = anchor.y + size.height > bounds.maxY - inset ? anchor.y - size.height : anchor.y
        return CGPoint(x: max(bounds.minX + inset, min(bounds.maxX - inset - size.width, x)),
                       y: max(bounds.minY + inset, min(bounds.maxY - inset - size.height, y)))
    }
}
