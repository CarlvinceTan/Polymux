---
title: Models and agents
slug: models-and-agents
description: Choose hosted or local models and switch between Polymux Agent and compatible ACP runtimes.
section: Customising Polymux
sectionOrder: 3
order: 1
published: true
---

# Models and agents

Polymux separates the desktop workspace from the intelligence running behind it. You can change a model, provider, or compatible agent runtime without replacing the surrounding chats, files, views, and permission controls.

## Connect a provider

Open **Settings → Providers** to add a hosted model provider, sign in where supported, or save an API key. Credentials are stored locally using protected operating-system storage.

Local runtimes appear as providers when Polymux can reach them. They do not require a hosted API key, but the runtime and selected model must be running on this computer.

## Choose models

Open **Settings → Models** to select the models assigned to available roles. The full picker and role configuration are always available.

Changing the model affects future agent work. It does not remove existing chats or workspace content.

## Choose an agent runtime

Polymux Agent is included by default. It supports skills, MCP tools, local memory, goals, compaction, and subagent delegation.

Profiles can instead launch or connect to an external agent over ACP. Configure this under the profile’s Agent settings. Polymux continues to own the conversation UI, local history, rendering, and permission decisions; the selected runtime owns its agent session.

## Profiles

A profile groups agent, model, provider, MCP, plugin, skill, and credential configuration. Use profiles when different kinds of work need different tools or model access.

Profiles do not create a separate copy of the desktop process or every local data store. They are configuration boundaries, not separate operating-system users.
