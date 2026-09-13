// Start WeChat with its window guard initialized by dyld before application
// code. Never launch-then-hide: missing guard support prevents the launch.
import AppKit
import CoreGraphics
import CryptoKit
import Darwin
import Foundation
import Security

func output(_ payload: [String: Any], code: Int32 = 0) -> Never {
    var result = payload
    if payload["guarded"] as? Bool == true, let pid = payload["pid"] as? pid_t {
        var birth = proc_bsdinfo()
        if proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &birth, Int32(MemoryLayout.size(ofValue: birth))) == MemoryLayout.size(ofValue: birth) {
            result["birthSeconds"] = birth.pbi_start_tvsec
            result["birthMicros"] = birth.pbi_start_tvusec
        } else { result["ok"] = false; result["reason"] = "wechat_process_changed" }
    }
    let data = try? JSONSerialization.data(withJSONObject: result)
    print(data.flatMap { String(data: $0, encoding: .utf8) } ?? "{\"ok\":false}")
    exit(code)
}

func desktopAvailable() -> Bool {
    desktopSessionAllowsAutomation(CGSessionCopyCurrentDictionary() as? [String: Any]) &&
        NSWorkspace.shared.frontmostApplication != nil
}

func validKeyCaptureDirectory(_ directory: String) -> Bool {
    guard directory.hasPrefix("/"),
          URL(fileURLWithPath: directory).lastPathComponent.hasPrefix("polymux-wechat-key-capture-") else { return false }
    let root = open(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard root >= 0 else { return false }
    defer { close(root) }
    var info = stat()
    guard fstat(root, &info) == 0, info.st_uid == getuid(),
          (info.st_mode & S_IFMT) == S_IFDIR, (info.st_mode & 0o777) == 0o700 else { return false }
    let input = openat(root, "pages", O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
    let output = openat(root, "keys", O_WRONLY | O_APPEND | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
    defer { if input >= 0 { close(input) }; if output >= 0 { close(output) } }
    for fd in [input, output] {
        guard fd >= 0, fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_nlink == 1,
              (info.st_mode & S_IFMT) == S_IFREG, (info.st_mode & 0o777) == 0o600 else { return false }
    }
    guard info.st_size == 0, fstat(input, &info) == 0 else { return false }
    var bytes = [UInt8](repeating: 0, count: 12)
    guard read(input, &bytes, bytes.count) == bytes.count, Array(bytes.prefix(8)) == Array("PMXKEY01".utf8) else { return false }
    let count = bytes[8...11].enumerated().reduce(UInt32(0)) { $0 | UInt32($1.element) << ($1.offset * 8) }
    return count > 0 && count <= 128 && info.st_size == 12 + Int(count) * 4096
}

// Private UI handling has only been checked on this exact release. An update
// or changed signature must fail before any launch or debugger invocation.
func supportedApplication(_ bundle: URL, cold: Bool) -> Bool {
    let executable = bundle.appendingPathComponent("Contents/MacOS/WeChat")
    let library = bundle.appendingPathComponent("Contents/Resources/wechat.dylib")
    guard Bundle(url: bundle)?.bundleIdentifier == "com.tencent.xinWeChat",
          let bytes = try? Data(contentsOf: executable, options: .mappedIfSafe),
          let payload = try? Data(contentsOf: library, options: .mappedIfSafe),
          SHA256.hash(data: payload).map({ String(format: "%02x", $0) }).joined() ==
            "4e85aba6fb2a99f7d0d28b3248de8f06feb9f38aeea49a5edc3e776e5a82a04f"
    else { return false }
    if !cold { return true }
    // This signed executable was verified to accept dyld insertion. Never
    // weaken another application's signing policy to make a cold launch work.
    guard SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() ==
        "e3dd6b60d4c05e1b680d5cbecd58e2b30c6337b8add7a0e2ad166c20d40f4bf8",
        getuid() == geteuid(), getgid() == getegid(),
        bytes.range(of: Data("__RESTRICT".utf8)) == nil else { return false }
    var info = stat()
    guard lstat(executable.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
          info.st_mode & 0o6000 == 0 else { return false }
    var code: SecStaticCode?
    guard SecStaticCodeCreateWithPath(bundle as CFURL, [], &code) == errSecSuccess,
          let code else { return false }
    var signing: CFDictionary?
    guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &signing) == errSecSuccess,
          let values = signing as? [String: Any],
          let flags = values[kSecCodeInfoFlags as String] as? UInt32 else { return false }
    // Restrict, hardened runtime, forced/required library validation, hard.
    return flags & (0x800 | 0x10000 | 0x10 | 0x2000 | 0x100) == 0
}

let arguments = CommandLine.arguments
let checkOnly = arguments.count == 5 && arguments[1] == "--check"
let captureDirectory = arguments.count == 6 && arguments[4] == "--key-capture" ? arguments[5] : nil
guard checkOnly || arguments.count == 4 || captureDirectory != nil, desktopAvailable(),
      let revision = backgroundGuardRevision() else {
    output(["ok": false, "reason": "background_launch_unavailable"], code: 2)
}
let script = arguments[checkOnly ? 3 : 2]
let guardLibrary = arguments[checkOnly ? 4 : 3]
guard guardLibrary == nativeHelperDirectory().appendingPathComponent("libpolymux-wechat-prime-\(revision).dylib").path,
      FileManager.default.fileExists(atPath: guardLibrary),
      script.hasPrefix("/"), FileManager.default.fileExists(atPath: script) else {
    output(["ok": false, "reason": "launch_resources_unavailable"], code: 2)
}

if checkOnly {
    output(["ok": true, "backgroundLaunchSupported": supportedApplication(
        URL(fileURLWithPath: arguments[2]).standardizedFileURL, cold: true)])
}

var captureLibrary: String? = nil
if let directory = captureDirectory {
    let library = nativeHelperDirectory().appendingPathComponent("libpolymux-wechat-key-capture-\(revision).dylib").path
    guard validKeyCaptureDirectory(directory),
          FileManager.default.fileExists(atPath: library) else {
        output(["ok": false, "reason": "key_capture_resources_unavailable"], code: 2)
    }
    captureLibrary = library
}

let bundle = URL(fileURLWithPath: arguments[1]).standardizedFileURL
let existing = NSRunningApplication.runningApplications(withBundleIdentifier: "com.tencent.xinWeChat").filter { !$0.isTerminated }
if existing.count == 1, let running = existing.first, running.bundleURL?.standardizedFileURL == bundle {
    if captureDirectory != nil {
        output(["ok": false, "reason": "key_capture_requires_cold_launch"], code: 6)
    }
    output(["ok": true, "pid": running.processIdentifier, "alreadyRunning": true])
}
guard existing.isEmpty, supportedApplication(bundle, cold: true) else {
    output(["ok": false, "reason": "background_launch_unsupported"], code: 6)
}
// Process owns exactly the new child. There is no Launch Services request
// which can arrive after this helper has timed out, and no SIGCONT recovery.
let child = Process()
child.executableURL = bundle.appendingPathComponent("Contents/MacOS/WeChat")
child.currentDirectoryURL = bundle.deletingLastPathComponent()
var environment = ProcessInfo.processInfo.environment.filter { !$0.key.hasPrefix("DYLD_") }
environment["DYLD_INSERT_LIBRARIES"] = guardLibrary
environment.removeValue(forKey: "POLYMUX_WECHAT_KEY_CAPTURE_DIRECTORY")
if let captureDirectory, let captureLibrary {
    environment["DYLD_INSERT_LIBRARIES"] = guardLibrary + ":" + captureLibrary
    environment["POLYMUX_WECHAT_KEY_CAPTURE_DIRECTORY"] = captureDirectory
}
environment["POLYMUX_WECHAT_PRIME_ON_LAUNCH"] = "2"
child.environment = environment
child.standardInput = FileHandle.nullDevice
child.standardOutput = FileHandle.nullDevice
child.standardError = FileHandle.nullDevice
do { try child.run() } catch { output(["ok": false, "reason": "wechat_launch_failed"], code: 7) }
let pid = child.processIdentifier
// A manual opening transfers control to the user immediately, even while
// startup is incomplete. A slow but proven guarded child may also finish
// launching after our bounded wait; neither case authorizes termination.
let deadline = Date().addingTimeInterval(12)
var sawGuard = false
while child.isRunning && Date() < deadline {
    let proof = verifiedBackgroundGuard(pid, requireBackground: false)
    sawGuard = sawGuard || proof
    if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid {
        output(["ok": true, "pid": pid, "alreadyRunning": true, "userOpened": true])
    }
    if proof, let running = NSRunningApplication(processIdentifier: pid),
       running.isFinishedLaunching, running.bundleURL?.standardizedFileURL == bundle {
        output(["ok": true, "pid": pid, "guarded": true, "alreadyRunning": false])
    }
    Thread.sleep(forTimeInterval: 0.025)
}
// Recheck takeover and proof at the deadline. Never kill a process which the
// user opened or whose protected main loop has already been observed.
if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid {
    output(["ok": true, "pid": pid, "alreadyRunning": true, "userOpened": true])
}
if sawGuard || verifiedBackgroundGuard(pid, requireBackground: false) {
    output(["ok": false, "pid": pid, "reason": "wechat_still_launching"], code: 8)
}
if child.isRunning { kill(pid, SIGKILL); child.waitUntilExit() }
output(["ok": false, "reason": "background_launch_not_verified"], code: 8)
