// Send one local attachment through WeChat's own composer without activating
// WeChat or changing the user's current conversation.
//
// Usage: wechat-paste-send <wechat-pid> <absolute-path> <file|video>
//        <chat-title> [session-index]

import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

struct SavedPasteboardItem {
  let values: [(NSPasteboard.PasteboardType, Data)]
}

var diagnostic: [String: Any] = [:]
var windowGuardArmPath: String?

// The guard files live in the target's own temporary directory so a sandboxed
// WeChat can read what this helper writes. The container exists exactly when
// WeChat has run sandboxed, which is the same rule the injected library and
// the driver follow.
func windowGuardDirectory() -> URL {
  let container = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Containers/com.tencent.xinWeChat/Data/tmp")
  if FileManager.default.fileExists(atPath: container.path) { return container }
  return URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
}

func windowGuardPath(pid: pid_t, suffix: String) -> String {
  windowGuardDirectory()
    .appendingPathComponent("polymux-wechat-window-guard-\(pid).\(suffix)")
    .path
}

func privateRegularFile(_ path: String) -> stat? {
  var details = stat()
  guard lstat(path, &details) == 0,
        (details.st_mode & S_IFMT) == S_IFREG,
        details.st_uid == getuid(),
        (details.st_mode & 0o777) == 0o600
  else { return nil }
  return details
}

func armWindowGuard(pid: pid_t) -> Bool {
  let ready = windowGuardPath(pid: pid, suffix: "ready")
  guard privateRegularFile(ready) != nil else { return false }
  let arm = windowGuardPath(pid: pid, suffix: "arm")
  let descriptor = open(
    arm,
    O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW,
    S_IRUSR | S_IWUSR
  )
  guard descriptor >= 0 else { return false }
  fchmod(descriptor, S_IRUSR | S_IWUSR)
  let value = "1\n\(Date().timeIntervalSince1970)\n"
  let bytes = Array(value.utf8)
  let wrote = bytes.withUnsafeBytes { pointer in
    write(descriptor, pointer.baseAddress, pointer.count) == pointer.count
  }
  let synced = fsync(descriptor) == 0
  close(descriptor)
  guard wrote && synced else {
    unlink(arm)
    return false
  }
  windowGuardArmPath = arm
  return true
}

func cleanupWindowGuard() {
  guard let path = windowGuardArmPath else { return }
  unlink(path)
  windowGuardArmPath = nil
}

func emit(_ payload: [String: Any]) -> Never {
  cleanupWindowGuard()
  let data = try? JSONSerialization.data(withJSONObject: payload)
  print(data.flatMap { String(data: $0, encoding: .utf8) } ?? "{\"ok\":false}")
  exit(0)
}

func fail(_ message: String, submitted: Bool = false) -> Never {
  emit([
    "ok": false,
    "error": message,
    "submitted": submitted,
    "diagnostic": diagnostic,
  ])
}

func succeed() -> Never { emit(["ok": true]) }

func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
  var value: CFTypeRef?
  return AXUIElementCopyAttributeValue(element, name, &value) == .success
    ? value
    : nil
}

func stringAttribute(_ element: AXUIElement, _ name: CFString) -> String {
  let value = attribute(element, name)
  if let text = value as? String { return text }
  if let text = value as? NSAttributedString { return text.string }
  return ""
}

func children(_ element: AXUIElement) -> [AXUIElement] {
  attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] ?? []
}

func attributeNames(_ element: AXUIElement) -> [String] {
  var names: CFArray?
  guard AXUIElementCopyAttributeNames(element, &names) == .success else {
    return []
  }
  return names as? [String] ?? []
}

func breadthFirst(_ roots: [AXUIElement], limit: Int = 4_000) -> [AXUIElement] {
  var queue = roots
  var index = 0
  while index < queue.count && index < limit {
    queue.append(contentsOf: children(queue[index]))
    index += 1
  }
  return Array(queue.prefix(limit))
}

func applicationWindows(_ application: AXUIElement) -> [AXUIElement] {
  attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement] ?? []
}

let fileTransferTitles = Set([
  "File Transfer",
  "File Transfer Assistant",
  "文件传输助手",
])

func chatTitleMatches(_ observed: String, requested: String) -> Bool {
  let observedTitle = observed
    .trimmingCharacters(in: .whitespacesAndNewlines)
    .split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
  let requestedTitle = requested.trimmingCharacters(in: .whitespacesAndNewlines)
  let compactObserved = observed
    .components(separatedBy: .whitespacesAndNewlines).joined().lowercased()
  let compactRequested = requested
    .components(separatedBy: .whitespacesAndNewlines).joined().lowercased()
  let observedIsFileTransfer = compactObserved.contains("filetransfer") ||
    compactObserved.contains("文件传输")
  let requestedIsFileTransfer = compactRequested.contains("filetransfer") ||
    compactRequested.contains("文件传输")
  return observedTitle == requestedTitle ||
    (fileTransferTitles.contains(observedTitle) &&
      fileTransferTitles.contains(requestedTitle)) ||
    (observedIsFileTransfer && requestedIsFileTransfer)
}

func currentChatTitle(_ application: AXUIElement) -> String {
  let labels = breadthFirst(applicationWindows(application), limit: 3_000).filter {
    stringAttribute($0, kAXIdentifierAttribute as CFString) ==
      "current_chat_name_label"
  }
  guard labels.count == 1 else { return "" }
  return stringAttribute(labels[0], kAXValueAttribute as CFString)
}

struct SelectedChat {
  let list: AXUIElement
  let original: [AXUIElement]
  let originalTitle: String
  let targetTitle: String
  let changed: Bool
}

struct ChatSnapshot {
  let list: AXUIElement
  let original: [AXUIElement]
  let originalTitle: String
}

func sessionList(_ application: AXUIElement) -> AXUIElement? {
  let lists = breadthFirst(applicationWindows(application), limit: 4_000).filter {
    stringAttribute($0, kAXIdentifierAttribute as CFString) == "session_list"
  }
  return lists.count == 1 ? lists[0] : nil
}

func candidateRows(_ list: AXUIElement) -> [AXUIElement] {
  children(list).flatMap { [$0] + breadthFirst(children($0), limit: 80) }
}

func rowMatches(_ row: AXUIElement, title: String, chatID: String?) -> Bool {
  let identifier = stringAttribute(row, kAXIdentifierAttribute as CFString)
  let identifierTitle = identifier.hasPrefix("session_item_")
    ? String(identifier.dropFirst("session_item_".count))
    : ""
  let rowTitle = stringAttribute(row, kAXTitleAttribute as CFString)
    .split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
  let rowValue = stringAttribute(row, kAXValueAttribute as CFString)
    .split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
  let rowDescription = stringAttribute(row, kAXDescriptionAttribute as CFString)
    .split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
  return identifier == "session_item_\(title)" ||
    (chatID.map { identifier == "session_item_\($0)" } ?? false) ||
    chatTitleMatches(identifierTitle, requested: title) ||
    chatTitleMatches(rowTitle, requested: title) ||
    chatTitleMatches(rowValue, requested: title) ||
    chatTitleMatches(rowDescription, requested: title)
}

func captureChat(_ application: AXUIElement) -> ChatSnapshot? {
  guard let list = sessionList(application) else { return nil }
  let originalTitle = currentChatTitle(application)
  var original = attribute(list, kAXSelectedChildrenAttribute as CFString)
    as? [AXUIElement] ?? []
  if original.isEmpty && !originalTitle.isEmpty {
    let matches = candidateRows(list).filter {
      rowMatches($0, title: originalTitle, chatID: nil)
    }
    if matches.count == 1 { original = matches }
  }
  return ChatSnapshot(list: list, original: original, originalTitle: originalTitle)
}

func selectChat(
  _ application: AXUIElement,
  title: String,
  sessionIndex: Int?,
  chatID: String?,
  snapshot: ChatSnapshot? = nil
) -> SelectedChat? {
  let controls = breadthFirst(applicationWindows(application), limit: 4_000)
  diagnostic["structural_identifiers"] = Array(Set(controls.compactMap {
    let identifier = stringAttribute($0, kAXIdentifierAttribute as CFString)
    let lowered = identifier.lowercased()
    return lowered.contains("search") || lowered.contains("input")
      ? identifier
      : nil
  })).sorted()
  diagnostic["window_text_areas"] = controls.filter {
    stringAttribute($0, kAXRoleAttribute as CFString) == kAXTextAreaRole
  }.count
  diagnostic["window_text_fields"] = controls.filter {
    stringAttribute($0, kAXRoleAttribute as CFString) == kAXTextFieldRole
  }.count
  let navigationControls: [[String: Any]] = controls.compactMap {
    element -> [String: Any]? in
    let title = stringAttribute(element, kAXTitleAttribute as CFString)
    let value = stringAttribute(element, kAXValueAttribute as CFString)
    let label = [title, value].first { $0 == "Chats" || $0 == "Contacts" }
    guard let label else { return nil }
    var actions: CFArray?
    AXUIElementCopyActionNames(element, &actions)
    return [
      "label": label,
      "role": stringAttribute(element, kAXRoleAttribute as CFString),
      "actions": actions as? [String] ?? [],
    ]
  }
  diagnostic["navigation_controls"] = navigationControls
  if fileTransferTitles.contains(title) {
    diagnostic["window_file_transfer_hits"] = controls.filter { element in
      [kAXTitleAttribute, kAXValueAttribute, kAXDescriptionAttribute].contains {
        chatTitleMatches(
          stringAttribute(element, $0 as CFString), requested: title
        )
      }
    }.count
  }
  let lists = controls.filter {
    stringAttribute($0, kAXIdentifierAttribute as CFString) == "session_list"
  }
  diagnostic["session_lists"] = lists.count
  guard lists.count == 1 else { return nil }
  let list = lists[0]
  let original = snapshot?.original ??
    (attribute(list, kAXSelectedChildrenAttribute as CFString) as? [AXUIElement] ?? [])
  let originalTitle = snapshot?.originalTitle ?? currentChatTitle(application)
  if !originalTitle.isEmpty && chatTitleMatches(originalTitle, requested: title) {
    return SelectedChat(
      list: list,
      original: original,
      originalTitle: originalTitle,
      targetTitle: originalTitle,
      changed: false
    )
  }

  let direct = children(list)
  diagnostic["session_direct_count"] = direct.count
  diagnostic["session_direct_roles"] = Array(Set(direct.map {
    stringAttribute($0, kAXRoleAttribute as CFString)
  })).sorted()
  if fileTransferTitles.contains(title) {
    let hits = direct.flatMap { element in
      attributeNames(element).compactMap { name -> String? in
        let value = stringAttribute(element, name as CFString)
        return fileTransferTitles.contains(value) ? name : nil
      }
    }
    diagnostic["file_transfer_attribute_hits"] = Array(Set(hits)).sorted()
  }
  let candidates = direct.flatMap { [$0] + breadthFirst(children($0), limit: 80) }
  var matches = candidates.filter {
    rowMatches($0, title: title, chatID: chatID)
  }
  if matches.isEmpty, let sessionIndex {
    var selectable: [AXUIElement] = []
    for candidate in candidates
    where attributeNames(candidate).contains(kAXSelectedAttribute) &&
          !selectable.contains(where: { CFEqual($0, candidate) }) {
      selectable.append(candidate)
    }
    diagnostic["session_selectable_rows"] = selectable.count
    if selectable.indices.contains(sessionIndex) {
      matches = [selectable[sessionIndex]]
      diagnostic["session_index_fallback"] = sessionIndex
    }
  }
  diagnostic["session_matches"] = matches.count
  guard matches.count == 1 else { return nil }
  var selected = AXUIElementSetAttributeValue(
    matches[0],
    kAXSelectedAttribute as CFString,
    kCFBooleanTrue
  )
  diagnostic["session_row_select"] = selected.rawValue
  if selected != .success {
    selected = AXUIElementSetAttributeValue(
      list,
      kAXSelectedChildrenAttribute as CFString,
      [matches[0]] as CFArray
    )
    diagnostic["session_list_select"] = selected.rawValue
  }
  if selected != .success {
    selected = AXUIElementPerformAction(matches[0], kAXPressAction as CFString)
    diagnostic["session_row_press"] = selected.rawValue
  }
  guard selected == .success else { return nil }
  let deadline = Date().addingTimeInterval(1.5)
  repeat {
    let current = currentChatTitle(application)
    if chatTitleMatches(current, requested: title) {
      return SelectedChat(
        list: list,
        original: original,
        originalTitle: originalTitle,
        targetTitle: current,
        changed: true
      )
    }
    Thread.sleep(forTimeInterval: 0.03)
  } while Date() < deadline
  let selectedRows = attribute(list, kAXSelectedChildrenAttribute as CFString)
    as? [AXUIElement] ?? []
  if selectedRows.contains(where: { CFEqual($0, matches[0]) }) &&
     composer(application) != nil {
    return SelectedChat(
      list: list,
      original: original,
      originalTitle: originalTitle,
      targetTitle: title,
      changed: true
    )
  }
  return nil
}

func restoreChat(_ selected: SelectedChat, application: AXUIElement) -> Bool {
  guard selected.changed else { return true }
  guard chatTitleMatches(
    currentChatTitle(application),
    requested: selected.targetTitle
  ) else {
    return true
  }
  guard !selected.original.isEmpty else { return true }
  let result = AXUIElementSetAttributeValue(
    selected.list,
    kAXSelectedChildrenAttribute as CFString,
    selected.original as CFArray
  )
  var restored = result
  diagnostic["session_restore"] = restored.rawValue
  if restored != .success, selected.original.count == 1 {
    restored = AXUIElementPerformAction(
      selected.original[0], kAXPressAction as CFString
    )
    diagnostic["session_restore_press"] = restored.rawValue
  }
  guard restored == .success else { return false }
  let deadline = Date().addingTimeInterval(1.5)
  if selected.originalTitle.isEmpty { return true }
  repeat {
    if currentChatTitle(application) == selected.originalTitle { return true }
    Thread.sleep(forTimeInterval: 0.03)
  } while Date() < deadline
  return false
}

func composer(_ application: AXUIElement) -> AXUIElement? {
  let matches = breadthFirst(applicationWindows(application), limit: 4_000).filter {
    stringAttribute($0, kAXIdentifierAttribute as CFString) == "chat_input_field"
  }
  diagnostic["composer_matches"] = matches.count
  return matches.count == 1 ? matches[0] : nil
}

func postKey(_ code: CGKeyCode, flags: CGEventFlags, pid: pid_t) -> Bool {
  guard let down = CGEvent(
          keyboardEventSource: nil,
          virtualKey: code,
          keyDown: true
        ),
        let up = CGEvent(
          keyboardEventSource: nil,
          virtualKey: code,
          keyDown: false
        )
  else { return false }
  down.flags = flags
  up.flags = flags
  down.postToPid(pid)
  up.postToPid(pid)
  return true
}

func sendInternalAttachmentEvents(
  to pid: pid_t,
  nativeTaskScript: String,
  primeLibrary: String
) -> [String: Any]? {
  let nonce = "\(getpid())-\(UInt64.random(in: 1...UInt64.max))"
  let statusURL = FileManager.default.temporaryDirectory
    .appendingPathComponent("polymux-wechat-prime-status-attachment-\(nonce).json")
  defer { try? FileManager.default.removeItem(at: statusURL) }
  let debugger = Process()
  debugger.executableURL = URL(fileURLWithPath: "/usr/bin/lldb")
  debugger.arguments = [
    "-p", String(pid),
    "-o", "command script import \"\(nativeTaskScript.replacingOccurrences(of: "\"", with: "\\\""))\"",
    "-o", "polymux-native-attachment-events",
    "-o", "process detach",
    "-o", "quit",
  ]
  var environment = ProcessInfo.processInfo.environment
  environment["POLYMUX_WECHAT_PRIME_DYLIB"] = primeLibrary
  environment["POLYMUX_WECHAT_PRIME_STATUS"] = statusURL.path
  debugger.environment = environment
  let output = Pipe()
  debugger.standardOutput = output
  debugger.standardError = output
  do {
    try debugger.run()
    debugger.waitUntilExit()
  } catch {
    return nil
  }
  guard debugger.terminationStatus == 0 else { return nil }
  let deadline = Date().addingTimeInterval(5)
  repeat {
    if let data = try? Data(contentsOf: statusURL),
       let result = try? JSONSerialization.jsonObject(with: data)
         as? [String: Any] {
      return result
    }
    Thread.sleep(forTimeInterval: 0.025)
  } while Date() < deadline
  return nil
}

func sendInternalKey(
  _ keyCode: Int,
  repeatCount: Int = 1,
  to pid: pid_t,
  nativeTaskScript: String,
  primeLibrary: String
) -> Bool {
  let nonce = "\(getpid())-\(UInt64.random(in: 1...UInt64.max))"
  let statusURL = FileManager.default.temporaryDirectory
    .appendingPathComponent("polymux-wechat-prime-status-key-\(nonce).json")
  defer { try? FileManager.default.removeItem(at: statusURL) }
  let debugger = Process()
  debugger.executableURL = URL(fileURLWithPath: "/usr/bin/lldb")
  debugger.arguments = [
    "-p", String(pid),
    "-o", "command script import \"\(nativeTaskScript.replacingOccurrences(of: "\"", with: "\\\""))\"",
    "-o", "polymux-native-key",
    "-o", "process detach",
    "-o", "quit",
  ]
  var environment = ProcessInfo.processInfo.environment
  environment["POLYMUX_WECHAT_PRIME_DYLIB"] = primeLibrary
  environment["POLYMUX_WECHAT_PRIME_STATUS"] = statusURL.path
  environment["POLYMUX_WECHAT_KEY_CODE"] = String(keyCode)
  environment["POLYMUX_WECHAT_KEY_FLAGS"] = "0"
  environment["POLYMUX_WECHAT_KEY_REPEAT"] = String(repeatCount)
  debugger.environment = environment
  let output = Pipe()
  debugger.standardOutput = output
  debugger.standardError = output
  do {
    try debugger.run()
    debugger.waitUntilExit()
  } catch {
    return false
  }
  guard debugger.terminationStatus == 0 else { return false }
  let deadline = Date().addingTimeInterval(3)
  repeat {
    if let data = try? Data(contentsOf: statusURL),
       let result = try? JSONSerialization.jsonObject(with: data)
         as? [String: Any] {
      return result["ok"] as? Bool == true
    }
    Thread.sleep(forTimeInterval: 0.025)
  } while Date() < deadline
  return false
}

func scrollInternalSessions(
  deltaY: Int,
  repeatCount: Int,
  in pid: pid_t,
  nativeTaskScript: String,
  primeLibrary: String
) -> Bool {
  let nonce = "\(getpid())-\(UInt64.random(in: 1...UInt64.max))"
  let statusURL = FileManager.default.temporaryDirectory
    .appendingPathComponent("polymux-wechat-prime-status-scroll-\(nonce).json")
  defer { try? FileManager.default.removeItem(at: statusURL) }
  let debugger = Process()
  debugger.executableURL = URL(fileURLWithPath: "/usr/bin/lldb")
  debugger.arguments = [
    "-p", String(pid),
    "-o", "command script import \"\(nativeTaskScript.replacingOccurrences(of: "\"", with: "\\\""))\"",
    "-o", "polymux-native-scroll",
    "-o", "process detach",
    "-o", "quit",
  ]
  var environment = ProcessInfo.processInfo.environment
  environment["POLYMUX_WECHAT_PRIME_DYLIB"] = primeLibrary
  environment["POLYMUX_WECHAT_PRIME_STATUS"] = statusURL.path
  environment["POLYMUX_WECHAT_SCROLL_DELTA"] = String(deltaY)
  environment["POLYMUX_WECHAT_KEY_REPEAT"] = String(repeatCount)
  debugger.environment = environment
  let output = Pipe()
  debugger.standardOutput = output
  debugger.standardError = output
  do {
    try debugger.run()
    debugger.waitUntilExit()
  } catch {
    return false
  }
  guard debugger.terminationStatus == 0 else { return false }
  let deadline = Date().addingTimeInterval(5)
  repeat {
    if let data = try? Data(contentsOf: statusURL),
       let result = try? JSONSerialization.jsonObject(with: data)
         as? [String: Any] {
      return result["ok"] as? Bool == true
    }
    Thread.sleep(forTimeInterval: 0.025)
  } while Date() < deadline
  return false
}

func snapshot(_ pasteboard: NSPasteboard) -> [SavedPasteboardItem] {
  (pasteboard.pasteboardItems ?? []).map { item in
    SavedPasteboardItem(values: item.types.compactMap { type in
      item.data(forType: type).map { (type, $0) }
    })
  }
}

func restore(_ saved: [SavedPasteboardItem], to pasteboard: NSPasteboard) {
  pasteboard.clearContents()
  let items = saved.map { savedItem -> NSPasteboardItem in
    let item = NSPasteboardItem()
    for (type, data) in savedItem.values { item.setData(data, forType: type) }
    return item
  }
  if !items.isEmpty { pasteboard.writeObjects(items) }
}

let arguments = CommandLine.arguments
guard arguments.count == 9 else {
  fail("usage: wechat-paste-send <wechat-pid> <absolute-path> <file|video> <chat-title> <session-index> <chat-id> <native-task-script> <prime-library>")
}
guard let pid = Int32(arguments[1]), pid > 1, kill(pid, 0) == 0 else {
  fail("WeChat process is not running")
}
let filePath = arguments[2]
guard filePath.hasPrefix("/"), FileManager.default.fileExists(atPath: filePath) else {
  fail("the attachment path must be an existing absolute path")
}
let mode = arguments[3]
guard mode == "file" || mode == "video" || mode == "probe" ||
      mode == "signin" || mode == "searchprobe" || mode == "listprobe" else {
  fail("the attachment mode must be file, video, probe, signin, searchprobe, or listprobe")
}
let targetTitle = arguments[4]
let sessionIndex = Int(arguments[5])
let chatID = arguments[6]
let nativeTaskScript = arguments[7]
let primeLibrary = arguments[8]
guard !targetTitle.isEmpty,
      !targetTitle.contains("\0"),
      targetTitle.utf8.count <= 256,
      sessionIndex != nil,
      !chatID.contains("\0"),
      chatID.utf8.count <= 256,
      nativeTaskScript.hasPrefix("/"),
      primeLibrary.hasPrefix("/"),
      FileManager.default.fileExists(atPath: nativeTaskScript),
      FileManager.default.fileExists(atPath: primeLibrary)
else { fail("the target chat is invalid") }

let frontmostBefore = NSWorkspace.shared.frontmostApplication?.processIdentifier
let backgroundSend = frontmostBefore != pid
if backgroundSend && !armWindowGuard(pid: pid) {
  fail("the WeChat background window guard is unavailable")
}

let application = AXUIElementCreateApplication(pid)
AXUIElementSetAttributeValue(
  application, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue
)
AXUIElementSetAttributeValue(
  application, "AXManualAccessibility" as CFString, kCFBooleanTrue
)
Thread.sleep(forTimeInterval: 0.15)
if mode == "signin" {
  let loginTitles = Set(["Open WeChat", "打开微信", "開啟微信"])
  let buttons = breadthFirst(applicationWindows(application), limit: 2_000).filter {
    stringAttribute($0, kAXRoleAttribute as CFString) == kAXButtonRole &&
      loginTitles.contains(stringAttribute($0, kAXTitleAttribute as CFString))
  }
  diagnostic["signin_buttons"] = buttons.count
  guard buttons.count == 1 else { fail("the remembered WeChat account is unavailable") }
  let focused = AXUIElementSetAttributeValue(
    buttons[0], kAXFocusedAttribute as CFString, kCFBooleanTrue
  )
  diagnostic["signin_focus"] = focused.rawValue
  guard focused == .success, postKey(36, flags: [], pid: pid) else {
    fail("the remembered WeChat account could not be opened")
  }
  Thread.sleep(forTimeInterval: 0.3)
  guard NSWorkspace.shared.frontmostApplication?.processIdentifier == frontmostBefore else {
    fail("WeChat took focus while opening the remembered account")
  }
  emit(["ok": true, "diagnostic": diagnostic])
}
if mode == "searchprobe" {
  guard postKey(3, flags: [.maskCommand], pid: pid) else {
    fail("WeChat search could not be opened")
  }
  Thread.sleep(forTimeInterval: 0.5)
  let controls = breadthFirst(applicationWindows(application), limit: 4_000)
  diagnostic["search_text_fields"] = controls.filter {
    stringAttribute($0, kAXRoleAttribute as CFString) == kAXTextFieldRole
  }.count
  diagnostic["search_structural_identifiers"] = Array(Set(controls.compactMap {
    let identifier = stringAttribute($0, kAXIdentifierAttribute as CFString)
    return identifier.lowercased().contains("search") ? identifier : nil
  })).sorted()
  guard NSWorkspace.shared.frontmostApplication?.processIdentifier == frontmostBefore else {
    fail("WeChat took focus while opening search")
  }
  emit(["ok": true, "diagnostic": diagnostic])
}
if mode == "listprobe" {
  let controls = breadthFirst(applicationWindows(application), limit: 4_000)
  let chatLists = controls.filter {
    stringAttribute($0, kAXRoleAttribute as CFString) == kAXListRole &&
      [
        stringAttribute($0, kAXTitleAttribute as CFString),
        stringAttribute($0, kAXValueAttribute as CFString),
      ].contains("Chats")
  }
  diagnostic["chat_navigation_lists"] = chatLists.count
  guard chatLists.count == 1, let sessionIndex, sessionIndex >= 0 else {
    fail("the WeChat chat list is unavailable")
  }
  let focused = AXUIElementSetAttributeValue(
    chatLists[0], kAXFocusedAttribute as CFString, kCFBooleanTrue
  )
  diagnostic["chat_navigation_focus"] = focused.rawValue
  guard focused == .success, postKey(115, flags: [], pid: pid) else {
    fail("the WeChat chat list could not be focused")
  }
  for _ in 0..<sessionIndex {
    guard postKey(125, flags: [], pid: pid) else {
      fail("the WeChat target chat could not be reached")
    }
  }
  guard postKey(36, flags: [], pid: pid) else {
    fail("the WeChat target chat could not be opened")
  }
  Thread.sleep(forTimeInterval: 1)
  let updated = breadthFirst(applicationWindows(application), limit: 4_000)
  let titleMatches = updated.filter { element in
    [kAXTitleAttribute, kAXValueAttribute, kAXDescriptionAttribute].contains {
      chatTitleMatches(stringAttribute(element, $0 as CFString), requested: targetTitle)
    }
  }.count
  let textAreas = updated.filter {
    stringAttribute($0, kAXRoleAttribute as CFString) == kAXTextAreaRole
  }.count
  diagnostic["selected_title_matches"] = titleMatches
  diagnostic["selected_text_areas"] = textAreas
  guard NSWorkspace.shared.frontmostApplication?.processIdentifier == frontmostBefore else {
    fail("WeChat took focus while selecting the target chat")
  }
  emit(["ok": titleMatches > 0 && textAreas == 1, "diagnostic": diagnostic])
}
let originalChat = captureChat(application)
var selected = selectChat(
  application,
  title: targetTitle,
  sessionIndex: sessionIndex.flatMap { $0 >= 0 ? $0 : nil },
  chatID: chatID,
  snapshot: originalChat
)
if selected == nil, chatID == "filehelper", let list = sessionList(application) {
  let focused = AXUIElementSetAttributeValue(
    list, kAXFocusedAttribute as CFString, kCFBooleanTrue
  )
  diagnostic["session_list_focus"] = focused.rawValue
  if focused == .success,
     scrollInternalSessions(
       deltaY: 120,
       repeatCount: 32,
       in: pid,
       nativeTaskScript: nativeTaskScript,
       primeLibrary: primeLibrary
     ) {
    Thread.sleep(forTimeInterval: 0.5)
    selected = selectChat(
      application,
      title: targetTitle,
      sessionIndex: sessionIndex.flatMap { $0 >= 0 ? $0 : nil },
      chatID: chatID,
      snapshot: originalChat
    )
  }
}
guard let selected else { fail("the exact target chat could not be selected") }
guard !backgroundSend ||
        NSWorkspace.shared.frontmostApplication?.processIdentifier == frontmostBefore
else {
  _ = restoreChat(selected, application: application)
  fail("WeChat took focus before the attachment was submitted")
}
if mode == "probe" {
  let restored = restoreChat(selected, application: application)
  emit(["ok": restored, "diagnostic": diagnostic])
}
guard let input = composer(application) else {
  _ = restoreChat(selected, application: application)
  fail("the exact target composer could not be focused")
}
let focused = AXUIElementSetAttributeValue(
  input,
  kAXFocusedAttribute as CFString,
  kCFBooleanTrue
)
diagnostic["composer_focus"] = focused.rawValue
guard focused == .success else {
  _ = restoreChat(selected, application: application)
  fail("the exact target composer could not be focused")
}

let savedDraft = stringAttribute(input, kAXValueAttribute as CFString)
if !savedDraft.isEmpty {
  let cleared = AXUIElementSetAttributeValue(
    input,
    kAXValueAttribute as CFString,
    "" as CFString
  )
  diagnostic["draft_clear"] = cleared.rawValue
  guard cleared == .success else {
    _ = restoreChat(selected, application: application)
    fail("the target composer draft could not be preserved")
  }
}

func restoreDraft() -> Bool {
  guard !savedDraft.isEmpty else { return true }
  let result = AXUIElementSetAttributeValue(
    input,
    kAXValueAttribute as CFString,
    savedDraft as CFString
  )
  diagnostic["draft_restore"] = result.rawValue
  return result == .success
}

let pasteboard = NSPasteboard.general
let savedPasteboard = snapshot(pasteboard)
pasteboard.clearContents()
let wrote: Bool
if mode == "video" {
  let item = NSPasteboardItem()
  let url = URL(fileURLWithPath: filePath)
  let videoType = NSPasteboard.PasteboardType("public.mpeg-4")
  let fileURLType = NSPasteboard.PasteboardType("public.file-url")
  if let video = try? Data(contentsOf: url),
     let fileURL = url.absoluteString.data(using: .utf8) {
    item.setData(video, forType: videoType)
    item.setData(fileURL, forType: fileURLType)
    wrote = pasteboard.writeObjects([item])
  } else {
    wrote = false
  }
} else {
  wrote = pasteboard.writeObjects([NSURL(fileURLWithPath: filePath)])
}
guard wrote else {
  restore(savedPasteboard, to: pasteboard)
  _ = restoreDraft()
  _ = restoreChat(selected, application: application)
  fail("the attachment could not be placed on the pasteboard")
}
let ownedChangeCount = pasteboard.changeCount

guard let eventResult = sendInternalAttachmentEvents(
  to: pid,
  nativeTaskScript: nativeTaskScript,
  primeLibrary: primeLibrary
) else {
  if pasteboard.changeCount == ownedChangeCount {
    restore(savedPasteboard, to: pasteboard)
  }
  _ = restoreDraft()
  _ = restoreChat(selected, application: application)
  fail("the internal WeChat attachment sender was unavailable")
}
let submitted = eventResult["submitted"] as? Bool == true
guard eventResult["ok"] as? Bool == true else {
  if pasteboard.changeCount == ownedChangeCount {
    restore(savedPasteboard, to: pasteboard)
  }
  _ = restoreDraft()
  _ = restoreChat(selected, application: application)
  fail(
    eventResult["reason"] as? String ?? "WeChat did not submit the attachment",
    submitted: submitted
  )
}
if pasteboard.changeCount == ownedChangeCount {
  restore(savedPasteboard, to: pasteboard)
}
guard restoreDraft() else {
  _ = restoreChat(selected, application: application)
  fail("the attachment was submitted, but the target draft could not be restored", submitted: true)
}
guard restoreChat(selected, application: application) else {
  fail("the attachment was submitted, but the prior chat could not be restored", submitted: true)
}
guard !backgroundSend ||
        NSWorkspace.shared.frontmostApplication?.processIdentifier == frontmostBefore
else { fail("the attachment was submitted, but WeChat took focus", submitted: true) }
succeed()
