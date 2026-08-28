// Calendar, through EventKit — the same system store Apple Calendar uses.
// iCloud, Google, Exchange, CalDAV and subscribed accounts configured on the
// Mac therefore arrive through one interface and keep their native sync.
//
// Usage: calendar <action> <json>
//   calendars  {}
//   list       {"start":"ISO8601","end":"ISO8601","calendars":["id"]}
//   create     {event fields}
//   update     {"id":"...", ...event fields}
//   delete     {"id":"..."}

import AppKit
import Darwin
import EventKit
import Foundation

let store = EKEventStore()

func writeLine(_ payload: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: payload),
    let line = String(data: data, encoding: .utf8)
  else { return }
  print(line)
  fflush(stdout)
}

func write(_ payload: [String: Any]) -> Never {
  guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
    print("{\"ok\":false,\"error\":\"could not encode the result\"}")
    exit(0)
  }
  print(String(data: data, encoding: .utf8) ?? "{\"ok\":false,\"error\":\"encoding\"}")
  exit(0)
}

func emit(_ value: Any) -> Never { write(["ok": true, "result": value]) }
func fail(_ message: String) -> Never { write(["ok": false, "error": message]) }

let formatter: ISO8601DateFormatter = {
  let value = ISO8601DateFormatter()
  value.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return value
}()
let fallbackFormatter: ISO8601DateFormatter = {
  let value = ISO8601DateFormatter()
  value.formatOptions = [.withInternetDateTime]
  return value
}()

func date(_ value: Any?) -> Date? {
  guard let text = value as? String, !text.isEmpty else { return nil }
  return formatter.date(from: text) ?? fallbackFormatter.date(from: text)
}

func sourceKind(_ source: EKSource) -> String {
  switch source.sourceType {
  case .local: return "local"
  case .exchange: return "exchange"
  case .calDAV:
    let title = source.title.lowercased()
    if title.contains("icloud") { return "icloud" }
    if title.contains("google") || title.contains("gmail") { return "google" }
    return "caldav"
  case .subscribed: return "subscription"
  case .birthdays: return "birthdays"
  case .mobileMe: return "icloud"
  @unknown default: return "other"
  }
}

func hexColor(_ color: CGColor?) -> String {
  guard let color,
    let converted = color.converted(
      to: CGColorSpace(name: CGColorSpace.sRGB)!,
      intent: .defaultIntent,
      options: nil),
    let parts = converted.components
  else { return "#6f7e91" }
  let red = parts.count >= 3 ? parts[0] : parts[0]
  let green = parts.count >= 3 ? parts[1] : parts[0]
  let blue = parts.count >= 3 ? parts[2] : parts[0]
  return String(format: "#%02X%02X%02X", Int(red * 255), Int(green * 255), Int(blue * 255))
}

func describe(_ calendar: EKCalendar) -> [String: Any] {
  let source = calendar.source
  return [
    "id": calendar.calendarIdentifier,
    "title": calendar.title,
    "color": hexColor(calendar.cgColor),
    "editable": calendar.allowsContentModifications,
    "subscribed": calendar.type == .subscription,
    "source": [
      "id": source?.sourceIdentifier ?? "local",
      "title": source?.title ?? "On My Mac",
      "kind": source.map(sourceKind) ?? "local",
    ],
  ]
}

func recurrence(_ event: EKEvent) -> [String: Any]? {
  guard let rule = event.recurrenceRules?.first else { return nil }
  let frequency: String
  switch rule.frequency {
  case .daily: frequency = "daily"
  case .weekly: frequency = "weekly"
  case .monthly: frequency = "monthly"
  case .yearly: frequency = "yearly"
  @unknown default: return nil
  }
  var result: [String: Any] = ["frequency": frequency, "interval": rule.interval]
  if let end = rule.recurrenceEnd {
    if end.occurrenceCount > 0 { result["count"] = end.occurrenceCount }
    if let until = end.endDate { result["until"] = formatter.string(from: until) }
  }
  return result
}

func availability(_ value: EKEventAvailability) -> String {
  switch value {
  case .free: return "free"
  case .tentative: return "tentative"
  case .unavailable: return "unavailable"
  default: return "busy"
  }
}

func describe(_ event: EKEvent) -> [String: Any] {
  var value: [String: Any] = [
    "id": event.eventIdentifier ?? event.calendarItemIdentifier,
    "calendarId": event.calendar.calendarIdentifier,
    "title": event.title ?? "",
    "start": formatter.string(from: event.startDate),
    "end": formatter.string(from: event.endDate),
    "allDay": event.isAllDay,
    "availability": availability(event.availability),
    "attendees": (event.attendees ?? []).compactMap { $0.name ?? $0.url.absoluteString },
    "editable": event.calendar.allowsContentModifications,
  ]
  if let location = event.location, !location.isEmpty { value["location"] = location }
  if let notes = event.notes, !notes.isEmpty { value["notes"] = notes }
  if let url = event.url?.absoluteString, !url.isEmpty { value["url"] = url }
  if let zone = event.timeZone?.identifier { value["timeZone"] = zone }
  if let rule = recurrence(event) { value["recurrence"] = rule }
  if let alarm = event.alarms?.first, alarm.relativeOffset <= 0 {
    value["alarmMinutes"] = Int(abs(alarm.relativeOffset) / 60)
  }
  return value
}

func describedCalendars() -> [[String: Any]] {
  store.calendars(for: .event).map(describe).sorted {
    let left = (($0["source"] as? [String: Any])?["title"] as? String ?? "") + ($0["title"] as? String ?? "")
    let right = (($1["source"] as? [String: Any])?["title"] as? String ?? "") + ($1["title"] as? String ?? "")
    return left.localizedCaseInsensitiveCompare(right) == .orderedAscending
  }
}

func describedEvents(_ payload: [String: Any]) -> [[String: Any]] {
  guard let start = date(payload["start"]), let end = date(payload["end"]), start < end else {
    fail("A valid start and end are required")
  }
  let ids = payload["calendars"] as? [String]
  let calendars = ids?.compactMap(store.calendar(withIdentifier:))
  let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
  return store.events(matching: predicate).sorted { $0.startDate < $1.startDate }.map(describe)
}

func calendar(_ identifier: String?) -> EKCalendar {
  guard let identifier, !identifier.isEmpty else {
    guard let fallback = store.defaultCalendarForNewEvents else {
      fail("There is no default calendar on this Mac")
    }
    return fallback
  }
  guard let match = store.calendar(withIdentifier: identifier) else {
    fail("No calendar has the id \(identifier)")
  }
  if !match.allowsContentModifications { fail("\(match.title) is read-only") }
  return match
}

func event(_ identifier: String) -> EKEvent {
  guard let match = store.event(withIdentifier: identifier) else {
    fail("No event has the id \(identifier)")
  }
  return match
}

func setRecurrence(_ event: EKEvent, _ value: Any?) {
  event.recurrenceRules = nil
  guard let record = value as? [String: Any],
    let rawFrequency = record["frequency"] as? String
  else { return }
  let frequency: EKRecurrenceFrequency
  switch rawFrequency {
  case "daily": frequency = .daily
  case "weekly": frequency = .weekly
  case "monthly": frequency = .monthly
  case "yearly": frequency = .yearly
  default: return
  }
  let interval = max(1, record["interval"] as? Int ?? 1)
  var end: EKRecurrenceEnd?
  if let count = record["count"] as? Int, count > 0 {
    end = EKRecurrenceEnd(occurrenceCount: count)
  } else if let until = date(record["until"]) {
    end = EKRecurrenceEnd(end: until)
  }
  event.addRecurrenceRule(EKRecurrenceRule(recurrenceWith: frequency, interval: interval, end: end))
}

func setAvailability(_ event: EKEvent, _ value: String?) {
  switch value {
  case "free": event.availability = .free
  case "tentative": event.availability = .tentative
  case "unavailable": event.availability = .unavailable
  case "busy": event.availability = .busy
  default: break
  }
}

func apply(_ payload: [String: Any], to event: EKEvent, creating: Bool) {
  if let title = payload["title"] as? String { event.title = title }
  if let start = date(payload["start"]) { event.startDate = start }
  if let end = date(payload["end"]) { event.endDate = end }
  if let allDay = payload["allDay"] as? Bool { event.isAllDay = allDay }
  if payload.keys.contains("location") { event.location = payload["location"] as? String }
  if payload.keys.contains("notes") { event.notes = payload["notes"] as? String }
  if payload.keys.contains("url") {
    event.url = (payload["url"] as? String).flatMap(URL.init(string:))
  }
  if let calendarId = payload["calendarId"] as? String {
    event.calendar = calendar(calendarId)
  } else if creating {
    event.calendar = calendar(nil)
  }
  if payload.keys.contains("recurrence") { setRecurrence(event, payload["recurrence"]) }
  if payload.keys.contains("alarmMinutes") {
    event.alarms = nil
    if let minutes = payload["alarmMinutes"] as? Int, minutes >= 0 {
      event.addAlarm(EKAlarm(relativeOffset: -Double(minutes * 60)))
    }
  }
  setAvailability(event, payload["availability"] as? String)
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else { fail("usage: calendar <action> <json>") }
let action = arguments[1]
let payload =
  (arguments.count > 2
    ? (try? JSONSerialization.jsonObject(with: Data(arguments[2].utf8))) as? [String: Any]
    : [:]) ?? [:]

switch EKEventStore.authorizationStatus(for: .event) {
case .fullAccess, .authorized: break
default: fail("not-authorized")
}

switch action {
case "calendars":
  emit(describedCalendars())

case "snapshot":
  emit(["calendars": describedCalendars(), "events": describedEvents(payload)])

case "list":
  emit(describedEvents(payload))

case "watch":
  let observer = NotificationCenter.default.addObserver(
    forName: .EKEventStoreChanged,
    object: store,
    queue: .main
  ) { _ in writeLine(["type": "changed"]) }
  writeLine(["type": "ready"])
  withExtendedLifetime(observer) { RunLoop.main.run() }
  fail("Calendar change watcher stopped")

case "import":
  let records = payload["events"] as? [[String: Any]] ?? []
  var imported = 0
  var skipped = 0
  for record in records {
    guard let title = (record["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
      !title.isEmpty, date(record["start"]) != nil, date(record["end"]) != nil
    else { skipped += 1; continue }
    let item = EKEvent(eventStore: store)
    apply(record, to: item, creating: true)
    if item.endDate <= item.startDate { skipped += 1; continue }
    do {
      try store.save(item, span: .thisEvent, commit: false)
      imported += 1
    } catch {
      skipped += 1
    }
  }
  do { try store.commit() } catch { fail(error.localizedDescription) }
  emit(["imported": imported, "skipped": skipped])

case "create":
  guard let title = (payload["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
    !title.isEmpty, date(payload["start"]) != nil, date(payload["end"]) != nil
  else { fail("An event needs a title, start and end") }
  let item = EKEvent(eventStore: store)
  apply(payload, to: item, creating: true)
  if item.endDate <= item.startDate { fail("An event must end after it starts") }
  do { try store.save(item, span: .thisEvent, commit: true) } catch { fail(error.localizedDescription) }
  emit(describe(item))

case "update":
  guard let id = payload["id"] as? String else { fail("update needs an id") }
  let item = event(id)
  guard item.calendar.allowsContentModifications else { fail("This event is read-only") }
  apply(payload, to: item, creating: false)
  if item.endDate <= item.startDate { fail("An event must end after it starts") }
  do { try store.save(item, span: .thisEvent, commit: true) } catch { fail(error.localizedDescription) }
  emit(describe(item))

case "delete":
  guard let id = payload["id"] as? String else { fail("delete needs an id") }
  let item = event(id)
  guard item.calendar.allowsContentModifications else { fail("This event is read-only") }
  do { try store.remove(item, span: .thisEvent, commit: true) } catch { fail(error.localizedDescription) }
  emit(["id": id, "deleted": true])

default:
  fail("unknown action \(action)")
}
