#if os(macOS)
import XCTest
@testable import PolymuxControl

final class DeviceChannelTests: XCTestCase {
    func testCapturePathUsesTemporaryDirectory() {
        let temporary = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
        let id = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
        XCTAssertEqual(DeviceChannel.capturePath(temporary, id: id).path,
                       "/private/tmp/polymux-captures/00000000-0000-0000-0000-000000000001")
    }
}
#endif
