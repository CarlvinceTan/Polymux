// Paste one local file into WeChat and submit it without changing app focus.
//
// Usage: wechat-paste-send <wechat-pid> <absolute-file-path> [file|video]

// The caller must first prove that File Transfer is the focused Session. This
// helper deliberately knows nothing about recipients: it posts only to the
// supplied WeChat process and refuses relative or missing paths. The original
// pasteboard is restored unless somebody changes it while the send is active.

import AppKit
import CoreGraphics
import Darwin
import Foundation

struct SavedPasteboardItem {
  let values: [(NSPasteboard.PasteboardType, Data)]
}

func fail(_ message: String) -> Never {
  let data = try? JSONSerialization.data(withJSONObject: [
    "ok": false,
    "error": message,
  ])
  print(data.flatMap { String(data: $0, encoding: .utf8) } ?? "{\"ok\":false}")
  exit(0)
}

func succeed() -> Never {
  print("{\"ok\":true}")
  exit(0)
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

func postKey(_ code: CGKeyCode, flags: CGEventFlags, pid: pid_t) -> Bool {
  guard
    let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
    let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
  else { return false }
  down.flags = flags
  up.flags = flags
  down.postToPid(pid)
  up.postToPid(pid)
  return true
}

let arguments = CommandLine.arguments
guard arguments.count == 3 || arguments.count == 4 else {
  fail("usage: wechat-paste-send <wechat-pid> <absolute-file-path> [file|video]")
}
guard let pid = Int32(arguments[1]), pid > 1, kill(pid, 0) == 0 else {
  fail("WeChat process is not running")
}
let filePath = arguments[2]
guard filePath.hasPrefix("/"), FileManager.default.fileExists(atPath: filePath) else {
  fail("the attachment path must be an existing absolute path")
}
let mode = arguments.count == 4 ? arguments[3] : "file"
guard mode == "file" || mode == "video" else {
  fail("the attachment mode must be file or video")
}

let pasteboard = NSPasteboard.general
let saved = snapshot(pasteboard)
pasteboard.clearContents()
let wroteAttachment: Bool
if mode == "video" {
  let item = NSPasteboardItem()
  let videoType = NSPasteboard.PasteboardType("public.mpeg-4")
  let fileURLType = NSPasteboard.PasteboardType("public.file-url")
  let url = URL(fileURLWithPath: filePath)
  guard
    let videoData = try? Data(contentsOf: url),
    let urlData = url.absoluteString.data(using: .utf8),
    item.setData(videoData, forType: videoType),
    item.setData(urlData, forType: fileURLType)
  else {
    restore(saved, to: pasteboard)
    fail("the video could not be read for the pasteboard")
  }
  wroteAttachment = pasteboard.writeObjects([item])
} else {
  wroteAttachment = pasteboard.writeObjects([NSURL(fileURLWithPath: filePath)])
}
guard wroteAttachment else {
  restore(saved, to: pasteboard)
  fail("the attachment could not be placed on the pasteboard")
}
let ownedChangeCount = pasteboard.changeCount

guard postKey(9, flags: .maskCommand, pid: pid) else {
  if pasteboard.changeCount == ownedChangeCount { restore(saved, to: pasteboard) }
  fail("the paste event could not be created")
}
Thread.sleep(forTimeInterval: 1.5)
guard postKey(36, flags: [], pid: pid) else {
  if pasteboard.changeCount == ownedChangeCount { restore(saved, to: pasteboard) }
  fail("the submit event could not be created")
}
Thread.sleep(forTimeInterval: 1.0)
if pasteboard.changeCount == ownedChangeCount { restore(saved, to: pasteboard) }
succeed()
