#if os(macOS)
import Foundation
import Darwin

private final class OutputBuffer: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.flarehq.polymux.app.command-output")
    private let source: DispatchSourceRead
    private let fd: Int32
    private var data = Data()
    private var truncated = false

    init(handle: FileHandle) {
        fd = handle.fileDescriptor
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
        source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        source.setEventHandler { [weak self] in self?.drain() }
        source.resume()
    }

    private func drain() {
        var chunk = [UInt8](repeating: 0, count: 8192)
        for _ in 0..<32 {
            let count = Darwin.read(fd, &chunk, chunk.count)
            if count <= 0 { break }
            let remaining = max(0, (64 << 10) - data.count)
            truncated = truncated || count > remaining
            data.append(contentsOf: chunk.prefix(min(count, remaining)))
        }
    }

    func finish() -> String {
        queue.sync {
            source.cancel(); drain()
            let text = String(decoding: data, as: UTF8.self)
            let suffix = truncated ? "\n[Output truncated at 64 KiB]\n" : ""
            let limit = min(text.utf8.count, (64 << 10) - suffix.utf8.count)
            var end = text.utf8.index(text.utf8.startIndex, offsetBy: limit)
            while String.Index(end, within: text) == nil { end = text.utf8.index(before: end) }
            return String(text[..<String.Index(end, within: text)!]) + suffix
        }
    }
}

public actor CommandRunner {
    private var pid: pid_t?
    private var interrupted = false

    public init() {}

    public func run(_ arguments: [String: WireValue], directory: URL) async throws -> DeviceContent {
        try Task.checkCancellation()
        guard pid == nil, let command = arguments["command"]?.string, command.hasPrefix("/"), command.utf8.count < 2048,
              !command.contains("\0") else { throw ControlError.denied }
        let values = arguments["args"]?.array ?? []
        guard values.count <= 64, arguments["args"] == nil || arguments["args"]?.array != nil else { throw ControlError.denied }
        let args = try values.map { value -> String in
            guard let text = value.string, text.utf8.count <= 8192, !text.contains("\0") else { throw ControlError.denied }
            return text
        }
        guard !["osascript", "open", "tccutil", "sudo"].contains(URL(fileURLWithPath: command).lastPathComponent) else { throw ControlError.denied }
        let output = Pipe()
        let buffer = OutputBuffer(handle: output.fileHandleForReading)
        var child: pid_t?
        defer {
            if let child {
                // Keep the leader waitable until its entire owned group is stopped.
                kill(-child, SIGKILL)
                var status: Int32 = 0
                while waitpid(child, &status, 0) < 0 && errno == EINTR {}
            }
            pid = nil
            _ = buffer.finish()
            try? output.fileHandleForWriting.close()
            try? output.fileHandleForReading.close()
        }
        try Task.checkCancellation()
        let spawned = try Self.spawn(command, args, directory: directory, output: output.fileHandleForWriting.fileDescriptor)
        child = spawned; pid = spawned; interrupted = false
        try output.fileHandleForWriting.close()
        let deadline = ContinuousClock.now.advanced(by: .seconds(110))
        var info = siginfo_t()
        while true {
            try Task.checkCancellation()
            if waitid(P_PID, id_t(spawned), &info, WEXITED | WNOHANG | WNOWAIT) != 0 {
                if errno == EINTR { continue }
                throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
            }
            if info.si_pid == spawned { break }
            guard ContinuousClock.now < deadline else { throw ControlError.interrupted }
            try await Task.sleep(for: .milliseconds(20))
        }
        try Task.checkCancellation()
        guard !interrupted else { throw ControlError.interrupted }
        let text = buffer.finish()
        if info.si_code != CLD_EXITED || info.si_status != 0 { throw CommandError(output: text, status: info.si_status) }
        return .text(text)
    }

    public func stop() {
        guard let pid else { return }
        interrupted = true
        kill(-pid, SIGKILL)
    }

    private static func spawn(_ command: String, _ args: [String], directory: URL, output: Int32) throws -> pid_t {
        func check(_ status: Int32) throws {
            if status != 0 { throw NSError(domain: NSPOSIXErrorDomain, code: Int(status)) }
        }
        var actions: posix_spawn_file_actions_t?
        var attributes: posix_spawnattr_t?
        try check(posix_spawn_file_actions_init(&actions))
        defer { posix_spawn_file_actions_destroy(&actions) }
        try check(posix_spawnattr_init(&attributes))
        defer { posix_spawnattr_destroy(&attributes) }
        try check(posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT)))
        try check(posix_spawnattr_setpgroup(&attributes, 0))
        try check(posix_spawn_file_actions_addchdir(&actions, directory.path))
        try check(posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0))
        try check(posix_spawn_file_actions_adddup2(&actions, output, STDOUT_FILENO))
        try check(posix_spawn_file_actions_adddup2(&actions, output, STDERR_FILENO))
        let environment = ["PATH=/usr/bin:/bin:/usr/sbin:/sbin", "HOME=\(FileManager.default.homeDirectoryForCurrentUser.path)"]
        var argv = ([command] + args).map { strdup($0) } + [nil]
        var envp = environment.map { strdup($0) } + [nil]
        defer { for pointer in argv + envp { free(pointer) } }
        guard argv.dropLast().allSatisfy({ $0 != nil }), envp.dropLast().allSatisfy({ $0 != nil }) else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(ENOMEM))
        }
        var pid: pid_t = 0
        try check(posix_spawn(&pid, command, &actions, &attributes, &argv, &envp))
        return pid
    }
}

private struct CommandError: Error, LocalizedError {
    let output: String
    let status: Int32
    var errorDescription: String? { output + "\nCommand ended with status \(status). Inspect state before retrying." }
}
#endif
