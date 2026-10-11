import Foundation
import Observation

@MainActor @Observable
public final class HostStore {
    public private(set) var value: HostState?
    public private(set) var error: String?
    public private(set) var saving = false
    private let client: APIClient
    private var revision = 0

    public init(client: APIClient) { self.client = client }

    public func refresh() async {
        guard !saving else { return }
        let version = revision
        do {
            let response = try await client.host()
            guard version == revision, !saving else { return }
            value = response
            error = nil
        } catch {
            guard version == revision, !saving else { return }
            self.error = "Host controller unavailable."
        }
    }

    public func setEnabled(_ enabled: Bool) async {
        guard !saving else { return }
        revision += 1
        saving = true
        defer { saving = false }
        do {
            value = try await client.host(enabled: enabled)
            error = nil
        } catch {
            self.error = "Couldn’t change server state. Check the host controller before retrying."
        }
    }
}
