import AuthenticationServices
import UIKit

final class CredentialProviderViewController: ASCredentialProviderViewController, UITableViewDataSource, UITableViewDelegate {
    private var entries: [AutoFillEntry] = []
    private var oneTimeCodes = false
    private let table = UITableView()
    private let message = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        table.dataSource = self; table.delegate = self
        table.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(table)
        let cancel = UIButton(type: .system)
        cancel.setTitle("Cancel", for: .normal)
        cancel.addTarget(self, action: #selector(cancelRequest), for: .touchUpInside)
        cancel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(cancel)
        message.textAlignment = .center; message.numberOfLines = 0
        table.backgroundView = message
        NSLayoutConstraint.activate([
            cancel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            cancel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            cancel.heightAnchor.constraint(equalToConstant: 44),
            table.topAnchor.constraint(equalTo: cancel.bottomAnchor, constant: 8),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
    }
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        oneTimeCodes = false; loadEntries(serviceIdentifiers)
    }
    @available(iOS 18.0, *)
    override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        oneTimeCodes = true; loadEntries(serviceIdentifiers)
    }
    override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) {
        extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userInteractionRequired.rawValue))
    }
    override func prepareInterfaceToProvideCredential(for credentialIdentity: ASPasswordCredentialIdentity) {
        oneTimeCodes = false; loadEntries([credentialIdentity.serviceIdentifier], selected: credentialIdentity.recordIdentifier)
    }
    @available(iOS 17.0, *)
    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userInteractionRequired.rawValue))
    }
    @available(iOS 17.0, *)
    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        oneTimeCodes = false
        if #available(iOS 18.0, *), credentialRequest is ASOneTimeCodeCredentialRequest {
            oneTimeCodes = true
        } else if !(credentialRequest is ASPasswordCredentialRequest) {
            extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.credentialIdentityNotFound.rawValue))
            return
        }
        loadEntries([], selected: credentialRequest.credentialIdentity.recordIdentifier)
    }
    private func loadEntries(_ services: [ASCredentialServiceIdentifier], selected: String? = nil) {
        loadViewIfNeeded()
        table.allowsSelection = true
        do {
            entries = try AutoFillStore.load().filter { oneTimeCodes ? $0.otpAuth != nil : !$0.password.isEmpty }
            let domains = services.compactMap { URL(string: $0.identifier)?.host ?? ($0.type == .domain ? $0.identifier : nil) }
            entries.sort { left, right in
                func matches(_ entry: AutoFillEntry) -> Bool {
                    guard let host = URL(string: entry.url)?.host else { return false }
                    return domains.contains { $0.caseInsensitiveCompare(host) == .orderedSame }
                }
                return matches(left) && !matches(right)
            }
            table.reloadData()
            if let selected, let entry = entries.first(where: { $0.id == selected }) { complete(entry); return }
            message.text = entries.isEmpty ? "Open Polymux, unlock Vault, and update AutoFill." : nil
            table.reloadData()
        } catch { entries = []; message.text = error.localizedDescription; table.reloadData() }
    }
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { entries.count }
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        let entry = entries[indexPath.row]
        cell.textLabel?.text = entry.title
        cell.detailTextLabel?.text = [entry.username, URL(string: entry.url)?.host ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
        return cell
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        guard tableView.allowsSelection, entries.indices.contains(indexPath.row) else { return }
        tableView.deselectRow(at: indexPath, animated: false)
        complete(entries[indexPath.row])
    }
    private func complete(_ entry: AutoFillEntry) {
        if oneTimeCodes {
            if #available(iOS 18.0, *), let uri = entry.otpAuth {
                do {
                    let code = try OneTimeCode.generate(uri)
                    extensionContext.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: code))
                } catch {
                    message.text = error.localizedDescription
                    return
                }
            } else {
                message.text = "This authenticator is unavailable. Choose another entry."
                return
            }
        } else { extensionContext.completeRequest(withSelectedCredential: ASPasswordCredential(user: entry.username, password: entry.password), completionHandler: nil) }
        table.allowsSelection = false
        entries = []
        table.reloadData()
    }
    @objc private func cancelRequest() {
        table.allowsSelection = false
        entries = []
        table.reloadData()
        extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userCanceled.rawValue))
    }
}
