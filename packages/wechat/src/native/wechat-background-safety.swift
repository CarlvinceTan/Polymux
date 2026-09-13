// Shared by the login primer and cold launcher. A live heartbeat certifies
// the current process birth and bundled guard revision before any AX mutation.
import AppKit
import Darwin
import Foundation

func nativeHelperDirectory() -> URL {
    URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.deletingLastPathComponent()
}

func backgroundGuardRevision() -> String? {
    guard let value = try? String(contentsOf: nativeHelperDirectory().appendingPathComponent("VERSION"), encoding: .utf8)
        .trimmingCharacters(in: .whitespacesAndNewlines),
        value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return nil }
    return value
}

// Optional exact birth supplied by a cold-launch owner. Recheck at each login
// mutation; PID reuse must not transfer a setup attempt to another process.
func requestedProcessBirthMatches(_ pid: pid_t) -> Bool {
    let arguments = CommandLine.arguments
    guard let index = arguments.firstIndex(of: "--expected-birth") else { return true }
    guard arguments.filter({ $0 == "--expected-birth" }).count == 1,
          arguments.indices.contains(index + 2),
          let seconds = UInt64(arguments[index + 1]), seconds > 0,
          let micros = UInt64(arguments[index + 2]), micros < 1_000_000 else { return false }
    var birth = proc_bsdinfo()
    return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &birth, Int32(MemoryLayout.size(ofValue: birth)))
        == MemoryLayout.size(ofValue: birth) && birth.pbi_start_tvsec == seconds && birth.pbi_start_tvusec == micros
}

// The guard library is injected into WeChat, so its proof lands in that
// process's own temporary directory: the app container when WeChat is
// sandboxed, the ordinary per-user directory when it is not. This helper runs
// outside that sandbox, so it has to try both. The proof is trusted on its
// owner, link count, mode, birth time and revision — never on where it sits.
func openBackgroundGuardProof(_ pid: pid_t) -> Int32 {
    let name = "polymux-wechat-window-guard-\(pid).background"
    let container = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Containers/com.tencent.xinWeChat/Data/tmp")
        .appendingPathComponent(name).path
    let ordinary = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        .appendingPathComponent(name).path
    for candidate in [container, ordinary] {
        let descriptor = open(candidate, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        if descriptor >= 0 { return descriptor }
    }
    return -1
}

func verifiedBackgroundGuard(_ pid: pid_t, requireBackground: Bool = true) -> Bool {
    guard pid > 1, let revision = backgroundGuardRevision() else { return false }
    if requireBackground {
        guard let frontmost = NSWorkspace.shared.frontmostApplication,
              frontmost.processIdentifier != pid else { return false }
    }
    var birth = proc_bsdinfo()
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &birth, Int32(MemoryLayout.size(ofValue: birth)))
        == MemoryLayout.size(ofValue: birth) else { return false }
    let fd = openBackgroundGuardProof(pid)
    guard fd >= 0 else { return false }
    defer { close(fd) }
    var info = stat()
    guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_nlink == 1,
          (info.st_mode & S_IFMT) == S_IFREG, (info.st_mode & 0o777) == 0o600,
          info.st_size > 0, info.st_size < 2048 else { return false }
    var bytes = [UInt8](repeating: 0, count: Int(info.st_size))
    guard read(fd, &bytes, bytes.count) == bytes.count,
          let proof = (try? JSONSerialization.jsonObject(with: Data(bytes))) as? [String: Any],
          proof["version"] as? Int == 2, proof["pid"] as? Int32 == pid,
          proof["revision"] as? String == revision,
          proof["birthSeconds"] as? UInt64 == birth.pbi_start_tvsec,
          proof["birthMicros"] as? UInt64 == birth.pbi_start_tvusec,
          let checkedAt = proof["checkedAt"] as? Double else { return false }
    let age = Date().timeIntervalSince1970 - checkedAt
    return age >= -0.25 && age <= 1.5
}

// Login never attaches a debugger to an existing session. The guard must
// already be resident, installed by the cold launcher or a supervised writer.
func desktopSessionAllowsAutomation(_ state: [String: Any]?) -> Bool {
    guard let state,
          state[kCGSessionOnConsoleKey as String] as? Bool == true,
          state[kCGSessionLoginDoneKey as String] as? Bool == true else { return false }
    // macOS omits the locked flag on an unlocked console session.
    return (state["CGSSessionScreenIsLocked"] as? NSNumber)?.boolValue != true
}
