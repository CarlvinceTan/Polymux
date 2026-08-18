// Probes and requests the macOS privacy grants Electron has no API for.
//
// `systemPreferences` covers microphone, camera and screen recording and
// nothing else, so every grant an app-driving skill needs — Reminders,
// Calendars, Contacts, Photos, and permission to drive another application —
// is asked for here. Each request is the framework call itself: there is no
// separate "show the dialog" API, so touching the store *is* the prompt.
//
// Usage:
//   app-permissions status  <class> [target-bundle-id]
//   app-permissions request <class> [target-bundle-id]
//
// where <class> is reminders | calendars | contacts | photos | automation.
// One JSON object is written to stdout: {"status":"..."} matching the
// protocol's SystemPermissionStatus, or {"status":"unknown","error":"..."}.

import AppKit
import Contacts
import EventKit
import Foundation
import Photos

/// The prompt is raised by the framework, which needs a run loop to deliver
/// its answer on; the helper exits as soon as one arrives.
let semaphore = DispatchSemaphore(value: 0)
var answer = "unknown"
var failure: String?

func emit() -> Never {
  var payload = "{\"status\":\"\(answer)\""
  if let failure { payload += ",\"error\":\"\(failure.replacingOccurrences(of: "\"", with: "'"))\"" }
  print(payload + "}")
  exit(0)
}

func name(_ granted: Bool) -> String { granted ? "granted" : "denied" }

func eventKit(_ entity: EKEntityType) -> String {
  switch EKEventStore.authorizationStatus(for: entity) {
  case .notDetermined: return "not-determined"
  case .restricted: return "restricted"
  case .denied: return "denied"
  // `.authorized` is the pre-Sonoma spelling and `.fullAccess` its successor.
  // `.writeOnly` is deliberately *not* granted: a skill that can add an event
  // but cannot read one back would fail halfway rather than up front.
  case .fullAccess, .authorized: return "granted"
  case .writeOnly: return "denied"
  @unknown default: return "unknown"
  }
}

func contacts() -> String {
  switch CNContactStore.authorizationStatus(for: .contacts) {
  case .notDetermined: return "not-determined"
  case .restricted: return "restricted"
  case .denied: return "denied"
  case .authorized: return "granted"
  @unknown default: return "unknown"
  }
}

func photos() -> String {
  switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
  case .notDetermined: return "not-determined"
  case .restricted: return "restricted"
  case .denied: return "denied"
  case .authorized: return "granted"
  // A library the user has narrowed to a few albums is still a library we can
  // read, so it counts as granted rather than sending them back to Settings.
  case .limited: return "granted"
  @unknown default: return "unknown"
  }
}

/// Automation is the one grant that is not a single checkbox: macOS records it
/// per (this app, target app) pair. The caller names the target; `System
/// Events` stands in when it does not, because that is what a script driving
/// an app it has not named yet will reach for first.
func automation(_ target: String, ask: Bool) -> String {
  let descriptor = NSAppleEventDescriptor(bundleIdentifier: target)
  let code = AEDeterminePermissionToAutomateTarget(
    descriptor.aeDesc!, typeWildCard, typeWildCard, ask)
  switch code {
  case noErr: return "granted"
  case OSStatus(errAEEventNotPermitted): return "denied"
  case OSStatus(-1744): return "not-determined"  // errAEEventWouldRequireUserConsent
  // The target is not installed or not running, which is not an answer about
  // permission at all — saying "denied" here would send the user to a pane
  // with nothing to switch on.
  case OSStatus(procNotFound): return "unknown"
  default:
    failure = "AEDeterminePermissionToAutomateTarget returned \(code)"
    return "unknown"
  }
}

let arguments = CommandLine.arguments
guard arguments.count >= 3 else {
  failure = "usage: app-permissions <status|request> <class> [target-bundle-id]"
  emit()
}
let asking = arguments[1] == "request"
let kind = arguments[2]
let target = arguments.count > 3 ? arguments[3] : "com.apple.systemevents"

switch kind {
case "reminders", "calendars":
  let entity: EKEntityType = kind == "reminders" ? .reminder : .event
  answer = eventKit(entity)
  if asking && answer == "not-determined" {
    let store = EKEventStore()
    let completion: (Bool, Error?) -> Void = { granted, error in
      answer = name(granted)
      if let error { failure = error.localizedDescription }
      semaphore.signal()
    }
    if #available(macOS 14.0, *) {
      if entity == .reminder { store.requestFullAccessToReminders(completion: completion) }
      else { store.requestFullAccessToEvents(completion: completion) }
    } else {
      store.requestAccess(to: entity, completion: completion)
    }
    semaphore.wait()
  }
case "contacts":
  answer = contacts()
  if asking && answer == "not-determined" {
    CNContactStore().requestAccess(for: .contacts) { granted, error in
      answer = name(granted)
      if let error { failure = error.localizedDescription }
      semaphore.signal()
    }
    semaphore.wait()
  }
case "photos":
  answer = photos()
  if asking && answer == "not-determined" {
    PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in
      answer = photos()
      semaphore.signal()
    }
    semaphore.wait()
  }
case "automation":
  answer = automation(target, ask: asking)
default:
  failure = "unknown permission class \(kind)"
}
emit()
