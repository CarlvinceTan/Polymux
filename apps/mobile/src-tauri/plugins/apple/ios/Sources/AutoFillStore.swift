import Foundation
import Security
import CryptoKit

struct AutoFillEntry: Codable {
    let id: String
    let title: String
    let username: String
    let url: String
    let password: String
    let otpAuth: String?
}

enum AutoFillStore {
    static let group = "group.com.flarehq.polymux.mobile"
    static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.flarehq.polymux.mobile.autofill",
         kSecAttrAccount as String: "credentials",
         kSecAttrAccessGroup as String: "23YB4896XA.com.flarehq.polymux.mobile.vault"]
    }
    static func save(_ entries: [AutoFillEntry]) throws {
        let data = try JSONEncoder().encode(entries)
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, &error) else {
            throw failure("Enable a device passcode before using AutoFill.")
        }
        var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessControl as String] = access
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw failure("Could not update AutoFill. Unlock your device and try again.") }
    }
    static func load() throws -> [AutoFillEntry] {
        var item = query
        item[kSecReturnData as String] = true
        item[kSecUseOperationPrompt as String] = "Unlock Polymux Vault"
        var result: CFTypeRef?
        let status = SecItemCopyMatching(item as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess, let data = result as? Data else { throw failure("Unlock cancelled or unavailable.") }
        return try JSONDecoder().decode([AutoFillEntry].self, from: data)
    }
    static func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw failure("Could not disable AutoFill.") }
    }
    static func failure(_ message: String) -> NSError {
        NSError(domain: "PolymuxVault", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

enum OneTimeCode {
    static func generate(_ uri: String, time: TimeInterval = Date().timeIntervalSince1970) throws -> String {
        guard let url = URLComponents(string: uri), url.scheme == "otpauth", url.host == "totp" else { throw AutoFillStore.failure("Invalid authenticator.") }
        let fields = Dictionary((url.queryItems ?? []).map { ($0.name.lowercased(), $0.value ?? "") }, uniquingKeysWith: { first, _ in first })
        let digits = Int(fields["digits"] ?? "6") ?? 0
        let period = Int(fields["period"] ?? "30") ?? 0
        guard (6...8).contains(digits), period > 0, time >= 0 else { throw AutoFillStore.failure("Invalid authenticator settings.") }
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var bits = 0, value = 0
        var secret = Data()
        for character in (fields["secret"] ?? "").uppercased() where character != "=" && character != " " && character != "-" {
            guard let digit = alphabet.firstIndex(of: character) else { throw AutoFillStore.failure("Invalid authenticator secret.") }
            value = ((value << 5) | digit) & 0xffff
            bits += 5
            if bits >= 8 { bits -= 8; secret.append(UInt8((value >> bits) & 255)) }
        }
        guard !secret.isEmpty else { throw AutoFillStore.failure("Missing authenticator secret.") }
        var counter = UInt64(time / Double(period)).bigEndian
        let data = withUnsafeBytes(of: &counter) { Data($0) }
        let key = SymmetricKey(data: secret)
        let digest: [UInt8]
        switch (fields["algorithm"] ?? "SHA1").uppercased() {
        case "SHA1": digest = Array(HMAC<Insecure.SHA1>.authenticationCode(for: data, using: key))
        case "SHA256": digest = Array(HMAC<SHA256>.authenticationCode(for: data, using: key))
        case "SHA512": digest = Array(HMAC<SHA512>.authenticationCode(for: data, using: key))
        default: throw AutoFillStore.failure("Unsupported authenticator algorithm.")
        }
        let offset = Int(digest.last! & 15)
        let number = (UInt32(digest[offset]) & 127) << 24 | UInt32(digest[offset + 1]) << 16 | UInt32(digest[offset + 2]) << 8 | UInt32(digest[offset + 3])
        let modulus = UInt32(pow(10.0, Double(digits)))
        return String(format: "%0*u", digits, number % modulus)
    }
}
