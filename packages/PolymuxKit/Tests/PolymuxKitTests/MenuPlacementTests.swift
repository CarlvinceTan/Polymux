import Foundation
import Testing
import PolymuxKit

struct MenuPlacementTests {
    @Test(arguments: [
        (CGPoint(x: 100, y: 100), CGPoint(x: 100, y: 100)),
        (CGPoint(x: 290, y: 100), CGPoint(x: 210, y: 100)),
        (CGPoint(x: 0, y: 100), CGPoint(x: 8, y: 100)),
        (CGPoint(x: 100, y: 290), CGPoint(x: 100, y: 230)),
        (CGPoint(x: 100, y: 0), CGPoint(x: 100, y: 8)),
        (CGPoint(x: 0, y: 0), CGPoint(x: 8, y: 8)),
        (CGPoint(x: 300, y: 0), CGPoint(x: 212, y: 8)),
        (CGPoint(x: 0, y: 300), CGPoint(x: 8, y: 232)),
        (CGPoint(x: 300, y: 300), CGPoint(x: 212, y: 232)),
        (CGPoint(x: 500, y: 500), CGPoint(x: 212, y: 232))
    ])
    func edges(_ anchor: CGPoint, _ expected: CGPoint) {
        let bounds = CGRect(x: 0, y: 0, width: 300, height: 300)
        let size = CGSize(width: 80, height: 60)
        let origin = MenuPlacement.origin(anchor: anchor, size: size, bounds: bounds)
        #expect(origin == expected)
        #expect(bounds.insetBy(dx: 8, dy: 8).contains(CGRect(origin: origin, size: size)))
    }

    @Test func shiftedBounds() {
        let bounds = CGRect(x: 40, y: 70, width: 300, height: 300)
        let size = CGSize(width: 80, height: 60)
        let origin = MenuPlacement.origin(anchor: CGPoint(x: 330, y: 360), size: size, bounds: bounds)
        #expect(origin == CGPoint(x: 250, y: 300))
        #expect(bounds.insetBy(dx: 8, dy: 8).contains(CGRect(origin: origin, size: size)))
    }

    @Test func oversizedPanel() {
        #expect(MenuPlacement.origin(anchor: CGPoint(x: 200, y: 200), size: CGSize(width: 400, height: 400),
                                     bounds: CGRect(x: 40, y: 70, width: 300, height: 300)) == CGPoint(x: 48, y: 78))
    }

    @Test func overflowingFlip() {
        let size = CGSize(width: 250, height: 250)
        let bounds = CGRect(x: 0, y: 0, width: 300, height: 300)
        let origin = MenuPlacement.origin(anchor: CGPoint(x: 100, y: 100), size: size, bounds: bounds)
        #expect(origin == CGPoint(x: 8, y: 8))
        #expect(bounds.insetBy(dx: 8, dy: 8).contains(CGRect(origin: origin, size: size)))
    }
}
