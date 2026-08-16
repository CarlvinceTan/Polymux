---
name: apple-reminders
description: Manage Apple Reminders on macOS through the remindctl command-line tool. Use to list, create, inspect, edit, complete, or delete reminders that should sync through the user's normal Apple account. Do not use for calendar events or FlareAI scheduled tasks.
allowed-tools: bash
author: FlareAI
category: Productivity
---

# Apple Reminders

Use the local Reminders database through `remindctl`; do not launch or automate
Reminders.app.

## Preconditions

Run `command -v remindctl`, `remindctl status`, and, when supported,
`remindctl doctor --for-agent`. If the tool is missing or access is not already
granted, explain the blocker and ask before installing software or opening a
permission flow.

## Workflow

1. Resolve the target list and the full reminder identifier. Use `Tasks` for a
   new reminder unless the user names another existing list.
2. Normalize the title, notes, due date, timezone, URL, and recurrence. Do not
   guess a missing date or time when it materially changes the reminder.
3. Inspect before editing, completing, moving, or deleting.
4. Use JSON output where available and explicit command arguments.
5. After every mutation, fetch the reminder again and verify the stored list,
   title, due time, recurrence, and completion state.

Do not use a normal alarm as a substitute for Apple Reminders' genuine Early
Reminder field. If the installed CLI cannot set that field, say so rather than
claiming it was configured. Destructive or bulk changes require explicit user
authorization.

