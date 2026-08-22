---
name: skill-record
description: Watch the user demonstrate a workflow on their Mac and turn it into a reusable skill they can see in Settings → Skills. Use when they ask you to learn from what they are about to do, watch them do something, record a workflow, or build a skill from a demonstration — and when they come back and say they are done.
author: FlareAI
category: System
---

# Record & Replay

Learn a workflow the user would rather show than describe. The whole exchange is
four turns, and the user should never have to know a recorder exists.

1. They ask you to watch. You say yes and start.
2. They go and do it.
3. They say done. You stop, and tell them what you saw.
4. They say build it. You write the skill.

Nothing is saved until step 4. A summary is not a skill, and a demonstration is
not consent to keep one.

## 1 — Starting

"Can you learn from the workflow I'm about to do", "watch me do this", "record
what I'm doing" — all the same request. Call `record_workflow` with `start`,
confirm in a sentence, say how long they have, then **end your turn.**

> Recording now — go ahead and do it, then tell me when you're done. I'll stop
> on my own after 30 minutes.

Do not sleep, poll, loop, or call `status` while you wait. Their next message is
what wakes you. Only use `status` if they ask, or if they come back unsure
whether it was still running.

If `start` says a recording is already going, do not restart it: say so and ask
whether to use that one or end it first.

## 2 — While they work

Nothing. You are not in this step.

## 3 — When they say done

Call `stop`. It returns a digest, and the digest is what you summarise from —
not the raw file, and not everything that happened.

**Do not get distracted by the edges.** The user was in FlareAI when they
started and came back to it when they finished, and the middle has hunting,
backtracking and a wrong tab or two. Three things already handle this, and you
should trust them rather than narrating around them:

- FlareAI's own window is never captured at all.
- `stop` trims everything before the first real action and after the last, and
  reports how much it dropped as `trimmedLead` / `trimmedTail`.
- `apps` is where the work happened; `passedThrough` is where they merely went.
  Treat `passedThrough` as scenery. Do not put it in the summary and do not put
  it in the skill.

Summarise the workflow in a few plain lines — what it does, the steps in order,
and anything you had to guess at. Then **ask whether to build it**:

> That's about six steps in Safari and Notes. Want me to turn it into a skill?

If the digest has no steps, say so plainly. Do not assemble a workflow out of
app switches, and do not offer to build one.

Read `eventsPath` only when you need a detail the digest does not carry. It is
JSON lines, oldest first, and can be long — read it the way you would any large
file. If they say they cancelled, call `cancel`; the capture is deleted, and
there is nothing to summarise or build.

**Typed characters are never captured.** A `type` step carries a count, and a
`shortcut` carries a named chord like `cmd+s`. Recover a typed value from the
window text where it is visible, and otherwise ask. Never guess a value into a
skill.

Keep sensitive material out of the summary and out of the skill — passwords,
one-time codes, API keys, government IDs, account and card numbers, private
personal, medical, legal or HR detail. Describe the step and use a placeholder.

## 4 — When they say yes

Now write it. Follow `skill-creator` for structure and validation, and save to
`~/.flareai/skills` — that is the editable tree, and a skill landing there
appears in **Settings → Skills** on its own, switchable and editable. Say that
once, at the end, so they know where it went.

Before writing, be sure of three things: what the workflow is for, what counts
as done, and which demonstrated values are **inputs** rather than fixed details.
If one is genuinely unclear and would change the skill, ask — but ask it as part
of the confirmation in step 3 rather than as a second round of questions.

**Write it for the outcome, not for the mouse.** The recording shows what they
were trying to achieve; it does not oblige you to reproduce every click.

- Prefer a capability that already exists over driving the interface. Email,
  messages, drives, reminders and the schedule have tools; a page has `browser`.
  A step done through one of those survives a redesign; a click does not.
- Use `computer-use` where manipulating a native app *is* the task, where no
  capability exists, or where the check is visual. Load it before any step that
  touches a local GUI app — its launch, focus and window rules apply here too.
- Name the surface each step uses, describe targets by app, window and control
  rather than coordinates, and say how each step is verified. Fall back to
  coordinates only if the capture offers nothing better, and say so in the skill.
- A skill may mix surfaces. Most real workflows do.

Passing validation means the skill is well-formed, not that it works. Close by
telling them where it is, what its inputs are, and which parts you would watch
on the first real run.
