#if os(macOS)
import XCTest
@testable import PolymuxControl

@MainActor
final class EmbeddedDriverTests: XCTestCase {
    private func fixture() throws -> (EmbeddedDriver, URL) {
        let root = FileManager.default.temporaryDirectory.appending(path: "polymux-driver-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let binary = root.appending(path: "fake-driver")
        let script = #"""
        #!/usr/bin/python3
        import os, sys, json, socket, signal, base64, time
        if sys.argv[1] == 'serve':
            endpoint = sys.argv[sys.argv.index('--socket') + 1]
            server = socket.socket(socket.AF_UNIX)
            server.bind(endpoint)
            with open(os.path.join(os.environ['HOME'], 'daemon.pid'),'w') as f: f.write(str(os.getpid()))
            signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
            sys.stdin.buffer.read()
        else:
            for line in sys.stdin:
                msg = json.loads(line)
                if 'id' not in msg: continue
                if msg['method'] == 'tools/list':
                    result = {'tools': [
                        {'name':'list_apps','description':'Apps','inputSchema':{'type':'object'}},
                        {'name':'click','description':'Click','inputSchema':{'type':'object'}},
                        {'name':'browser_click','description':'Denied','inputSchema':{'type':'object'}}]}
                elif msg['method'] == 'tools/call':
                    name = msg['params']['name']
                    args = msg['params']['arguments']
                    if name == 'check_permissions':
                        granted = not os.path.exists(os.path.join(os.environ['HOME'], 'revoked'))
                        result = {'structuredContent':{'accessibility':granted,'screen_recording':granted,
                            'source':{'attribution':'host','host_bundle_id':os.environ['CUA_DRIVER_HOST_BUNDLE_ID']}}}
                    elif name == 'health_report':
                        result = {'structuredContent':{'checks':[{'name':'bundle_identity','status':'pass','data':{
                            'bundle_identifier':os.environ['CUA_DRIVER_HOST_BUNDLE_ID'],
                            'identity_source':'parent_application','parent_process_id':os.getppid()}}]}}
                    elif name == 'get_desktop_state':
                        png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c9oQAAAAASUVORK5CYII=')
                        with open(args['screenshot_out_file'],'wb') as f: f.write(png)
                        result = {'content':[]}
                    elif name == 'click':
                        time.sleep(30)
                        result = {'content':[]}
                    elif name == 'list_apps' and args.get('crash_daemon'):
                        with open(os.path.join(os.environ['HOME'], 'daemon.pid')) as f: pid = int(f.read())
                        os.kill(pid, signal.SIGKILL)
                        result = {'content':[]}
                    else: result = {'content':[{'type':'text','text':'fixture'}]}
                else: result = {}
                print(json.dumps({'jsonrpc':'2.0','id':msg['id'],'result':result}), flush=True)
        """#
        try Data(script.utf8).write(to: binary)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: binary.path)
        return (EmbeddedDriver(binary: binary, home: root.appending(path: "home"), bundleID: "com.test.polymux"), root)
    }

    func testEmbeddedHandshake() async throws {
        let (driver, _) = try fixture()
        let tools = try await driver.start()
        XCTAssertEqual(Set(tools.map(\.name)), ["list_apps", "click"])
        let response = try await driver.call("list_apps", [:])
        XCTAssertEqual(response["content"]?.array?.first?["text"]?.string, "fixture")
        await driver.stop()
        await driver.stop()
        do { _ = try await driver.call("list_apps", [:]); XCTFail("Stopped runtime accepted a call") } catch {}
    }

    func testInterruptedCall() async throws {
        let (driver, _) = try fixture()
        _ = try await driver.start()
        let task = Task { try await driver.call("click", [:]) }
        try await Task.sleep(for: .milliseconds(100))
        task.cancel()
        do { _ = try await task.value; XCTFail("Interrupted action succeeded") } catch {}
        await driver.stop()
        let tools = try await driver.start()
        XCTAssertEqual(tools.count, 2)
        await driver.stop()
    }

    func testDaemonFailure() async throws {
        let (driver, root) = try fixture()
        _ = try await driver.start()
        let pidFile = root.appending(path: "home/daemon.pid")
        let first = try String(contentsOf: pidFile, encoding: .utf8)
        _ = try await driver.call("list_apps", ["crash_daemon": .bool(true)])
        try await Task.sleep(for: .milliseconds(100))
        _ = try await driver.start()
        XCTAssertNotEqual(try String(contentsOf: pidFile, encoding: .utf8), first)
        await driver.stop()
    }

    func testCanceledBeforeRPC() async throws {
        let (driver, _) = try fixture()
        _ = try await driver.start()
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await driver.call("click", [:])
        }
        do { _ = try await task.value; XCTFail("Canceled RPC delivered") } catch {}
        let result = try await driver.call("list_apps", [:])
        XCTAssertEqual(result["content"]?.array?.first?["text"]?.string, "fixture")
        await driver.stop()
    }

    func testRevokedPermissions() async throws {
        let (driver, root) = try fixture()
        _ = try await driver.start()
        let revoked = root.appending(path: "home/revoked")
        try Data().write(to: revoked)
        do { _ = try await driver.start(); XCTFail("Revoked runtime remained ready") } catch {}
        do { _ = try await driver.call("click", [:]); XCTFail("Revoked runtime accepted control") } catch {}
        try FileManager.default.removeItem(at: revoked)
        _ = try await driver.start()
        await driver.stop()
    }
}
#endif
