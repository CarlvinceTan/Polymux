---
name: browser
description: Research and interact with websites using an available browser MCP, with safe fallbacks for public read-only pages. Use for website navigation, web forms, authenticated pages, browser tabs, screenshots, and browser-based research.
allowed-tools: read write edit bash
---

# Browser

Use a configured browser MCP when one is available. Inspect its tools first and
keep all actions tied to the exact page or tab needed for the request.

## Routing

1. Prefer a purpose-built MCP or API over browser interaction.
2. For public, read-only pages, `curl` or another HTTP client through `bash` is
   an acceptable fallback.
3. Do not claim to see or control a GUI browser unless a browser MCP exposes
   that state.
4. If authentication, CAPTCHA, payment, a permission prompt, or another
   user-only step blocks progress, prepare the smallest useful handoff and ask
   the user to complete it.

## Safety

- Inspect before interacting and re-identify the target after navigation.
- Do not submit, purchase, publish, delete, send, or change account state
  without clear authorization in the conversation.
- Never expose cookies, session tokens, passwords, or page secrets.
- Keep research tabs and fetched files limited to the current objective.
- Report what was actually verified, and distinguish it from inference.

