// ComputerHistory's interaction stream.
//
// A frame says what was on screen; this says what the user did to it. The
// helper runs for as long as ComputerHistory does and prints one JSON object per
// line to stdout: app switches, clicks, keyboard chords, typing bursts and
// scrolls, each stamped with the app, window title and page URL it happened
// in.
//
// Keystroke content is never recorded. A chord is named ("cmd+s") because the
// chord is the action; an ordinary key is only counted, so a typing burst
// reports that thirty keys went into a search field and never which thirty.
// There is deliberately no path through this file that emits a character.
//
// Usage: ax-events [--skip-pid <pid>]
//   --skip-pid  Ignore events belonging to this process (the host app does
//               not record itself).
//
// Requires Accessibility permission, which the event tap and the element
// lookups both need. Compiled on demand by src/main/agent/interaction-events.ts.

import AppKit
import ApplicationServices
import Foundation

let skipPid: pid_t = {
  guard let index = CommandLine.arguments.firstIndex(of: "--skip-pid"),
        index + 1 < CommandLine.arguments.count,
        let value = Int32(CommandLine.arguments[index + 1]) else { return -1 }
  return value
}()

// ComputerHistory's own cadence is seconds; a stream faster than this is noise that
// costs disk and tells the reader nothing new.
let maximumEventsPerSecond = 12
let typingIdleFlush = 1.2

let iso: ISO8601DateFormatter = {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter
}()

struct Event: Codable {
  var at: String
  var kind: String
  var app: String
  var bundleId: String?
  var title: String?
  var url: String?
  var target: String?
  var chord: String?
  var count: Int?
}

// MARK: - Emission

let out = FileHandle.standardOutput
var emittedThisSecond = 0
var currentSecond = 0.0

func emit(_ event: Event) {
  let second = floor(Date().timeIntervalSince1970)
  if second != currentSecond {
    currentSecond = second
    emittedThisSecond = 0
  }
  emittedThisSecond += 1
  if emittedThisSecond > maximumEventsPerSecond { return }
  guard let data = try? JSONEncoder().encode(event) else { return }
  out.write(data)
  out.write("\n".data(using: .utf8)!)
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
  exit(1)
}

// MARK: - Accessibility lookups

func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success
  else { return nil }
  if let text = value as? String { return text.isEmpty ? nil : text }
  if let url = value as? NSURL { return url.absoluteString }
  return nil
}

func children(_ element: AXUIElement) -> [AXUIElement] {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
        let items = value as? [AXUIElement] else { return [] }
  return items
}

/// The page URL of a browser window: browsers publish it on the window itself
/// or on the web area inside it, so both are tried before giving up. A native
/// app simply has none, which is the honest answer for it.
func windowURL(_ window: AXUIElement) -> String? {
  if let direct = stringAttribute(window, "AXURL") { return direct }
  var frontier = children(window)
  var visited = 0
  while let element = frontier.first {
    frontier.removeFirst()
    visited += 1
    if visited > 400 { return nil }
    if let url = stringAttribute(element, "AXURL") { return url }
    if stringAttribute(element, kAXRoleAttribute as String) == "AXWebArea" { return nil }
    frontier.append(contentsOf: children(element))
  }
  return nil
}

/// Whether the window is a private-browsing one.
///
/// macOS exposes no accessibility flag for this, so the only signal available
/// is the marker browsers put in the window title. That is title text, which
/// is localized, so this recognises the common English and near-English forms
/// and nothing more: a private window in a localized browser will read as an
/// ordinary one. The setting it feeds is therefore best-effort, and says so in
/// the UI rather than promising an exclusion it cannot always make.
func looksPrivate(title: String?, bundleId: String?) -> Bool {
  guard let title = title?.lowercased() else { return false }
  return title.contains("(incognito)")
    || title.contains("(inprivate)")
    || title.contains("private browsing")
    || title.contains("(private)")
}

struct Context {
  var app: String
  var bundleId: String?
  var pid: pid_t
  var title: String?
  var url: String?
  var isPrivate: Bool
}

// Resolving a window costs several AX round trips, and a click storm would pay
// it per click. The reading is reused until the frontmost app or window title
// changes, which is exactly when it stops being true.
var cachedContext: Context?
var cachedAt = 0.0

func context() -> Context? {
  guard let front = NSWorkspace.shared.frontmostApplication,
        front.processIdentifier != skipPid,
        let name = front.localizedName else { return nil }
  let now = Date().timeIntervalSince1970
  if let cached = cachedContext, cached.pid == front.processIdentifier, now - cachedAt < 1.5 {
    return cached
  }
  let application = AXUIElementCreateApplication(front.processIdentifier)
  var value: CFTypeRef?
  var window: AXUIElement?
  if AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute as CFString, &value)
      == .success, let found = value as! AXUIElement? {
    window = found
  }
  let title = window.flatMap { stringAttribute($0, kAXTitleAttribute as String) }
  let resolved = Context(
    app: name,
    bundleId: front.bundleIdentifier,
    pid: front.processIdentifier,
    title: title,
    url: window.flatMap { windowURL($0) },
    isPrivate: looksPrivate(title: title, bundleId: front.bundleIdentifier)
  )
  cachedContext = resolved
  cachedAt = now
  return resolved
}

/// A short human name for the control at a screen point — "Send button",
/// "Search text field". Never its value: a text field's contents are the very
/// thing this stream does not carry.
func describeElement(at point: CGPoint) -> String? {
  let system = AXUIElementCreateSystemWide()
  var element: AXUIElement?
  guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &element)
          == .success, let element else { return nil }
  let role = stringAttribute(element, kAXRoleAttribute as String)
  let label = stringAttribute(element, kAXTitleAttribute as String)
    ?? stringAttribute(element, kAXDescriptionAttribute as String)
    ?? stringAttribute(element, "AXPlaceholderValue")
  let readableRole = role.map { $0.replacingOccurrences(of: "AX", with: "") }
  switch (label, readableRole) {
  case let (label?, role?): return "\(label) \(role.lowercased())"
  case let (label?, nil): return label
  case let (nil, role?): return role.lowercased()
  default: return nil
  }
}

func event(_ kind: String, _ context: Context) -> Event {
  Event(
    at: iso.string(from: Date()),
    kind: kind,
    app: context.app,
    bundleId: context.bundleId,
    title: context.title,
    url: context.url,
    target: nil,
    chord: nil,
    count: nil
  )
}

// MARK: - Typing bursts

var typingCount = 0
var typingTarget: String?
var typingContext: Context?
var typingLastAt = 0.0

func flushTyping() {
  guard typingCount > 0, let context = typingContext else {
    typingCount = 0
    return
  }
  var payload = event("type", context)
  payload.count = typingCount
  payload.target = typingTarget
  emit(payload)
  typingCount = 0
  typingTarget = nil
  typingContext = nil
}

/// The focused control's name, for attributing a typing burst to a field.
func focusedTarget(_ context: Context) -> String? {
  let application = AXUIElementCreateApplication(context.pid)
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute as CFString, &value)
          == .success, let element = value as! AXUIElement? else { return nil }
  let role = stringAttribute(element, kAXRoleAttribute as String)?
    .replacingOccurrences(of: "AX", with: "").lowercased()
  let label = stringAttribute(element, kAXTitleAttribute as String)
    ?? stringAttribute(element, kAXDescriptionAttribute as String)
    ?? stringAttribute(element, "AXPlaceholderValue")
  return [label, role].compactMap { $0 }.joined(separator: " ").isEmpty
    ? nil
    : [label, role].compactMap { $0 }.joined(separator: " ")
}

// MARK: - Scroll coalescing

var scrollContextPid: pid_t = -1
var scrollLastAt = 0.0

// MARK: - Chords

let namedKeys: [Int64: String] = [
  36: "return", 48: "tab", 49: "space", 51: "delete", 53: "escape",
  123: "left", 124: "right", 125: "down", 126: "up",
  122: "f1", 120: "f2", 99: "f3", 118: "f4", 96: "f5", 97: "f6",
]

func chord(flags: CGEventFlags, keyCode: Int64) -> String? {
  var parts: [String] = []
  if flags.contains(.maskCommand) { parts.append("cmd") }
  if flags.contains(.maskControl) { parts.append("ctrl") }
  if flags.contains(.maskAlternate) { parts.append("opt") }
  if flags.contains(.maskShift) { parts.append("shift") }
  guard !parts.isEmpty else { return nil }
  // Only the chord's own key is named, and only from a fixed table of
  // non-character keys plus the letter/digit the layout maps — a chord is an
  // action ("cmd+s" is a save), not text the user wrote.
  if let named = namedKeys[keyCode] {
    parts.append(named)
  } else if let key = character(for: keyCode) {
    parts.append(key)
  } else {
    parts.append("key\(keyCode)")
  }
  return parts.joined(separator: "+")
}

func character(for keyCode: Int64) -> String? {
  let letters: [Int64: String] = [
    0: "a", 11: "b", 8: "c", 2: "d", 14: "e", 3: "f", 5: "g", 4: "h", 34: "i",
    38: "j", 40: "k", 37: "l", 46: "m", 45: "n", 31: "o", 35: "p", 12: "q",
    15: "r", 1: "s", 17: "t", 32: "u", 9: "v", 13: "w", 7: "x", 16: "y", 6: "z",
    29: "0", 18: "1", 19: "2", 20: "3", 21: "4", 23: "5", 22: "6", 26: "7",
    28: "8", 25: "9", 27: "-", 24: "=", 33: "[", 30: "]", 41: ";", 39: "'",
    43: ",", 47: ".", 44: "/",
  ]
  return letters[keyCode]
}

// MARK: - Tap

let tapCallback: CGEventTapCallBack = { _, type, cgEvent, _ in
  // A disabled tap is silent rather than noisy, so re-arm rather than exit.
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
    return Unmanaged.passUnretained(cgEvent)
  }
  guard let current = context() else { return Unmanaged.passUnretained(cgEvent) }
  let now = Date().timeIntervalSince1970
  switch type {
  case .leftMouseDown, .rightMouseDown:
    flushTyping()
    var payload = event("click", current)
    payload.target = describeElement(at: cgEvent.location)
    emit(payload)
  case .scrollWheel:
    if current.pid != scrollContextPid || now - scrollLastAt > 2 {
      scrollContextPid = current.pid
      scrollLastAt = now
      emit(event("scroll", current))
    }
  case .keyDown:
    let flags = cgEvent.flags
    let keyCode = cgEvent.getIntegerValueField(.keyboardEventKeycode)
    if let named = chord(flags: flags, keyCode: keyCode) {
      flushTyping()
      var payload = event("shortcut", current)
      payload.chord = named
      emit(payload)
    } else {
      if typingContext?.pid != current.pid { flushTyping() }
      if typingCount == 0 {
        typingContext = current
        typingTarget = focusedTarget(current)
      }
      typingCount += 1
      typingLastAt = now
    }
  default:
    break
  }
  return Unmanaged.passUnretained(cgEvent)
}

var eventTap: CFMachPort?

guard AXIsProcessTrusted() else {
  fail("Accessibility access is off.")
}

let mask =
  (1 << CGEventType.leftMouseDown.rawValue) |
  (1 << CGEventType.rightMouseDown.rawValue) |
  (1 << CGEventType.scrollWheel.rawValue) |
  (1 << CGEventType.keyDown.rawValue)

guard let tap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .tailAppendEventTap,
  // Listen-only: the helper must never be able to swallow or alter an event
  // the user meant for the app in front of them.
  options: .listenOnly,
  eventsOfInterest: CGEventMask(mask),
  callback: tapCallback,
  userInfo: nil
) else {
  fail("Could not create the event tap. Accessibility access may have been revoked.")
}
eventTap = tap

let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

// App switches come from the workspace rather than the tap: activating an app
// with the Dock or a gesture produces no event the tap would see.
NSWorkspace.shared.notificationCenter.addObserver(
  forName: NSWorkspace.didActivateApplicationNotification,
  object: nil,
  queue: .main
) { _ in
  flushTyping()
  cachedContext = nil
  guard let current = context() else { return }
  emit(event("app", current))
}

// A burst ends when the typing stops, so something has to notice the silence.
Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
  if typingCount > 0, Date().timeIntervalSince1970 - typingLastAt >= typingIdleFlush {
    flushTyping()
  }
}

// The parent kills this process on shutdown; exiting when stdout closes is the
// backstop that stops an orphan tapping events forever.
out.writeabilityHandler = nil
CFRunLoopRun()
