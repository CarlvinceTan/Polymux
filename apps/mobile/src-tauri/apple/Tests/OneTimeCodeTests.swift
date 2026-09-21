import Foundation

@main
struct OneTimeCodeTests {
    static func main() throws {
        // RFC 6238 Appendix B: every timestamp and supported hash algorithm.
        let times: [TimeInterval] = [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000]
        let vectors: [(String, String, [String])] = [
            ("SHA1", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", ["94287082", "07081804", "14050471", "89005924", "69279037", "65353130"]),
            ("SHA256", base32("12345678901234567890123456789012"), ["46119246", "68084774", "67062674", "91819424", "90698825", "77737706"]),
            ("SHA512", base32("1234567890123456789012345678901234567890123456789012345678901234"), ["90693936", "25091201", "99943326", "93441116", "38618901", "47863826"])
        ]
        for (algorithm, secret, expected) in vectors {
            for (index, time) in times.enumerated() {
                let code = try OneTimeCode.generate("otpauth://totp/Test?secret=\(secret)&algorithm=\(algorithm)&digits=8", time: time)
                precondition(code == expected[index], "RFC 6238 mismatch: \(algorithm), \(time)")
            }
        }
        for uri in ["https://example.com", "otpauth://hotp/Test?secret=AAAA", "otpauth://totp/Test?secret=AAAA&period=0", "otpauth://totp/Test?secret=AAAA&algorithm=MD5", "otpauth://totp/Test?secret=!!!"] {
            do { _ = try OneTimeCode.generate(uri); fatalError("Accepted invalid authenticator") } catch {}
        }
        print("18 RFC 6238 vectors and 5 invalid-input checks passed")
    }
    static func base32(_ value: String) -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var bits = 0, buffer = 0, output = ""
        for byte in value.utf8 {
            buffer = ((buffer << 8) | Int(byte)) & 0xffff; bits += 8
            while bits >= 5 { bits -= 5; output.append(alphabet[(buffer >> bits) & 31]) }
        }
        if bits > 0 { output.append(alphabet[(buffer << (5 - bits)) & 31]) }
        return output
    }
}
