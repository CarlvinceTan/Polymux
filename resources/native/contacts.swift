import Contacts
import Foundation

struct Match: Codable { let name: String; let aliases: [String]; let phones: [String] }
struct Result: Codable { let status: String; let matches: [Match] }

func normalized(_ value: String) -> String {
  value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
    .lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).joined()
}
func emit(_ result: Result) -> Never {
  let data = try! JSONEncoder().encode(result)
  print(String(data: data, encoding: .utf8)!)
  exit(0)
}

let query = CommandLine.arguments.dropFirst().joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
guard !query.isEmpty else { emit(Result(status: "invalid", matches: [])) }
switch CNContactStore.authorizationStatus(for: .contacts) {
case .authorized: break
case .notDetermined: emit(Result(status: "not-determined", matches: []))
case .denied: emit(Result(status: "denied", matches: []))
case .restricted: emit(Result(status: "restricted", matches: []))
@unknown default: emit(Result(status: "unknown", matches: []))
}

let keys: [CNKeyDescriptor] = [
  CNContactGivenNameKey as CNKeyDescriptor, CNContactMiddleNameKey as CNKeyDescriptor,
  CNContactFamilyNameKey as CNKeyDescriptor, CNContactNicknameKey as CNKeyDescriptor,
  CNContactOrganizationNameKey as CNKeyDescriptor, CNContactPhoneNumbersKey as CNKeyDescriptor,
  CNContactRelationsKey as CNKeyDescriptor,
]
let request = CNContactFetchRequest(keysToFetch: keys)
request.unifyResults = true
let needle = normalized(query)
var matches: [Match] = []
do {
  try CNContactStore().enumerateContacts(with: request) { contact, stop in
    let fullName = [contact.givenName, contact.middleName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
    var aliases = [contact.nickname, contact.organizationName].filter { !$0.isEmpty }
    aliases.append(contentsOf: contact.contactRelations.flatMap { relation in
      let localized = CNLabeledValue<CNContactRelation>.localizedString(forLabel: relation.label ?? "")
      return [relation.value.name, localized].filter { !$0.isEmpty }
    })
    let names = [fullName, contact.givenName, contact.familyName] + aliases
    guard names.contains(where: { normalized($0) == needle }) else { return }
    matches.append(Match(
      name: fullName.isEmpty ? (contact.nickname.isEmpty ? query : contact.nickname) : fullName,
      aliases: Array(Set(aliases)).sorted(),
      phones: Array(Set(contact.phoneNumbers.map { $0.value.stringValue }.filter { !$0.isEmpty })).sorted()
    ))
    if matches.count >= 8 { stop.pointee = true }
  }
  emit(Result(status: "granted", matches: matches))
} catch { emit(Result(status: "error", matches: [])) }
