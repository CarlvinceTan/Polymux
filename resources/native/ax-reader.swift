// ComputerHistory's accessibility capture helper.
//
// Prints one JSON object describing the frontmost application's focused
// window: app name, bundle id, window title, and the visible text collected
// from the window's accessibility tree. Reading through the Accessibility API
// touches no pixels, so macOS shows no screen-recording indicator — this is
// the same mechanism ChatGPT desktop's "Work with Apps" uses.
//
// Usage: ax-reader [--skip-pid <pid>] [--windows]
//   --skip-pid  Report {"skipped":"self"} when the frontmost app has this
//               process identifier (the host app avoids capturing itself).
//   --windows   Instead of reading one window's text, list the titled windows
//               of every ordinary running application — the ambient "what is
//               open" context, with no page text in it.
//
// Compiled on demand by src/main/ax-reader.ts with `swiftc`.

import AppKit
import ApplicationServices
import Foundation

struct OpenWindow: Codable {
  var app: String
  var bundleId: String?
  var pid: Int32
  var title: String
  var frontmost: Bool
}

struct WindowList: Codable {
  var trusted: Bool
  var windows: [OpenWindow]
}

struct Snapshot: Codable {
  var trusted: Bool
  var skipped: String?
  var app: String?
  var bundleId: String?
  var pid: Int32?
  var title: String?
  var text: String?
  /// Page URL when the window is a browser's, so the capture policy can judge
  /// a site rather than only the app hosting it.
  var url: String?
  /// Best-effort private-browsing marker; see `looksPrivate`.
  var isPrivate: Bool?
}

func emit(_ snapshot: Snapshot) -> Never {
  if let data = try? JSONEncoder().encode(snapshot),
     let json = String(data: data, encoding: .utf8) {
    print(json)
  } else {
    print("{\"trusted\":false}")
  }
  exit(0)
}

// A stuck accessibility query in one app must not wedge the whole capture
// loop; the parent enforces its own timeout, and this is the local backstop.
DispatchQueue.global().asyncAfter(deadline: .now() + 4) {
  print(CommandLine.arguments.contains("--windows")
    ? "{\"trusted\":true,\"windows\":[]}"
    : "{\"trusted\":true,\"skipped\":\"timeout\"}")
  exit(0)
}

var listWindows = false
var skipPid: Int32? = nil
var targetPid: Int32? = nil
var arguments = CommandLine.arguments.dropFirst().makeIterator()
while let argument = arguments.next() {
  if argument == "--skip-pid", let value = arguments.next() { skipPid = Int32(value) }
  // Debug aid: read a specific app instead of the frontmost one.
  if argument == "--pid", let value = arguments.next() { targetPid = Int32(value) }
  if argument == "--windows" { listWindows = true }
}

func emitWindows(_ list: WindowList) -> Never {
  if let data = try? JSONEncoder().encode(list), let json = String(data: data, encoding: .utf8) {
    print(json)
  } else {
    print("{\"trusted\":false,\"windows\":[]}")
  }
  exit(0)
}

guard AXIsProcessTrusted() else {
  if listWindows { emitWindows(WindowList(trusted: false, windows: [])) }
  emit(Snapshot(trusted: false))
}
let frontmostApplication = NSWorkspace.shared.frontmostApplication
guard let frontmost = targetPid.flatMap({ NSRunningApplication(processIdentifier: $0) })
  ?? frontmostApplication else {
  if listWindows { emitWindows(WindowList(trusted: true, windows: [])) }
  emit(Snapshot(trusted: true, skipped: "no-frontmost"))
}
if !listWindows, let skip = skipPid, frontmost.processIdentifier == skip {
  emit(Snapshot(trusted: true, skipped: "self"))
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
  return value
}

func elementAttribute(_ element: AXUIElement, _ name: String) -> AXUIElement? {
  guard let value = attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
  return (value as! AXUIElement)
}

func childElements(_ element: AXUIElement) -> [AXUIElement] {
  guard let value = attribute(element, kAXChildrenAttribute), CFGetTypeID(value) == CFArrayGetTypeID() else { return [] }
  let array = value as! CFArray as [AnyObject]
  return array.compactMap { item in
    guard CFGetTypeID(item) == AXUIElementGetTypeID() else { return nil }
    return (item as! AXUIElement)
  }
}

func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
  attribute(element, name) as? String
}

func firstWindow(_ application: AXUIElement) -> AXUIElement? {
  if let focused = elementAttribute(application, kAXFocusedWindowAttribute) { return focused }
  if let main = elementAttribute(application, kAXMainWindowAttribute) { return main }
  guard let value = attribute(application, kAXWindowsAttribute), CFGetTypeID(value) == CFArrayGetTypeID() else { return nil }
  for item in value as! CFArray as [AnyObject] where CFGetTypeID(item) == AXUIElementGetTypeID() {
    return (item as! AXUIElement)
  }
  return nil
}

// `--windows` answers here: titles only, every ordinary app, no tree walk.
if listWindows {
  var windows: [OpenWindow] = []
  for running in NSWorkspace.shared.runningApplications
  where running.activationPolicy == .regular && running.processIdentifier != skipPid {
    let element = AXUIElementCreateApplication(running.processIdentifier)
    guard let value = attribute(element, kAXWindowsAttribute),
          CFGetTypeID(value) == CFArrayGetTypeID() else { continue }
    let isFront = running.processIdentifier == frontmostApplication?.processIdentifier
    let focused = elementAttribute(element, kAXFocusedWindowAttribute)
    for item in value as! CFArray as [AnyObject] where CFGetTypeID(item) == AXUIElementGetTypeID() {
      let candidate = (item as! AXUIElement)
      guard let title = stringAttribute(candidate, kAXTitleAttribute)?
        .trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else { continue }
      windows.append(OpenWindow(
        app: running.localizedName ?? "Unknown",
        bundleId: running.bundleIdentifier,
        pid: running.processIdentifier,
        title: String(title.prefix(200)),
        // The frontmost app's focused window is the one the user is in.
        frontmost: isFront && focused.map { CFEqual($0, candidate) } == true
      ))
      if windows.count >= 100 { emitWindows(WindowList(trusted: true, windows: windows)) }
    }
  }
  emitWindows(WindowList(trusted: true, windows: windows))
}

let application = AXUIElementCreateApplication(frontmost.processIdentifier)
var window = firstWindow(application)

var collected: [String] = []
var seen = Set<String>()
var budget = 60_000
var visited = 0

// Roles whose value/title is presentation chrome rather than content.
let skippedRoles: Set<String> = [kAXMenuBarRole, kAXMenuBarItemRole, kAXScrollBarRole]

func collect(_ element: AXUIElement, depth: Int) {
  if budget <= 0 || visited >= 4_000 || depth > 24 { return }
  visited += 1
  let role = stringAttribute(element, kAXRoleAttribute) ?? ""
  if skippedRoles.contains(role) { return }
  let piece = (attribute(element, kAXValueAttribute) as? String)
    ?? stringAttribute(element, kAXTitleAttribute)
  if let piece {
    let text = piece.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.count > 1, !seen.contains(text) {
      seen.insert(text)
      let clipped = String(text.prefix(budget))
      collected.append(clipped)
      budget -= clipped.count + 1
    }
  }
  if budget <= 0 { return }
  for child in childElements(element) {
    collect(child, depth: depth + 1)
    if budget <= 0 || visited >= 4_000 { return }
  }
}

if let window { collect(window, depth: 0) }

// Chromium and Electron apps publish an almost empty tree until an assistive
// client announces itself; these attributes are that announcement. The tree
// builds asynchronously, so give it a moment and walk again.
if collected.joined(separator: "\n").count < 160 {
  AXUIElementSetAttributeValue(application, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
  AXUIElementSetAttributeValue(application, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  Thread.sleep(forTimeInterval: 0.9)
  collected = []
  seen = []
  budget = 60_000
  visited = 0
  window = firstWindow(application)
  if let window { collect(window, depth: 0) }
}

let windowTitle = window.flatMap { stringAttribute($0, kAXTitleAttribute) }

/// The page URL of a browser window. Browsers publish it on the window or on
/// the web area inside it; a native app has none, which is the honest answer.
func windowURL(_ element: AXUIElement) -> String? {
  if let direct = stringAttribute(element, "AXURL") { return direct }
  var frontier = childElements(element)
  var visited = 0
  while let candidate = frontier.first {
    frontier.removeFirst()
    visited += 1
    if visited > 400 { return nil }
    if let url = stringAttribute(candidate, "AXURL") { return url }
    frontier.append(contentsOf: childElements(candidate))
  }
  return nil
}

/// macOS exposes no accessibility flag for private browsing, so the only
/// available signal is the marker the browser puts in the window title. That
/// is localized text, so this recognises the common English forms and nothing
/// more — the setting it feeds is best-effort and the UI says so.
func looksPrivate(_ title: String?) -> Bool {
  guard let title = title?.lowercased() else { return false }
  return title.contains("(incognito)")
    || title.contains("(inprivate)")
    || title.contains("private browsing")
    || title.contains("(private)")
}

emit(Snapshot(
  trusted: true,
  app: frontmost.localizedName,
  bundleId: frontmost.bundleIdentifier,
  pid: frontmost.processIdentifier,
  title: windowTitle,
  text: collected.joined(separator: "\n"),
  url: window.flatMap { windowURL($0) },
  isPrivate: looksPrivate(windowTitle)
))
