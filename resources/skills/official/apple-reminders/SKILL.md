---
name: apple-reminders
description: Manage Apple Reminders on macOS through Polymux's own reminders tools. Use to list, create, complete, or delete reminders that should sync through the user's normal Apple account. Do not use for calendar events or Polymux scheduled tasks.
allowed-tools: reminders_lists reminders_list reminders_create reminders_complete reminders_delete
permissions: reminders
author: Polymux
category: Productivity
---

# Apple Reminders

Use the `reminders_*` tools. They reach EventKit directly — the same store the
Reminders app writes to — so anything created here syncs to the user's iPhone
the way one added by hand does. Do not launch or automate Reminders.app, and do
not shell out to a CLI: the tools are the supported path, and they are what
lets Polymux ask for Reminders access at the moment it is needed rather than
failing partway through.

## The tools

- `reminders_lists` — the user's lists, with ids and which is the default.
- `reminders_list` — read reminders, soonest due first, undated last. Pass
  `completed: true` for finished ones.
- `reminders_create` — title, and optionally notes, `due`, `list`, `priority`.
- `reminders_complete` — mark one done, by id.
- `reminders_delete` — remove one outright, by id.

## Due dates

`due` is ISO 8601, and its precision is the instruction:

- `2026-08-20` is due that day and alerts at no particular moment.
- `2026-08-20T09:00:00` is due at nine, and sets an alarm for then.

So a reminder the user expects to be *reminded* of needs a time. Never invent
one: if they said "tomorrow" and it matters when, ask.

## Workflow

1. Read before you write. `reminders_list` gives the exact ids the other tools
   take, and shows whether the thing already exists.
2. Put a new reminder in the default list unless the user named another. Check
   `reminders_lists` rather than guessing a list name.
3. Completing is what "done", "finished" and "tick that off" mean.
   `reminders_delete` is for a reminder that should never have existed, and
   deleting anything the user did not ask to delete needs asking first. The
   same goes for changing more than one reminder at a time.
4. Report what was stored — the list, title and due time as they came back —
   rather than repeating what was asked for.

## When access has not been given

A tool that answers that Reminders access is switched off, or has not been
granted, is telling you something the user must resolve: the switches are in
Settings → General → Permissions, and the grant itself in System Settings →
Privacy & Security → Reminders. Say which one it is and stop. Do not look for
another route into the user's reminders.
