---
title: Introduction
slug: introduction
description: Meet Polymux, the desktop workspace that puts your assistant beside your messages, files, browser, and ongoing work.
section: Getting started
sectionOrder: 1
order: 1
published: true
---

# Introduction

Polymux is an open-source desktop workspace for working with an AI assistant. Chat, messages, email, files, browser tabs, scheduled work, and your choice of models live together instead of being split across separate tools.

It is designed to feel useful after a normal desktop install while staying open to deeper configuration when you want it.

## What Polymux includes

- **Chat** is where you ask for work and follow the agent’s progress.
- **Hub** brings supported messaging services and email into one inbox.
- **Drive** works with local files, cloud drives, network folders, and S3-compatible storage.
- **Browser** gives the agent an in-app browser and controlled access to assigned external tabs.
- **Schedule** runs saved requests at a recurring time.
- **Tasks and Subagents** keep delegated work visible without crowding the main conversation.
- **Memory** preserves useful context locally between conversations.

## Agent-agnostic by design

Polymux includes Polymux Agent, but the workspace is not tied to it. A profile can connect another compatible agent through the open Agent Client Protocol (ACP). Polymux keeps ownership of the interface, conversations, run history, and permissions while the chosen runtime performs the agent work.

You can also choose hosted model providers or local runtimes. The rest of the workspace stays the same when the model changes.

## Platform support

Polymux is available for macOS, Windows, and Linux. macOS currently receives the deepest testing and feature coverage, so some integrations and operating-system features may differ on Windows or Linux.

Start with [Quickstart](/docs/quickstart/) for the shortest route from installation to your first useful request.
