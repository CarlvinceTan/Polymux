import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';

const run = promisify(execFile);

test('remembered login Return targets only the exact focused login button and account window', {skip: process.platform !== 'darwin'}, async () => {
  const source = await readFile(new URL('../../packages/wechat/src/native/wechat-prime.swift', import.meta.url), 'utf8');
  const controls = source.slice(source.indexOf('func loginWindow('), source.indexOf('/** Enable actual checkboxes'));
  const fallback = source.slice(source.indexOf('func requestFocusedRememberedLogin('), source.indexOf('/** WeChat can place one explicit signed-out notice'));
  const directory = await mkdtemp(path.join(tmpdir(), 'polymux-login-return-'));
  try {
    const script = path.join(directory, 'main.swift'), binary = path.join(directory, 'fixture');
    await writeFile(script, `
import AppKit
import ApplicationServices
import Darwin
class Control: NSObject {
  var role = ""; var id = ""; var title = ""; var pid: pid_t = 3456
  var enabled = true; var focused = true; var value: NSNumber? = 1
  var nodes: [Control] = []; var windows: [Control] = []; var current: Control?; var owner: Control?
}
typealias AXUIElement = Control
func attribute(_ e: Control, _ n: CFString) -> CFTypeRef? {
  switch n as String {
  case kAXWindowsAttribute: return e.windows as CFArray
  case kAXValueAttribute: return e.value
  case kAXEnabledAttribute: return NSNumber(value: e.enabled)
  case kAXFocusedAttribute: return NSNumber(value: e.focused)
  case kAXFocusedUIElementAttribute: return e.current
  default: return nil
  }
}
func stringAttribute(_ e: Control, _ n: CFString) -> String {
  switch n as String {
  case kAXRoleAttribute: return e.role
  case kAXTitleAttribute: return e.title
  default: return e.id
  }
}
func descendants(_ e: Control) -> [Control] { e.nodes.flatMap { [$0] + descendants($0) } }
func AXUIElementGetPid(_ e: Control, _ p: UnsafeMutablePointer<pid_t>) -> AXError { p.pointee = e.pid; return .success }
var locked = false, posted: [pid_t] = [], selectionDiagnostic: [String: Any] = [:]
func macSessionIsLocked() -> Bool { locked }
var guarded = true
func backgroundMutationAllowed(_ e: Control) -> Bool { guarded }
func postWeChatLoginReturn(_ pid: pid_t) -> Bool { posted.append(pid); return true }
var focusSettable = true, applyFocus = true, focusWrites = 0
var focusResult: AXError = .success
var afterFocus: (() -> Void)?, duringCheck: (() -> Void)?
func AXUIElementIsAttributeSettable(_ e: Control, _ n: CFString, _ value: UnsafeMutablePointer<DarwinBoolean>) -> AXError {
  value.pointee = DarwinBoolean(focusSettable); duringCheck?(); return .success
}
func setGuardedAXAttribute(_ e: Control, _ n: CFString, _ value: CFTypeRef) -> AXError {
  guard guarded else { return .cannotComplete }
  focusWrites += 1
  if focusResult == .success && applyFocus { e.focused = true; e.owner?.current = e }
  afterFocus?()
  return focusResult
}
${controls}
${fallback}
func check(_ value: Bool, _ description: String) { if !value { fatalError(description) } }
let app = Control(), window = Control(), nick = Control(), marker = Control(), button = Control(), box = Control()
nick.id = "current_login_nick_name"; marker.id = "login_step_image_"
button.role = kAXButtonRole; button.title = "Open WeChat"; box.role = kAXCheckBoxRole
window.nodes = [nick, marker, button, box]; app.windows = [window]; app.current = button
check(requestFocusedRememberedLogin(app, button: button), "focused remembered login is requested")
check(posted == [3456], "event goes only to the exact WeChat process")
func rejected(_ description: String) { check(!requestFocusedRememberedLogin(app, button: button), description); check(posted == [3456], "rejection never posts an event") }
app.current = nil; rejected("missing focused control"); app.current = button
app.current = box; rejected("another control has focus"); app.current = button
button.focused = false; rejected("stale application focus"); button.focused = true
button.pid = 7654; rejected("control from another process"); button.pid = 3456
button.enabled = false; rejected("disabled button"); button.enabled = true
button.title = "Close"; rejected("unrelated button"); button.title = "Open WeChat"
nick.id = ""; rejected("missing remembered account"); nick.id = "current_login_nick_name"
marker.id = "session_list"; rejected("chat window"); marker.id = "login_step_image_"
box.value = 0; rejected("unchecked sync option"); box.value = nil; rejected("unknown sync option"); box.value = 1
window.nodes.append(button); rejected("ambiguous button"); window.nodes.removeLast()
app.windows.append(window); rejected("ambiguous login window"); app.windows.removeLast()
locked = true; rejected("locked Mac"); locked = false
guarded = false; rejected("missing or stale guard"); guarded = true
button.owner = app; app.current = nil; button.focused = false
check(prepareRememberedLoginFocus(app, button: button), "cold login focuses its exact button")
check(focusWrites == 1 && posted == [3456], "focus preparation does not send Return")
check(requestFocusedRememberedLogin(app, button: button), "prepared focus permits one verified Return")
check(posted == [3456,3456], "prepared login targets the same process")
app.current = nil; button.focused = false
func focusRejected(_ description: String) {
  check(!prepareRememberedLoginFocus(app, button: button), description)
  check(focusWrites == 1 && posted == [3456,3456], "rejected focus does not mutate or submit")
}
app.current = box; focusRejected("preserve another focused control"); app.current = nil
button.focused = true; focusRejected("contradictory focused state"); button.focused = false
button.enabled = false; focusRejected("disabled login"); button.enabled = true
button.pid = 9999; focusRejected("foreign button"); button.pid = 3456
box.value = 0; focusRejected("unchecked sync setting"); box.value = 1
marker.id = "session_list"; focusRejected("a chat window is not a login window"); marker.id = "login_step_image_"
focusSettable = false; focusRejected("readonly focus"); focusSettable = true
locked = true; focusRejected("locked during preparation"); locked = false
guarded = false; focusRejected("missing guard during preparation"); guarded = true
duringCheck = { app.current = box }; focusRejected("focus changed during inspection"); duringCheck = nil; app.current = nil
applyFocus = false
check(!prepareRememberedLoginFocus(app, button: button), "setter without readback is not ready")
check(focusWrites == 2 && posted == [3456,3456], "failed readback never submits")
applyFocus = true; focusResult = .failure
check(!prepareRememberedLoginFocus(app, button: button), "failed setter is not ready")
check(focusWrites == 3 && posted == [3456,3456], "failed setter never submits")
focusResult = .success; afterFocus = { guarded = false }
check(!prepareRememberedLoginFocus(app, button: button), "lost guard after focus blocks Return")
check(focusWrites == 4 && posted == [3456,3456], "guard loss never submits")
print("focused login contract passed")
`);
    await run('/usr/bin/swiftc', ['-O', script, '-o', binary], {timeout: 60_000});
    assert.match((await run(binary, [])).stdout, /focused login contract passed/);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('a locked Mac blocks the primer before AX work and overrides a stale signed-in result', {skip: process.platform !== 'darwin'}, async () => {
  const source = await readFile(new URL('../../packages/wechat/src/native/wechat-prime.swift', import.meta.url), 'utf8');
  const entry = source.slice(source.indexOf('guard !candidates.isEmpty else'), source.indexOf('// Both helpers use this process-scoped lock'));
  const afterProbe = source.slice(source.indexOf('// The session can lock while'), source.indexOf('    let signedIn = observations.filter'));
  assert.ok(entry.includes('macSessionIsLocked()') && afterProbe.includes('macSessionIsLocked()'));
  const directory = await mkdtemp(path.join(tmpdir(), 'polymux-login-lock-'));
  try {
    const script = path.join(directory, 'main.swift'), binary = path.join(directory, 'fixture');
    await writeFile(script, `
import Foundation
import Darwin
let candidates = [1]
func macSessionIsLocked() -> Bool { CommandLine.arguments.contains("locked") }
func emit(_ result: [String: Any]) -> Never {
  print(String(data: try! JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)
  exit(0)
}
if CommandLine.arguments.contains("after-probe") {
  let observed = "signed_in"
  ${afterProbe}
  emit(["ready": true, "state": observed])
} else {
  ${entry}
  emit(["continued": true])
}
`);
    await run('/usr/bin/swiftc', ['-O', script, '-o', binary], {timeout: 60_000});
    for (const mode of ['entry', 'after-probe']) {
      const locked = JSON.parse((await run(binary, [mode, 'locked'])).stdout);
      assert.equal(locked.ready, false);
      assert.equal(locked.state, 'locked');
      assert.equal(locked.reason, 'wechat_session_locked');
      const unlocked = JSON.parse((await run(binary, [mode, 'unlocked'])).stdout);
      assert.equal(unlocked.continued ?? unlocked.ready, true);
    }
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('native login checks are idempotent and QR extraction returns only the detected code', {skip: process.platform !== 'darwin'}, async () => {
  const source = await readFile(new URL('../../packages/wechat/src/native/wechat-prime.swift', import.meta.url), 'utf8');
  const controls = source.slice(source.indexOf('func loginWindow('), source.indexOf('func loginFrame('));
  const guardedActions = source.slice(source.indexOf('func performGuardedAXAction('), source.indexOf('func acquireLoginLock('));
  const emitter = source.slice(source.indexOf('func emit('), source.indexOf('func attribute('));
  const lock = source.slice(source.indexOf('func acquireLoginLock('), source.indexOf('// Login images are ephemeral.'));
  const crop = source.slice(source.indexOf('func croppedLoginQR('), source.indexOf('@available(macOS 14.0, *)'));
  assert.ok(controls.includes('func enableLoginCheckboxes(') && crop.includes('VNDetectBarcodesRequest'));
  const directory = await mkdtemp(path.join(tmpdir(), 'polymux-login-native-'));
  try {
    const fixture = `
import AppKit
import ApplicationServices
import Vision
import CoreImage
import Darwin
class Control: NSObject {
  var role = ""; var id = ""; var title = ""; var text = ""; var value: NSNumber? = nil
  var enabled = true; var writable = false; var accepts = true
  var nodes: [Control] = []; var windows: [Control] = []; var writes = 0
}
typealias AXUIElement = Control
func attribute(_ e: Control, _ n: CFString) -> CFTypeRef? {
  switch n as String {
  case kAXWindowsAttribute: return e.windows as CFArray
  case kAXValueAttribute: return e.value
  case kAXEnabledAttribute: return NSNumber(value: e.enabled)
  default: return nil
  }
}
func stringAttribute(_ e: Control, _ n: CFString) -> String {
  switch n as String {
  case kAXRoleAttribute: return e.role
  case kAXTitleAttribute: return e.title
  case kAXValueAttribute: return e.text
  default: return e.id
  }
}
func descendants(_ e: Control) -> [Control] { e.nodes.flatMap { [$0] + descendants($0) } }
func actionNames(_ e: Control) -> [String] { [kAXPressAction] }
var guarded = true
var mutationResults: [[String: Any]] = [], loginSubmissionAttempted = false
func backgroundMutationAllowed(_ e: Control) -> Bool { guarded }
func AXUIElementIsAttributeSettable(_ e: Control, _ n: CFString, _ w: UnsafeMutablePointer<DarwinBoolean>) -> AXError { w.pointee = DarwinBoolean(e.writable); return .success }
func AXUIElementSetAttributeValue(_ e: Control, _ n: CFString, _ v: CFTypeRef) -> AXError { e.writes += 1; if e.accepts { e.value = v as? NSNumber }; return .success }
func AXUIElementPerformAction(_ e: Control, _ a: CFString) -> AXError { e.writes += 1; if e.accepts { e.value = NSNumber(value: e.value?.intValue == 0 ? 1 : 0) }; return .success }
${guardedActions}
${emitter}
${controls}
${crop}
${lock}
func check(_ value: Bool, _ description: String) { if !value { fatalError(description) } }
let firstLock = acquireLoginLock(getpid())!
check(acquireLoginLock(getpid()) == nil, "concurrent helpers cannot toggle together")
close(firstLock)
let nextLock = acquireLoginLock(getpid())!
close(nextLock)
try FileManager.default.removeItem(atPath: NSTemporaryDirectory() + "polymux-wechat-login-\\(getuid())-\\(getpid()).lock")
let app = Control(), window = Control(), marker = Control(), box = Control()
marker.id = "login_step_image_"; box.role = kAXCheckBoxRole; box.value = 0
window.nodes = [marker, box]; app.windows = [window]
guarded = false
check(!enableLoginCheckboxes(app) && box.writes == 0, "unguarded options cannot mutate")
check(mutationResults.isEmpty, "blocked actions have no dispatched receipt")
guarded = true
check(enableLoginCheckboxes(app), "enable unchecked login option")
check(box.value == 1 && box.writes == 1, "one unchecked option action")
check(mutationResults.count == 1, "receipt records the actual checkbox action")
check(enableLoginCheckboxes(app) && box.writes == 1, "checked option never toggles")
check(mutationResults.count == 1, "idempotent checks do not invent action receipts")
box.value = nil; check(!enableLoginCheckboxes(app) && box.writes == 1, "unknown value fails closed")
box.value = 0; box.enabled = false; check(!enableLoginCheckboxes(app), "disabled option blocks")
box.enabled = true; box.accepts = false; check(!enableLoginCheckboxes(app), "verify failed action")
let writes = box.writes
marker.id = "session_list"; check(!enableLoginCheckboxes(app) && box.writes == writes, "chat window never mutated")
marker.id = "login_step_image_"; app.windows = [window, window]
check(!enableLoginCheckboxes(app) && box.writes == writes, "ambiguous login never mutated")
app.windows = [window]
let expired = Control(), refresh = Control()
expired.title = "QR code expired"; refresh.title = "Refresh"; refresh.role = kAXButtonRole
window.nodes.append(contentsOf: [expired, refresh])
check(loginQRExpired(app), "expired QR is detected before capture")
guarded = false; refreshExpiredLoginQR(app)
check(refresh.writes == 0, "unguarded QR cannot refresh")
guarded = true; refreshExpiredLoginQR(app)
check(refresh.writes == 1, "refresh only the exact expired login action")
expired.title = ""; refreshExpiredLoginQR(app)
check(refresh.writes == 1, "do not rotate a still-valid code")
let payload = "https://weixin.qq.com/x/polymux-test-fixture-not-a-login"
let filter = CIFilter(name: "CIQRCodeGenerator")!
filter.setValue(Data(payload.utf8), forKey: "inputMessage")
let qr = filter.outputImage!.transformed(by: CGAffineTransform(scaleX: 6, y: 6))
let context = CIContext()
let image = context.createCGImage(qr, from: qr.extent)!
let canvas = CGContext(data: nil, width: 640, height: 520, bitsPerComponent: 8, bytesPerRow: 0,
                       space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
canvas.setFillColor(NSColor.white.cgColor); canvas.fill(CGRect(x: 0, y: 0, width: 640, height: 520))
canvas.interpolationQuality = .none
canvas.draw(image, in: CGRect(x: 310, y: 40, width: image.width, height: image.height))
let screenshot = canvas.makeImage()!
let dataURL = croppedLoginQR(screenshot)!
let png = Data(base64Encoded: String(dataURL.dropFirst("data:image/png;base64,".count)))!
let decoded = NSBitmapImageRep(data: png)!.cgImage!
check(decoded.width < screenshot.width && decoded.height < screenshot.height, "return only QR crop")
let request = VNDetectBarcodesRequest(); request.symbologies = [.qr]
try VNImageRequestHandler(cgImage: decoded).perform([request])
check(request.results?.first?.payloadStringValue == payload, "cropped QR remains scannable")
if let output = ProcessInfo.processInfo.environment["POLYMUX_LOGIN_FIXTURE_PNG"] { try png.write(to: URL(fileURLWithPath: output)) }
print("native login fixture passed")
emit(["ok": true])
`;
    const script = path.join(directory, 'main.swift');
    const binary = path.join(directory, 'fixture');
    await writeFile(script, fixture);
    await run('/usr/bin/swiftc', ['-O', script, '-o', binary], {timeout: 60_000});
    const result = await run(binary, [], {timeout: 10_000});
    assert.match(result.stdout, /native login fixture passed/);
    const receipt = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(receipt.loginSubmissionAttempted, false);
    assert.deepEqual(receipt.mutationResults[0], {action: 'AXPress', result: 0});
  } finally { await rm(directory, {recursive: true, force: true}); }
});
