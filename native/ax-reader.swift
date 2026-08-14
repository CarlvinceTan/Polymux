// Chronicle's accessibility capture helper.
//
// Prints one JSON object describing the frontmost application's focused
// window: app name, bundle id, window title, and the visible text collected
// from the window's accessibility tree. Reading through the Accessibility API
// touches no pixels, so macOS shows no screen-recording indicator — this is
// the same mechanism ChatGPT desktop's "Work with Apps" uses.
//
// Usage: ax-reader [--skip-pid <pid>]
//   --skip-pid  Report {"skipped":"self"} when the frontmost app has this
//               process identifier (the host app avoids capturing itself).
//
// Compiled on demand by src/main/ax-reader.ts with `swiftc`.

import AppKit
import ApplicationServices
import Foundation

struct Snapshot: Codable {
  var trusted: Bool
  var skipped: String?
  var app: String?
  var bundleId: String?
  var pid: Int32?
  var title: String?
  var text: String?
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
  print("{\"trusted\":true,\"skipped\":\"timeout\"}")
  exit(0)
}

var skipPid: Int32? = nil
var targetPid: Int32? = nil
var arguments = CommandLine.arguments.dropFirst().makeIterator()
while let argument = arguments.next() {
  if argument == "--skip-pid", let value = arguments.next() { skipPid = Int32(value) }
  // Debug aid: read a specific app instead of the frontmost one.
  if argument == "--pid", let value = arguments.next() { targetPid = Int32(value) }
}

guard AXIsProcessTrusted() else { emit(Snapshot(trusted: false)) }
guard let frontmost = targetPid.flatMap({ NSRunningApplication(processIdentifier: $0) })
  ?? NSWorkspace.shared.frontmostApplication else {
  emit(Snapshot(trusted: true, skipped: "no-frontmost"))
}
if let skip = skipPid, frontmost.processIdentifier == skip {
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

emit(Snapshot(
  trusted: true,
  app: frontmost.localizedName,
  bundleId: frontmost.bundleIdentifier,
  pid: frontmost.processIdentifier,
  title: window.flatMap { stringAttribute($0, kAXTitleAttribute) },
  text: collected.joined(separator: "\n")
))
