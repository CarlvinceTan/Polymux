// Reminders, through EventKit, as a first-class capability rather than a shell
// command.
//
// The point of it being here rather than in a CLI the agent runs through bash:
// the permission gate becomes exact. Polymux knows this binary touches
// Reminders because that is the only thing it does, so it can ask for the
// grant at the moment of use and wait for the answer — where a command line
// can only be guessed at from its text.
//
// Usage: reminders <action> <json>
//   lists     {}
//   list      {"list":"<id>","completed":false,"limit":50}
//   create    {"title":"...","notes":"...","due":"ISO8601","list":"<id>","priority":0}
//   complete  {"id":"..."}
//   delete    {"id":"..."}
//
// One JSON object on stdout: {"ok":true,"result":…} or {"ok":false,"error":…}.
// A missing grant is reported as `not-authorized` rather than as a failure, so
// the caller can tell "ask for this" apart from "this went wrong".

import EventKit
import Foundation

let store = EKEventStore()

func emit(_ value: Any) -> Never {
  let payload: [String: Any] = ["ok": true, "result": value]
  write(payload)
}

func fail(_ message: String) -> Never {
  write(["ok": false, "error": message])
}

func write(_ payload: [String: Any]) -> Never {
  guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
    print("{\"ok\":false,\"error\":\"could not encode the result\"}")
    exit(0)
  }
  print(String(data: data, encoding: .utf8) ?? "{\"ok\":false,\"error\":\"encoding\"}")
  exit(0)
}

let formatter: ISO8601DateFormatter = {
  let value = ISO8601DateFormatter()
  value.formatOptions = [.withInternetDateTime]
  return value
}()

func date(_ value: Any?) -> Date? {
  guard let text = value as? String, !text.isEmpty else { return nil }
  return formatter.date(from: text)
}

/// EventKit holds a due date as date components rather than an instant, since a
/// reminder due "tomorrow" has no time of day. Whether a time was given is
/// carried by whether the components include one.
func components(_ due: Date, timed: Bool) -> DateComponents {
  let fields: Set<Calendar.Component> = timed
    ? [.year, .month, .day, .hour, .minute, .second]
    : [.year, .month, .day]
  return Calendar.current.dateComponents(fields, from: due)
}

func describe(_ reminder: EKReminder) -> [String: Any] {
  var value: [String: Any] = [
    "id": reminder.calendarItemIdentifier,
    "title": reminder.title ?? "",
    "list": reminder.calendar?.title ?? "",
    "list_id": reminder.calendar?.calendarIdentifier ?? "",
    "completed": reminder.isCompleted,
    "priority": reminder.priority,
  ]
  if let notes = reminder.notes, !notes.isEmpty { value["notes"] = notes }
  if let due = reminder.dueDateComponents?.date { value["due"] = formatter.string(from: due) }
  if let completed = reminder.completionDate {
    value["completed_at"] = formatter.string(from: completed)
  }
  return value
}

/// Reminders are fetched asynchronously; every action that reads them waits
/// here rather than each growing its own callback.
func fetch(_ predicate: NSPredicate) -> [EKReminder] {
  var found: [EKReminder] = []
  let semaphore = DispatchSemaphore(value: 0)
  store.fetchReminders(matching: predicate) { reminders in
    found = reminders ?? []
    semaphore.signal()
  }
  semaphore.wait()
  return found
}

func reminder(withId id: String) -> EKReminder {
  guard let item = store.calendarItem(withIdentifier: id) as? EKReminder else {
    fail("No reminder has the id \(id)")
  }
  return item
}

func list(named id: String?) -> EKCalendar {
  guard let id, !id.isEmpty else {
    guard let fallback = store.defaultCalendarForNewReminders() else {
      fail("There is no default reminders list on this Mac")
    }
    return fallback
  }
  let lists = store.calendars(for: .reminder)
  // Accept the name as readily as the identifier: a model that has just read
  // the lists has both, and the name is what a person would have said.
  guard
    let match = lists.first(where: { $0.calendarIdentifier == id })
      ?? lists.first(where: { $0.title.caseInsensitiveCompare(id) == .orderedSame })
  else {
    fail("No reminders list named \(id)")
  }
  return match
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else { fail("usage: reminders <action> <json>") }
let action = arguments[1]
let payload =
  (arguments.count > 2
    ? (try? JSONSerialization.jsonObject(with: Data(arguments[2].utf8))) as? [String: Any]
    : [:]) ?? [:]

// Read the grant before touching anything. Asking is the host's job — it owns
// the switches the user set and the moment worth interrupting — so this only
// ever reports.
let authorization = EKEventStore.authorizationStatus(for: .reminder)
switch authorization {
case .fullAccess, .authorized: break
default: fail("not-authorized")
}

switch action {
case "lists":
  emit(
    store.calendars(for: .reminder).map { calendar in
      [
        "id": calendar.calendarIdentifier,
        "name": calendar.title,
        "default": calendar.calendarIdentifier
          == store.defaultCalendarForNewReminders()?.calendarIdentifier,
      ]
    })

case "list":
  let chosen = payload["list"] as? String
  let calendars = chosen.map { [list(named: $0)] } ?? store.calendars(for: .reminder)
  let wantsCompleted = payload["completed"] as? Bool ?? false
  let predicate =
    wantsCompleted
    ? store.predicateForCompletedReminders(
      withCompletionDateStarting: nil, ending: nil, calendars: calendars)
    : store.predicateForIncompleteReminders(
      withDueDateStarting: nil, ending: nil, calendars: calendars)
  let limit = payload["limit"] as? Int ?? 50
  let found = fetch(predicate).sorted { left, right in
    // Soonest first, and anything undated after everything dated: a list whose
    // top is the next thing due is the one worth reading.
    switch (left.dueDateComponents?.date, right.dueDateComponents?.date) {
    case let (l?, r?): return l < r
    case (nil, _?): return false
    case (_?, nil): return true
    default: return (left.title ?? "") < (right.title ?? "")
    }
  }
  emit(found.prefix(max(0, limit)).map(describe))

case "create":
  guard let title = (payload["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
    !title.isEmpty
  else { fail("A reminder needs a title") }
  let item = EKReminder(eventStore: store)
  item.title = title
  item.calendar = list(named: payload["list"] as? String)
  if let notes = payload["notes"] as? String, !notes.isEmpty { item.notes = notes }
  if let priority = payload["priority"] as? Int { item.priority = priority }
  if let due = date(payload["due"]) {
    let timed = (payload["due"] as? String)?.contains("T") ?? false
    item.dueDateComponents = components(due, timed: timed)
    // A due date with no alarm is a row in a list nobody is told about, which
    // is not what "remind me" means.
    if timed { item.addAlarm(EKAlarm(absoluteDate: due)) }
  }
  do { try store.save(item, commit: true) } catch { fail(error.localizedDescription) }
  emit(describe(item))

case "complete":
  guard let id = payload["id"] as? String else { fail("complete needs an id") }
  let item = reminder(withId: id)
  item.isCompleted = true
  do { try store.save(item, commit: true) } catch { fail(error.localizedDescription) }
  emit(describe(item))

case "delete":
  guard let id = payload["id"] as? String else { fail("delete needs an id") }
  let item = reminder(withId: id)
  do { try store.remove(item, commit: true) } catch { fail(error.localizedDescription) }
  emit(["id": id, "deleted": true])

default:
  fail("unknown action \(action)")
}
