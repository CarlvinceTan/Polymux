---
title: Memory
slug: memory
description: Understand Polymux’s local durable memory and optional recent-screen ComputerHistory.
section: Customising Polymux
sectionOrder: 3
order: 3
published: true
---

# Memory

Memory helps Polymux retain useful context between conversations without turning every old chat into permanent prompt text.

## Local durable memory

Polymux stores durable memory as a local Markdown vault. A compact summary supplies high-level context, a searchable registry points to relevant details, and completed work can be recorded as rollout summaries.

Open **Settings → Memory** to enable or disable local memory and inspect its status. Memory is separate from the automatic compaction used to keep a long conversation within a model’s context window.

## Explicit memories

When you explicitly ask Polymux to remember something, it creates a reviewable note for later consolidation. This makes durable additions visible rather than silently rewriting the main memory files during a task.

## ComputerHistory

ComputerHistory is an optional, local-only recent-screen context layer. It stores change-aware images rather than continuous video and maintains a lightweight searchable timeline.

Capture backs off when the screen is unchanged or the computer is on battery, locked, idle, or under thermal pressure. Retention is bounded and older data is removed automatically.

ComputerHistory is independent from durable memory and has its own controls. Leave it off if you do not want recent-screen context recorded.
