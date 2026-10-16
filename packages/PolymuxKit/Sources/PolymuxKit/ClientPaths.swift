import Foundation

public enum ClientPaths {
    public static func cache(_ address: String) -> URL {
        cache(address, root: root)
    }

    public static var control: URL {
        root.appending(path: "control", directoryHint: .isDirectory)
    }

    private static var root: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        #if os(macOS)
        let home = FileManager.default.homeDirectoryForCurrentUser
        let desktop = true
        #else
        let home = support
        let desktop = false
        #endif
        return root(home: home, support: support, environment: ProcessInfo.processInfo.environment, desktop: desktop)
    }

    static func root(home: URL, support: URL, environment: [String: String], desktop: Bool) -> URL {
        if let path = environment["POLYMUX_DATA_DIR"], !path.isEmpty {
            return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        }
        return desktop ? home.appending(path: ".polymux", directoryHint: .isDirectory)
            : support.appending(path: "Polymux", directoryHint: .isDirectory)
    }

    static func cache(_ address: String, root: URL) -> URL {
        let key = address.utf8.reduce(UInt64(5381)) { ($0 &* 33) &+ UInt64($1) }
        return root.appending(path: "app-\(key)/cache.sqlite")
    }
}
