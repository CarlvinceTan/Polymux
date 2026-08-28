---
title: Skills and MCP
slug: skills-and-mcp
description: Extend Polymux with reusable skill instructions and Model Context Protocol servers.
section: Customising Polymux
sectionOrder: 3
order: 2
published: true
---

# Skills and MCP

Skills teach an agent how to approach a class of work. MCP servers provide tools, resources, and prompts from another application or service.

## Skills

Open **Settings → Skills** to review the skills available to the current profile. Polymux discovers compatible skills from its own folder, shared agent folders, bundled locations, and explicitly configured paths.

A skill is a directory led by a `SKILL.md` file. It can include references, scripts, templates, and assets. The instructions define when the skill applies and how the agent should use those resources.

Only install skills you trust. A skill can guide the agent to run local tools or work with sensitive applications, subject to Polymux permissions.

## MCP servers

Open **Settings → MCP** to manage Model Context Protocol servers. Polymux supports local standard-input/output servers and remote Streamable HTTP servers.

Advanced users can use the conventional `mcpServers` format in:

```text
~/.polymux/mcp.json
```

Polymux watches this file for changes. If it changes during an active run, the new server configuration becomes available after that run settles.

## Permissions

Connecting a server does not mean every action should run silently. Polymux still applies the current profile’s permissions and may ask before a sensitive or consequential operation.
