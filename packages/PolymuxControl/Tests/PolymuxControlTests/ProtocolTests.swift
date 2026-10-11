import XCTest
@testable import PolymuxControl

final class ProtocolTests: XCTestCase {
    func testReadiness() {
        for missing in ["accessibility", "screen", "runtime", "local", "approval"] {
            let ready = DevicePolicy.ready(approved: missing == "approval" ? ["commands"] : ["native", "commands"],
                native: missing != "local", commands: true, accessibility: missing != "accessibility",
                screen: missing != "screen", runtime: missing != "runtime")
            XCTAssertEqual(ready, ["commands"], missing)
        }
        XCTAssertEqual(DevicePolicy.ready(approved: ["native"], native: true, commands: true,
            accessibility: true, screen: true, runtime: true), ["native"])
        XCTAssertEqual(DevicePolicy.ready(approved: ["native"], native: true, commands: true,
            accessibility: false, screen: false, runtime: false), [])
    }

    func testToolCeiling() {
        for denied in ["page", "get_browser_state", "browser_click", "config", "check_permissions", "run_command", "set_permissions"] {
            XCTAssertFalse(DevicePolicy.nativeTools.contains(denied))
        }
        XCTAssertTrue(DevicePolicy.nativeTools.contains("get_window_state"))
        XCTAssertTrue(DevicePolicy.nativeTools.contains("invoke_menu"))
        XCTAssertFalse(DevicePolicy.valid(["native", "native"]))
        XCTAssertFalse(DevicePolicy.valid(["files"]))
    }

    func testTicketBinding() throws {
        let server = URL(string: "http://127.0.0.1:7337")!
        let ticket = PairTicket(version: 1, url: URL(string: "https://127.0.0.1:7339")!, certificate: Data([1, 2]),
            code: String(repeating: "x", count: 43), agent: "assistant", capabilities: ["native"])
        let text = "polymux-pair:" + (try JSONEncoder().encode(ticket)).base64EncodedString()
        XCTAssertEqual(try PairTicket.parse(text, server: server).agent, "assistant")
        XCTAssertThrowsError(try PairTicket.parse(text, server: URL(string: "http://elsewhere:7337")!))
        XCTAssertThrowsError(try PairTicket.parse("polymux-pair:broken", server: server))
    }

    func testWireRoundtrip() throws {
        let data = Data(#"{"type":"request","id":"call","operation":"click","arguments":{"pid":12,"window_id":34,"session":"test","target":{"kind":"window"}}}"#.utf8)
        let packet = try JSONDecoder().decode(DevicePacket.self, from: data)
        XCTAssertEqual(packet.arguments?["session"]?.string, "test")
        let roundtrip = try JSONDecoder().decode(DevicePacket.self, from: JSONEncoder().encode(packet))
        XCTAssertEqual(roundtrip.arguments, packet.arguments)
    }
}
