import AuthenticationServices
import CryptoKit
import Security
import Tauri
import UIKit
import WebKit

private struct StorageArgs: Decodable { let key: String; let value: String? }
private struct AutoFillArgs: Decodable { let entries: [AutoFillEntry] }
private struct OAuthArgs: Decodable { let url: String }

final class ApplePlugin: Plugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding, ASWebAuthenticationPresentationContextProviding {
    private weak var webview: WKWebView?
    private var pending: Invoke?
    private var nonce = ""
    private var controller: ASAuthorizationController?
    private var webSession: ASWebAuthenticationSession?
    @objc func registerPush(_ invoke: Invoke) { PushRegistration.register(invoke) }
    @objc func oauth(_ invoke: Invoke) {
        do {
            let args = try invoke.parseArgs(OAuthArgs.self)
            guard let url = URL(string: args.url), url.scheme == "https", url.host == "zeparkyoyqvjzavrejsa.supabase.co", url.path == "/auth/v1/authorize" else {
                invoke.reject("Invalid sign-in address."); return
            }
            DispatchQueue.main.async {
                guard self.webSession == nil, self.webview?.window != nil else { invoke.reject("Sign-in is unavailable or already open."); return }
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "polymux-mobile") { callback, error in
                    self.webSession = nil
                    guard let callback, callback.scheme == "polymux-mobile", callback.host == "auth", callback.path == "/callback" else {
                        invoke.reject(error == nil ? "Invalid sign-in response." : "Sign-in cancelled or failed."); return
                    }
                    invoke.resolve(["url": callback.absoluteString])
                }
                session.presentationContextProvider = self
                self.webSession = session
                if !session.start() { self.webSession = nil; invoke.reject("Could not start sign-in.") }
            }
        } catch { invoke.reject("Could not start sign-in.") }
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { webview!.window! }

    @objc func updateAutoFill(_ invoke: Invoke) {
        do {
            let entries = try invoke.parseArgs(AutoFillArgs.self).entries
            guard entries.count <= 10000 else { invoke.reject("Too many AutoFill entries."); return }
            try AutoFillStore.save(entries)
            let identities = entries.filter { !$0.password.isEmpty && URL(string: $0.url)?.host != nil }.map {
                ASPasswordCredentialIdentity(serviceIdentifier: ASCredentialServiceIdentifier(identifier: $0.url, type: .URL), user: $0.username, recordIdentifier: $0.id)
            }
            let completion: (Bool, Error?) -> Void = { success, error in
                if let error { invoke.reject(error.localizedDescription) }
                else { invoke.resolve(["indexed": success]) }
            }
            ASCredentialIdentityStore.shared.getState { state in
              guard state.isEnabled else { invoke.resolve(["indexed": false]); return }
              if #available(iOS 18.0, *) {
                var all: [any ASCredentialIdentity] = identities
                all += entries.filter { $0.otpAuth != nil && URL(string: $0.url)?.host != nil }.map {
                    ASOneTimeCodeCredentialIdentity(serviceIdentifier: ASCredentialServiceIdentifier(identifier: $0.url, type: .URL), label: $0.title, recordIdentifier: $0.id)
                }
                ASCredentialIdentityStore.shared.replaceCredentialIdentities(all, completion: completion)
              } else {
                ASCredentialIdentityStore.shared.replaceCredentialIdentities(with: identities, completion: completion)
              }
            }
        } catch { invoke.reject(error.localizedDescription) }
    }

    @objc func disableAutoFill(_ invoke: Invoke) {
        do {
            try AutoFillStore.clear()
            ASCredentialIdentityStore.shared.removeAllCredentialIdentities { _, error in
                if let error { invoke.reject(error.localizedDescription) } else { invoke.resolve() }
            }
        } catch { invoke.reject(error.localizedDescription) }
    }

    override func load(webview: WKWebView) { self.webview = webview }

    @objc func signIn(_ invoke: Invoke) {
        DispatchQueue.main.async {
            guard self.pending == nil else { invoke.reject("Sign-in is already in progress."); return }
            guard self.webview?.window != nil else { invoke.reject("Open Polymux to sign in."); return }
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
                invoke.reject("Could not start secure sign-in."); return
            }
            self.nonce = bytes.map { String(format: "%02x", $0) }.joined()
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = SHA256.hash(data: Data(self.nonce.utf8)).map { String(format: "%02x", $0) }.joined()
            self.pending = invoke
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return webview!.window!
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        defer { pending = nil; nonce = ""; self.controller = nil }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let data = credential.identityToken, let token = String(data: data, encoding: .utf8) else {
            pending?.reject("Apple did not return a sign-in token."); return
        }
        pending?.resolve(["identityToken": token, "nonce": nonce])
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        pending?.reject((error as? ASAuthorizationError)?.code == .canceled ? "Sign-in cancelled." : "Apple sign-in failed. Try again.")
        pending = nil; nonce = ""; self.controller = nil
    }

    private func query(_ key: String) throws -> [String: Any] {
        guard key.hasPrefix("polymux-account:"), key.count < 200 else {
            throw NSError(domain: "Polymux", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid storage key"])
        }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "com.flarehq.polymux.mobile.account",
                kSecAttrAccount as String: key]
    }

    @objc func secureGet(_ invoke: Invoke) {
        do {
            let args = try invoke.parseArgs(StorageArgs.self)
            var query = try query(args.key)
            query[kSecReturnData as String] = true
            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            if status == errSecItemNotFound { invoke.resolve(["value": NSNull()]); return }
            guard status == errSecSuccess, let data = result as? Data,
                  let value = String(data: data, encoding: .utf8) else { invoke.reject("Secure storage is unavailable."); return }
            invoke.resolve(["value": value])
        } catch { invoke.reject("Could not read secure storage.") }
    }

    @objc func secureSet(_ invoke: Invoke) {
        do {
            let args = try invoke.parseArgs(StorageArgs.self)
            guard let value = args.value else { invoke.reject("Missing storage value."); return }
            let query = try query(args.key)
            let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8),
                kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
            var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
            if status == errSecItemNotFound {
                status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
            }
            guard status == errSecSuccess else { invoke.reject("Could not save secure storage."); return }
            invoke.resolve()
        } catch { invoke.reject("Could not save secure storage.") }
    }

    @objc func secureRemove(_ invoke: Invoke) {
        do {
            let args = try invoke.parseArgs(StorageArgs.self)
            let status = SecItemDelete(try query(args.key) as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { invoke.reject("Could not clear secure storage."); return }
            invoke.resolve()
        } catch { invoke.reject("Could not clear secure storage.") }
    }
}

@_cdecl("init_plugin_polymux_apple")
func initPlugin() -> Plugin { ApplePlugin() }
