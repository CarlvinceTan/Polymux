import Foundation

@main
struct AddressTest {
    static func main() {
        let suite = "address-test-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let chosen = "https://chosen.example:8787"
        precondition(ServerAddress.resolve(chosen, defaults: defaults)?.absoluteString == chosen)
        defaults.set("http://fixture.example:9000", forKey: "PolymuxServer")
        #if DEBUG
        precondition(ServerAddress.resolve(chosen, defaults: defaults)?.host == "fixture.example")
        #else
        precondition(ServerAddress.resolve(chosen, defaults: defaults)?.absoluteString == chosen)
        defaults.set("invalid", forKey: "PolymuxServer")
        precondition(ServerAddress.resolve(chosen, defaults: defaults)?.absoluteString == chosen)
        #endif
    }
}
