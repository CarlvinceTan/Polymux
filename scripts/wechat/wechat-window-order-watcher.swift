// Watch for WeChat windows surfacing above the app that was frontmost when
// the watcher started. Window titles are deliberately never read or emitted.
//
// Usage: wechat-window-order-watcher <wechat-pid|auto> <duration-seconds>

// This helper is test-only. It does not activate, hide, move, or inspect the
// accessibility contents of any application.

import AppKit
import CoreGraphics
import Darwin
import Foundation

struct WindowSample: Equatable {
  let id: UInt32
  let index: Int
  let layer: Int
  let onScreen: Bool
  let alpha: Double?
}

struct Observation {
  var samples = 0
  var frontmostChanged = false
  var weChatAppeared = false
  var weChatMovedAboveFrontmost = false
  var firstSurfaceAt: Date?
  var newWindowIds = Set<UInt32>()
  var surfacedWindowIds = Set<UInt32>()
  var maximumAlpha: Double?
}

func fail(_ message: String) -> Never {
  let data = try? JSONSerialization.data(withJSONObject: [
    "ok": false,
    "error": message,
  ])
  print(data.flatMap { String(data: $0, encoding: .utf8) }
    ?? "{\"ok\":false}")
  exit(1)
}

func windowList() -> [[String: Any]] {
  let options: CGWindowListOption = [
    .optionOnScreenOnly,
    .excludeDesktopElements,
  ]
  return CGWindowListCopyWindowInfo(options, kCGNullWindowID)
    as? [[String: Any]] ?? []
}

func ownerPID(_ window: [String: Any]) -> pid_t? {
  (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
}

func windowID(_ window: [String: Any]) -> UInt32? {
  (window[kCGWindowNumber as String] as? NSNumber)?.uint32Value
}

func windowLayer(_ window: [String: Any]) -> Int {
  (window[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
}

func isOnScreen(_ window: [String: Any]) -> Bool {
  (window[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true
}

func samples(_ windows: [[String: Any]], pids: Set<pid_t>) -> [WindowSample] {
  windows.enumerated().compactMap { index, window in
    guard let pid = ownerPID(window), pids.contains(pid),
          let id = windowID(window) else { return nil }
    return WindowSample(
      id: id,
      index: index,
      layer: windowLayer(window),
      onScreen: isOnScreen(window),
      alpha: (window[kCGWindowAlpha as String] as? NSNumber)?.doubleValue
    )
  }
}

let arguments = CommandLine.arguments
guard arguments.count == 3,
      let duration = Double(arguments[2]),
      duration > 0,
      duration <= 120
else {
  fail("usage: wechat-window-order-watcher <wechat-pid|auto> <duration-seconds>")
}

let requestedPID: pid_t? = arguments[1] == "auto"
  ? nil
  : Int32(arguments[1]).flatMap { $0 > 1 ? $0 : nil }
if arguments[1] != "auto" {
  guard let requestedPID, kill(requestedPID, 0) == 0 else {
    fail("WeChat process is unavailable")
  }
}
let bundleID = "com.tencent.xinWeChat"
func weChatPIDs() -> Set<pid_t> {
  if let requestedPID { return [requestedPID] }
  return Set(NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
    .filter { !$0.isTerminated }
    .map(\.processIdentifier))
}

guard let frontmostPID = NSWorkspace.shared.frontmostApplication?
  .processIdentifier else {
  fail("the current frontmost application is unavailable")
}
guard !weChatPIDs().contains(frontmostPID) else {
  fail("WeChat is already frontmost")
}

let initialWindows = windowList()
let initialWeChat = samples(initialWindows, pids: weChatPIDs())
let initialIds = Set(initialWeChat.map(\.id))
let initialFrontmostIndex = initialWindows.firstIndex {
  ownerPID($0) == frontmostPID && windowLayer($0) == 0
}

var observation = Observation()
let startedAt = Date()
let deadline = Date().addingTimeInterval(duration)
repeat {
  let current = windowList()
  observation.samples += 1
  if NSWorkspace.shared.frontmostApplication?.processIdentifier != frontmostPID {
    observation.frontmostChanged = true
  }
  let weChat = samples(current, pids: weChatPIDs())
  for window in weChat {
    if let alpha = window.alpha {
      observation.maximumAlpha = max(observation.maximumAlpha ?? alpha, alpha)
    }
  }
  let currentIds = Set(weChat.map(\.id))
  let newIds = currentIds.subtracting(initialIds)
  observation.newWindowIds.formUnion(newIds)
  if initialWeChat.isEmpty && !weChat.isEmpty {
    observation.weChatAppeared = true
  }

  if let currentFrontmostIndex = current.firstIndex(where: {
    ownerPID($0) == frontmostPID && windowLayer($0) == 0
  }) {
    let surfaced = weChat.filter {
      // Any newly visible WeChat surface or ordinary window ordered above the
      // user's app is a takeover even when keyboard focus never changed.
      ($0.onScreen && !initialIds.contains($0.id))
        || ($0.layer >= 0 && $0.index < currentFrontmostIndex)
    }
    if !surfaced.isEmpty {
      observation.weChatMovedAboveFrontmost = true
      observation.firstSurfaceAt = observation.firstSurfaceAt ?? Date()
      observation.surfacedWindowIds.formUnion(surfaced.map(\.id))
    }
  } else if initialFrontmostIndex != nil {
    observation.frontmostChanged = true
  }

  Thread.sleep(forTimeInterval: 0.02)
} while Date() < deadline

let firstSurfaceAfterMs: Any
if let firstSurfaceAt = observation.firstSurfaceAt {
  firstSurfaceAfterMs = Int(firstSurfaceAt.timeIntervalSince(startedAt) * 1_000)
} else {
  firstSurfaceAfterMs = NSNull()
}
let payload: [String: Any] = [
  "ok": true,
  "baselineFrontmostPid": frontmostPID,
  "baselineWeChatWindowCount": initialWeChat.count,
  "samples": observation.samples,
  "frontmostChanged": observation.frontmostChanged,
  "weChatAppeared": observation.weChatAppeared,
  "weChatMovedAboveFrontmost": observation.weChatMovedAboveFrontmost,
  "firstSurfaceAfterMs": firstSurfaceAfterMs,
  "newWeChatWindowIds": observation.newWindowIds.sorted(),
  "surfacedWeChatWindowIds": observation.surfacedWindowIds.sorted(),
  // Keep surface/order flags even for near-transparent windows. Recording
  // opacity distinguishes a rendered Qt surface from a normal visible window
  // without silently relaxing the exposure test.
  "maximumWeChatAlpha": observation.maximumAlpha as Any? ?? NSNull(),
]
let data = try JSONSerialization.data(withJSONObject: payload)
print(String(data: data, encoding: .utf8)!)
