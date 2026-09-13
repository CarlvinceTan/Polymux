// Read-only fallback when Qt omits a hidden window from Accessibility.
// No debugger attach, target calls, suspension, memory writes or UI actions.
import AppKit
import CryptoKit
import Darwin
import Foundation
import CoreGraphics

enum ProbeFailure: Error { case unavailable }
let supportedHash = "4e85aba6fb2a99f7d0d28b3248de8f06feb9f38aeea49a5edc3e776e5a82a04f"
let supportedUUID: [UInt8] = [0xc6,0xf8,0xc0,0xa6,0xbb,0x7c,0x3d,0xf1,0xb3,0xac,0xca,0xd6,0xa1,0xa1,0x46,0x1f]
let imagePath = "/Applications/WeChat.app/Contents/Resources/wechat.dylib"

func locked() -> Bool {
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return true }
    return (session["CGSSessionScreenIsLocked"] as? NSNumber)?.boolValue == true
}

final class RemoteMemory {
    let task: mach_port_t
    init(pid: pid_t) throws {
        var port: mach_port_t = 0
        guard task_for_pid(mach_task_self_, pid, &port) == KERN_SUCCESS else { throw ProbeFailure.unavailable }
        task = port
    }
    deinit { mach_port_deallocate(mach_task_self_, task) }
    func read(_ address: UInt64, _ count: Int) throws -> Data {
        guard address >= 0x100000000, count > 0, count <= 131072,
              address <= UInt64.max - UInt64(count) else { throw ProbeFailure.unavailable }
        var data = Data(count: count)
        var actual: mach_vm_size_t = 0
        let result = data.withUnsafeMutableBytes { buffer in
            mach_vm_read_overwrite(task, address, UInt64(count),
                UInt64(UInt(bitPattern: buffer.baseAddress!)), &actual)
        }
        guard result == KERN_SUCCESS, actual == count else { throw ProbeFailure.unavailable }
        return data
    }
    func u64(_ address: UInt64) throws -> UInt64 {
        try read(address, 8).withUnsafeBytes { $0.loadUnaligned(as: UInt64.self) }
    }
    func string(_ address: UInt64) throws -> String {
        var data = Data()
        while data.count < 1024 {
            let cursor = address + UInt64(data.count)
            let chunk = try read(cursor, min(64, 4096 - Int(cursor % 4096)))
            if let end = chunk.firstIndex(of: 0) {
                data.append(chunk.prefix(end))
                guard let text = String(data: data, encoding: .utf8) else { throw ProbeFailure.unavailable }
                return text
            }
            data.append(chunk)
        }
        throw ProbeFailure.unavailable
    }
    func imageBase() throws -> UInt64 {
        var info = task_dyld_info()
        var count = mach_msg_type_number_t(MemoryLayout<task_dyld_info>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(task, task_flavor_t(TASK_DYLD_INFO), $0, &count)
            }
        }
        guard result == KERN_SUCCESS else { throw ProbeFailure.unavailable }
        let directory = try read(info.all_image_info_addr, 16)
        let images = directory.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 4, as: UInt32.self) }
        let array = directory.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 8, as: UInt64.self) }
        guard images > 0, images <= 4096 else { throw ProbeFailure.unavailable }
        let rows = try read(array, Int(images) * 24)
        var matches: [UInt64] = []
        for index in 0..<Int(images) {
            let base = rows.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: index * 24, as: UInt64.self) }
            let name = rows.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: index * 24 + 8, as: UInt64.self) }
            if let name = try? string(name), (name as NSString).standardizingPath == imagePath { matches.append(base) }
        }
        guard matches.count == 1 else { throw ProbeFailure.unavailable }
        let base = matches[0], header = try read(base, 32)
        let magic = header.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
        let cpu = header.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 4, as: UInt32.self) }
        let commands = header.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 16, as: UInt32.self) }
        let size = header.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 20, as: UInt32.self) }
        guard magic == 0xfeedfacf, cpu == 0x0100000c, size <= 65536 else { throw ProbeFailure.unavailable }
        let data = try read(base + 32, Int(size))
        var offset = 0, verified = false
        for _ in 0..<commands {
            guard offset + 8 <= data.count else { throw ProbeFailure.unavailable }
            let command = data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: offset, as: UInt32.self) }
            let length = Int(data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: offset + 4, as: UInt32.self) })
            guard length >= 8, length <= data.count - offset else { throw ProbeFailure.unavailable }
            if command == 0x1b {
                guard length == 24, Array(data[(offset + 8)..<(offset + 24)]) == supportedUUID else { throw ProbeFailure.unavailable }
                verified = true
            }
            offset += length
        }
        guard verified else { throw ProbeFailure.unavailable }
        return base
    }
}

func accountFingerprint(_ memory: RemoteMemory, _ base: UInt64) throws -> String {
    let context = try memory.u64(base + 0x92fce98)
    guard try memory.u64(context) == base + 0x8de8db0 else { throw ProbeFailure.unavailable }
    let account = try memory.u64(context + 0x68)
    guard try memory.u64(account) == base + 0x8d8f0a8 else { throw ProbeFailure.unavailable }
    // Account virtual slot 0 (3a29800) loads its atomic active-login flag.
    // The constructor sets it after account initialization (3a1f624);
    // account teardown clears it before notifying observers (3a24610).
    guard try memory.read(account + 0x38, 1)[0] == 1 else { throw ProbeFailure.unavailable }
    let storage = try memory.read(account + 0x48, 24)
    let body: Data
    if storage[23] & 0x80 == 0 {
        let length = Int(storage[23])
        guard length > 0, length <= 22 else { throw ProbeFailure.unavailable }
        body = storage.prefix(length)
    } else {
        let address = storage.withUnsafeBytes { $0.loadUnaligned(as: UInt64.self) }
        let length = storage.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 8, as: UInt64.self) }
        guard length > 0, length <= 128 else { throw ProbeFailure.unavailable }
        body = try memory.read(address, Int(length))
    }
    guard let identity = String(data: body, encoding: .utf8),
          identity.range(of: "^wxid_[A-Za-z0-9_-]+$", options: .regularExpression) != nil,
          try memory.u64(base + 0x92fce98) == context,
          try memory.u64(context + 0x68) == account,
          try memory.u64(account) == base + 0x8d8f0a8,
          try memory.read(account + 0x38, 1)[0] == 1,
          try memory.read(account + 0x48, 24) == storage else { throw ProbeFailure.unavailable }
    return SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
}

func probe() -> [String: Any] {
    guard !locked() else { return ["ok":true,"state":"locked"] }
    guard CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--pid",
          let pid = Int32(CommandLine.arguments[2]), pid > 1,
          let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated,
          app.bundleIdentifier == "com.tencent.xinWeChat",
          app.executableURL?.path == "/Applications/WeChat.app/Contents/MacOS/WeChat",
          app.isFinishedLaunching else { return ["ok":false,"state":"unavailable"] }
    do {
        let data = try Data(contentsOf: URL(fileURLWithPath:imagePath), options:.mappedIfSafe)
        guard SHA256.hash(data: data).map({ String(format:"%02x",$0) }).joined() == supportedHash else { throw ProbeFailure.unavailable }
        let memory = try RemoteMemory(pid: pid), base = try memory.imageBase()
        let fingerprint = try accountFingerprint(memory, base)
        guard !app.isTerminated, !locked() else { return ["ok":true,"state":"locked"] }
        return ["ok":true,"state":"signed_in","pid":pid,"accountFingerprint":fingerprint]
    } catch { return ["ok":false,"state":"unavailable","pid":pid] }
}

let result = probe()
if let data = try? JSONSerialization.data(withJSONObject:result), let text = String(data:data,encoding:.utf8) { print(text) }
