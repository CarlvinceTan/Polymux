#if os(macOS)
import Foundation
import Security

public final class PinnedSession: NSObject, URLSessionDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    private let certificate: Data
    private let host: String
    public init(certificate: Data, host: String) { self.certificate = certificate; self.host = host }

    public func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.urlCredentialStorage = nil
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    public func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                           completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host == host, let trust = challenge.protectionSpace.serverTrust,
              let anchor = SecCertificateCreateWithData(nil, certificate as CFData) else {
            completionHandler(.cancelAuthenticationChallenge, nil); return
        }
        SecTrustSetAnchorCertificates(trust, [anchor] as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, host as CFString))
        guard SecTrustEvaluateWithError(trust, nil),
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let root = chain.last,
              SecCertificateCopyData(root) as Data == certificate else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

public enum Pairing {
    public static func enroll(_ ticket: PairTicket, capabilities: [String], name: String) async throws -> DeviceCredential {
        guard DevicePolicy.valid(capabilities), capabilities.allSatisfy(ticket.capabilities.contains),
              ticket.certificate.count > 0, let host = ticket.url.host else { throw ControlError.invalidTicket }
        let pin = PinnedSession(certificate: ticket.certificate, host: host)
        let session = pin.makeSession()
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: ticket.url.appending(path: "enroll"))
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        struct Input: Encodable { let code: String; let name: String; let capabilities: [String] }
        request.httpBody = try JSONEncoder().encode(Input(code: ticket.code, name: String(name.prefix(64)), capabilities: capabilities))
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, data.count < 8192 else { throw ControlError.invalidTicket }
        struct Output: Decodable { let id: String; let token: String; let agent: String; let capabilities: [String] }
        let output = try JSONDecoder().decode(Output.self, from: data)
        guard output.id.count == 43, output.token.count == 43, output.agent == ticket.agent,
              Set(output.capabilities) == Set(capabilities) else { throw ControlError.badResponse }
        return DeviceCredential(url: ticket.url, certificate: ticket.certificate, id: output.id, token: output.token,
                                agent: output.agent, capabilities: output.capabilities)
    }

    public static func revoke(_ credential: DeviceCredential) async throws {
        let session = PinnedSession(certificate: credential.certificate, host: credential.url.host ?? "").makeSession()
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: credential.url.appending(path: "pairing"))
        request.httpMethod = "DELETE"; request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await session.data(for: request)
        guard [204, 401].contains((response as? HTTPURLResponse)?.statusCode ?? 0) else { throw ControlError.unavailable }
    }

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.carlvince.luce.control", kSecAttrAccount as String: "pairing"]
    }

    public static func load() throws -> DeviceCredential? {
        var input = query
        input[kSecReturnData as String] = true; input[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(input as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw ControlError.unavailable }
        return try JSONDecoder().decode(DeviceCredential.self, from: data)
    }

    public static func save(_ credential: DeviceCredential) throws {
        let data = try JSONEncoder().encode(credential)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var input = query
            input[kSecValueData as String] = data
            input[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(input as CFDictionary, nil) == errSecSuccess else { throw ControlError.unavailable }
        } else if status != errSecSuccess { throw ControlError.unavailable }
    }

    public static func remove() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw ControlError.unavailable }
    }
}
#endif
