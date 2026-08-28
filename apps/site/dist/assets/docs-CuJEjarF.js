import{A as e,C as t,D as n,E as r,F as i,L as a,M as o,N as s,O as c,P as l,R as u,S as d,T as f,_ as p,a as m,b as h,c as g,d as ee,f as _,g as v,h as y,j as b,k as x,l as S,m as C,n as te,o as ne,p as w,s as re,t as T,u as ie,v as E,x as D,y as O}from"./polymux-CnpS2t3f.js";import{n as k,t as A}from"./markdown-BFTPERAl.js";var j=Object.assign({"../content/docs/browser.md":`---
title: Browser
slug: browser
description: Use Polymux’s in-app browser or explicitly assign an external browser tab to a task.
section: Using Polymux
sectionOrder: 2
order: 4
published: true
---

# Browser

Browser keeps web research and actions inside the same workspace as the conversation. Polymux can use its built-in browser or work with an external tab that you explicitly assign.

## In-app browser

Open **Browser** from the workspace to create tabs, navigate, search, inspect downloads, and keep relevant pages beside the chat. The agent can use this browser when a task requires web access.

The in-app browser maintains its own browsing state. Manage passwords, downloads, site permissions, and browsing data under **Settings → Browser**.

## External browser tabs

The optional browser extension connects supported external tabs to the local Polymux app. Its passive inventory is limited to tab metadata such as title, URL, active state, and window relationship.

Page content and interaction become available only for the exact tab assigned to a task. Access ends when the task releases the tab, the tab closes, the app disconnects, or the extension is disabled.

## Downloads

Files downloaded through the in-app browser appear in its Downloads view. From there, you can open the file or reveal it using the operating system.

## When a site needs you

Sign-ins, CAPTCHAs, payment confirmation, and other sensitive checkpoints may require manual attention. Polymux pauses or hands the surface to you instead of assuming permission to complete an irreversible action.
`,"../content/docs/drive.md":`---
title: Drive
slug: drive
description: Work with local files, cloud drives, network folders, and S3-compatible storage inside Polymux.
section: Using Polymux
sectionOrder: 2
order: 3
published: true
---

# Drive

Drive gives the workspace and agent a consistent view of files across local and connected storage. You can browse, search, upload, download, move, duplicate, and inspect files without leaving the task.

## Supported storage

Polymux supports:

- A local folder on this computer
- Mounted network folders
- Google Drive
- Dropbox
- OneDrive personal or work accounts
- S3-compatible storage such as AWS S3, Cloudflare R2, Backblaze B2, or MinIO

Availability can depend on how a particular build was configured.

## Connect storage

Open **Settings → Drive**. Connect one or more providers, then arrange their priority under **Drive Configuration**. When the agent creates a file, Polymux uses the first available destination in that order.

Cloud providers are restricted to a Polymux app folder where the provider supports that scope. Credentials are stored through the operating system’s protected credential storage.

## Work with files

Open Drive from the workspace, select a storage source, and browse or search. File filters narrow the view to documents, images, videos, or other types.

Each chat has a Polymux folder for files created during that conversation. This keeps outputs connected to the work that produced them.

## Network and S3 storage

A network folder remains listed when it is temporarily unmounted, but its contents are unavailable until the share returns. For S3-compatible storage, provide the bucket, region, credentials, and a custom endpoint when the service is not AWS. An optional prefix can confine Polymux to one folder in the bucket.
`,"../content/docs/hub.md":`---
title: Hub
slug: hub
description: Bring supported messaging services and email accounts into one Polymux inbox.
section: Using Polymux
sectionOrder: 2
order: 2
published: true
---

# Hub

Hub brings supported messaging platforms and email accounts into the Polymux workspace. You can read a conversation, write a reply, and let the agent work with the selected thread without constantly changing apps.

## Connect an account

Open **Settings → Hub** and choose a messaging platform or email provider. The exact sign-in flow depends on the service: it may use OAuth, a QR code, a pairing code, an app password, or provider-specific credentials.

Some notable requirements:

- Telegram personal accounts require an API ID and API hash from Telegram.
- iMessage requires Full Disk Access on macOS so Polymux can read the local Messages database.
- iCloud Mail and Fastmail use app-specific passwords.
- Custom email uses the IMAP and SMTP server details supplied by your provider.

## Messages and email

The left rail lists connected services and conversations. Selecting one opens its history in the main Hub view. The composer follows the capabilities of that service, including attachments or reactions where supported.

Email accounts use the same Hub surface, with mail-specific fields and actions where needed.

## Incognito mode

Hub Incognito Mode is available under **Settings → General**. When supported by a connection, it lets Polymux read messages without marking them as seen or read.

## Local bridge model

Messaging connections run through bridges supervised by Polymux on your computer. Support varies by platform and service, and a provider can change its login requirements independently of Polymux.
`,"../content/docs/installation.md":`---
title: Installation
slug: installation
description: Install Polymux on macOS, Windows, or Linux and understand the current platform support.
section: Getting started
sectionOrder: 1
order: 3
published: true
---

# Installation

Polymux is a desktop application for macOS, Windows, and Linux. Download releases from the website or GitHub.

## Download a release

Use the [download button](/#download) on the Polymux website. It selects the appropriate release for the current operating system when one is available. You can also browse every build on [GitHub Releases](https://github.com/CarlvinceTan/Polymux/releases/latest).

| Platform | Package | Current support |
| --- | --- | --- |
| macOS | Apple silicon application | Best-tested platform |
| Windows | x64 installer | Available; some integrations may differ |
| Linux | x64 AppImage | Available; some integrations may differ |

## macOS permissions

macOS may request access when you first use features such as notifications, dictation, app control, local screen context, or iMessage. Polymux explains why each permission is needed before the system prompt appears.

A denied permission can be changed in **System Settings → Privacy & Security**. Restart Polymux after enabling access if macOS does not apply it immediately.

## Updates

Open **Settings → General** to see the installed version and check for updates. Releases are also available directly from GitHub.

## Build from source

Developers can build Polymux from its [public repository](https://github.com/CarlvinceTan/Polymux). The repository README and \`docs/DEVELOPMENT.md\` contain the current setup, test, and packaging commands.
`,"../content/docs/introduction.md":`---
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
`,"../content/docs/memory.md":`---
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
`,"../content/docs/models-and-agents.md":`---
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

Open **Settings → Models** to select the models assigned to available roles. Basic mode presents a simplified choice; Advanced mode exposes the full picker and configuration.

Changing the model affects future agent work. It does not remove existing chats or workspace content.

## Choose an agent runtime

Polymux Agent is included by default. It supports skills, MCP tools, local memory, goals, compaction, and subagent delegation.

Profiles can instead launch or connect to an external agent over ACP. Configure this under the profile’s Agent settings. Polymux continues to own the conversation UI, local history, rendering, and permission decisions; the selected runtime owns its agent session.

## Profiles

A profile groups agent, model, provider, MCP, plugin, skill, and credential configuration. Use profiles when different kinds of work need different tools or model access.

Profiles do not create a separate copy of the desktop process or every local data store. They are configuration boundaries, not separate operating-system users.
`,"../content/docs/privacy-and-permissions.md":`---
title: Privacy and permissions
slug: privacy-and-permissions
description: See how local data, browser access, credentials, and operating-system permissions are handled.
section: Help
sectionOrder: 4
order: 1
published: true
---

# Privacy and permissions

Polymux is a local desktop application, but the services and models you connect may process data under their own terms. Review a provider before giving it access to sensitive work.

## Local data

Chats, run history, workspace state, memory, and connected-service configuration are stored locally by the desktop app. Cloud storage, messaging services, and hosted model providers receive only the information needed for the action you request through that service.

Read the full [privacy policy](/privacy-policy/) for the current product and browser-extension details.

## Credentials

Provider keys and connection credentials are stored through protected operating-system storage where supported. Avoid placing secrets directly in prompts, skill instructions, source files, or public repositories.

## Browser access

The external browser extension can maintain local tab metadata, but it receives page content and interaction access only for an explicitly assigned tab. The in-app browser keeps its own browsing state and permissions.

## Operating-system access

Features such as microphone input, notifications, app automation, local screen context, and iMessage rely on operating-system permissions. Enable only what you plan to use. Polymux remains functional with optional permissions disabled, though the related feature will be unavailable.

## Consequential actions

Giving a tool access does not automatically authorise every outcome. The agent may stop for confirmation before sending, publishing, paying, deleting, or completing another consequential external action.
`,"../content/docs/quickstart.md":`---
title: Quickstart
slug: quickstart
description: Download Polymux, choose a model, and complete your first useful task in a few minutes.
section: Getting started
sectionOrder: 1
order: 2
published: true
---

# Quickstart

This guide takes you from a fresh install to your first conversation. You can connect messages, storage, and other tools later.

## 1. Download and open Polymux

[Download the latest release](/#download) for your operating system and open the app. On first launch, Polymux walks you through its short setup flow.

If your operating system asks for permission, only enable the access needed for the features you plan to use. You can change permissions later.

## 2. Choose how Polymux thinks

Select a model provider and model during setup. Depending on the provider, you may sign in, paste an API key, or select a compatible local runtime already running on your computer.

You can change this later under **Settings → Providers** and **Settings → Models**. Advanced mode exposes the full model and role configuration.

## 3. Start a conversation

Open a new chat and make a concrete request. For example:

> Find the latest Polymux release on GitHub and summarise what changed.

Polymux shows the agent’s progress in the conversation. If an action needs permission or your decision, the run pauses and asks.

## 4. Open the workspace

Use the workspace control to place supporting views beside the chat:

- Open **Browser** to keep research visible.
- Open **Drive** to work with files.
- Open **Hub** after connecting a messaging or email account.
- Open **Tasks** or **Subagents** to follow delegated work.

Views open as tabs, so the files and pages connected to a task can remain visible while you talk to the agent.

## 5. Add connections when you need them

Open Settings to connect storage, communication services, skills, or MCP servers. Nothing requires you to configure every integration up front.

Next, read [The workspace](/docs/workspace/) for the main interface or [Models and agents](/docs/models-and-agents/) to customise the intelligence behind it.
`,"../content/docs/schedules-and-tasks.md":`---
title: Schedules and tasks
slug: schedules-and-tasks
description: Run recurring requests and follow work delegated to focused subagents.
section: Using Polymux
sectionOrder: 2
order: 5
published: true
---

# Schedules and tasks

Polymux can run recurring requests later and keep delegated work visible while the main conversation continues.

## Schedule recurring work

Open **Schedule** and describe what the agent should do each time. Choose the frequency and save the schedule. Active schedules run locally through Polymux and record their latest result.

Use schedules for repeatable work such as checking a source, preparing a summary, or monitoring a condition. The computer and required connections must be available when the run starts.

Notifications for successful or failed scheduled work can be configured under **Settings → General → Notifications**.

## Tasks

The Tasks view tracks work that needs attention and its progress. Tasks are scoped to the conversation so the board stays connected to the request that created them.

## Subagents

Polymux Agent can delegate bounded pieces of work to subagents. Each subagent has its own activity and result while the main agent remains responsible for the overall response.

Open **Subagents** to inspect delegated work. A completed-looking row is only a summary; open the item when you need its full result or current state.
`,"../content/docs/skills-and-mcp.md":`---
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

A skill is a directory led by a \`SKILL.md\` file. It can include references, scripts, templates, and assets. The instructions define when the skill applies and how the agent should use those resources.

Only install skills you trust. A skill can guide the agent to run local tools or work with sensitive applications, subject to Polymux permissions.

## MCP servers

Open **Settings → MCP** to manage Model Context Protocol servers. Polymux supports local standard-input/output servers and remote Streamable HTTP servers.

Advanced users can use the conventional \`mcpServers\` format in:

\`\`\`text
~/.polymux/mcp.json
\`\`\`

Polymux watches this file for changes. If it changes during an active run, the new server configuration becomes available after that run settles.

## Permissions

Connecting a server does not mean every action should run silently. Polymux still applies the current profile’s permissions and may ask before a sensitive or consequential operation.
`,"../content/docs/troubleshooting.md":`---
title: Troubleshooting
slug: troubleshooting
description: Resolve common setup, provider, connection, browser, and permission problems.
section: Help
sectionOrder: 4
order: 2
published: true
---

# Troubleshooting

Start with the narrowest failing surface. A provider problem, disconnected Hub bridge, unavailable storage account, and denied macOS permission have different fixes even when they interrupt the same agent request.

## The agent cannot start

Open **Settings → Providers** and confirm the selected provider is connected. Then check **Settings → Models** for the model assigned to the current role.

Common causes include an expired API key, provider rate limit, account-region restriction, unavailable local runtime, or model that is no longer offered by the provider.

## A Hub account is offline

Open **Settings → Hub**, select the connection, and read its current state. Reconnect the account if its token or linked-device session expired.

For Telegram, confirm the API ID and hash. For iMessage on macOS, confirm Full Disk Access. For email, confirm the provider’s app password and IMAP/SMTP requirements.

## Drive cannot reach a file

Check **Settings → Drive** for the provider state and active storage order. A network folder must be mounted. An S3-compatible provider needs the correct endpoint, region, credentials, and addressing mode.

## Browser control is unavailable

For the in-app browser, check site permissions and browsing settings. For an external browser, confirm the extension is installed, the desktop app is connected, and the intended tab was explicitly assigned to the task.

## A macOS permission was denied

Open **System Settings → Privacy & Security**, enable the relevant permission for Polymux, and restart the app. macOS may not repeat a system permission prompt after it has been denied once.

## Still stuck

Check the [GitHub issues](https://github.com/CarlvinceTan/Polymux/issues) for a matching report. When opening a new issue, include the Polymux version, operating system, the affected view or provider, and the exact error text. Remove keys, tokens, personal messages, and other private data first.
`,"../content/docs/workspace.md":`---
title: The workspace
slug: workspace
description: Understand Polymux’s tabbed workspace and how its views stay connected to a conversation.
section: Using Polymux
sectionOrder: 2
order: 1
published: true
---

# The workspace

The workspace keeps the material behind an answer visible beside your conversation. A message, file, webpage, scheduled job, or delegated task can open as a tab without replacing the chat.

## Open a view

Use the workspace control in the title bar to open a view. The available views include **Drive**, **Hub**, **Browser**, **Schedule**, **Tasks**, and **Subagents**.

You can keep several tabs open, switch between them, resize the workspace, expand it, or minimise it back into the conversation.

## How tabs relate to a chat

Workspace tabs belong to the current working context. This makes it easier to see which page or file the agent is using without turning every intermediate step into another chat message.

Closing a view removes it from the visible workspace. It does not automatically delete the underlying file, message, browser history, or task.

## Pinned views

Frequently used views can appear in the top bar. Configure this under **Settings → General → Top bar**. Keep the set small so the controls you use most remain easy to recognise.

## Basic and Advanced mode

Basic mode keeps the common controls visible. Advanced mode exposes additional provider, model, memory, and configuration surfaces. Turn it on under **Settings → General** when you need those controls; the core workspace behaves the same in either mode.
`});function M(e){return e.toLowerCase().replace(/&(?:amp|quot|apos|lt|gt);/g,``).replace(/[^a-z0-9\s-]/g,``).trim().replace(/\s+/g,`-`).replace(/-+/g,`-`)}function N(e){let t=A(e),n=[],r=new Set;return{html:t.replace(/<h([23])>([\s\S]*?)<\/h\1>/g,(e,t,i)=>{let a=Number(t),o=i.replace(/<[^>]*>/g,``).trim(),s=M(o)||`section`,c=s,l=2;for(;r.has(c);)c=`${s}-${l++}`;return r.add(c),n.push({id:c,text:o,level:a}),`<h${a} id="${c}">${i}</h${a}>`}),toc:n}}function P(e,t){let n=t.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);if(!n)throw Error(`Documentation page ${e} is missing YAML front matter.`);let r=k(n[1]);if(r.published===!1)return null;let i=e.split(`/`),a=i[i.length-1]?.replace(/\.md$/,``)??``,o=String(r.title??``).trim(),s=String(r.slug??a).trim(),c=String(r.description??``).trim(),l=String(r.section??`Guides`).trim(),u=Number(r.sectionOrder??99),d=Number(r.order??99),f=n[2].trim();if(!o||!s||!c||!l||!Number.isFinite(u)||!Number.isFinite(d))throw Error(`Documentation page ${e} has incomplete front matter.`);return{title:o,slug:s,description:c,section:l,sectionOrder:u,order:d,body:f,...N(f)}}var F=Object.entries(j).map(([e,t])=>P(e,t)).filter(e=>e!==null).sort((e,t)=>e.sectionOrder-t.sectionOrder||e.order-t.order||e.title.localeCompare(t.title)),ae=Array.from(F.reduce((e,t)=>{let n=e.get(t.section)??{title:t.section,order:t.sectionOrder,pages:[]};return n.pages.push(t),e.set(t.section,n),e},new Map).values()).sort((e,t)=>e.order-t.order);function oe(e){return F.find(t=>t.slug===e)}function I(e){return e===`introduction`?`/docs/`:`/docs/${e}/`}function se(e){let t=F.findIndex(t=>t.slug===e);return t<0?{}:{previous:F[t-1],next:F[t+1]}}var ce=E(`<meta name="description"/>`),le=E(`<link rel="icon" type="image/svg+xml"/> <!>`,1),ue=O(`<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4l12 12M16 4L4 16"></path></svg>`),de=O(`<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14"></path></svg>`),fe=E(`<a><span><strong> </strong><small> </small></span> <em> </em></a>`),pe=E(`<p>No matching documentation.</p>`),me=E(`<div class="docs-search-results"><!></div>`),he=E(`<button class="docs-overlay" type="button" aria-label="Close documentation navigation"></button>`),ge=E(`<li><a> </a></li>`),_e=E(`<ul></ul>`),ve=E(`<section><button type="button"><span> </span> <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 6 5-6 5"></path></svg></button> <!></section>`),ye=E(`<a><small>← Previous</small><strong> </strong></a>`),be=E(`<span></span>`),xe=E(`<a class="next"><small>Next →</small><strong> </strong></a>`),Se=E(`<nav class="docs-neighbours" aria-label="Previous and next documentation pages"><!> <!></nav>`),Ce=E(`<div class="docs-content"><article class="docs-article"></article> <!> <footer class="docs-footer"><span> </span> <div><a href="/blog/">Blog</a><a href="/releases/">Releases</a><a href="/privacy-policy/">Privacy</a></div></footer></div>`),we=E(`<div class="docs-not-found"><span>404</span><h1>That page isn’t in the docs.</h1><a href="/docs/">Read the introduction</a></div>`),Te=E(`<a> </a>`),Ee=E(`<h2>On this page</h2> <nav aria-label="On this page"></nav>`,1),De=E(`<aside class="docs-toc"><!></aside>`),Oe=E(`<header class="docs-header"><div class="docs-header-left"><button class="docs-menu-button" type="button"><!></button> <a class="docs-brand" href="/" aria-label="Polymux home"><img alt=""/><strong>Polymux</strong><span>/</span><span>Docs</span></a></div> <div class="docs-search-wrap"><label class="docs-search" for="docs-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"></circle><path d="m13 13 4 4"></path></svg> <input id="docs-search" type="search" placeholder="Search documentation" autocomplete="off"/> <kbd>⌘K</kbd></label> <!></div> <div class="docs-header-right"><a href="/releases/">Releases</a> <a href="https://github.com/CarlvinceTan/Polymux">GitHub</a> <a class="docs-download" href="/#download">Download</a></div></header> <!> <div class="docs-layout"><aside><nav aria-label="Documentation"></nav></aside> <main class="docs-main"><!></main> <!></div>`,1);function L(h,C){i(C,!0);let E=location.pathname.split(`/`).filter(Boolean),O=oe(E[0]===`docs`&&E[1]?decodeURIComponent(E[1]):`introduction`),k=O?se(O.slug):{},A=o(!1),j=o(``),M,N=o(e(O?.toc[0]?.id??``)),P=o(e(new Set)),L=s(()=>{let e=d(j).trim().toLowerCase();return e.length<2?[]:F.filter(t=>`${t.title} ${t.description} ${t.section} ${t.body}`.toLowerCase().includes(e)).slice(0,7)});function ke(e){let t=new Set(d(P));t.has(e)?t.delete(e):t.add(e),b(P,t,!0)}function R(){let e=Array.from(document.querySelectorAll(`.docs-article h2[id], .docs-article h3[id]`));if(!e.length)return;let t=e[0]?.id??``;for(let n of e)if(n.getBoundingClientRect().top<=112)t=n.id;else break;b(N,t,!0)}te(()=>{let e=e=>{(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()===`k`&&(e.preventDefault(),M?.focus()),e.key===`Escape`&&(b(j,``),b(A,!1))};return window.addEventListener(`scroll`,R,{passive:!0}),document.addEventListener(`keydown`,e),R(),()=>{window.removeEventListener(`scroll`,R),document.removeEventListener(`keydown`,e)}});var z=Oe();ie(`h05gqr`,e=>{var n=le(),i=c(n),a=x(i,2),o=e=>{var n=ce();f(()=>g(n,`content`,O.description)),t(()=>{r.title=`${O.title??``} — Polymux Docs`}),v(e,n)};w(a,e=>{O&&e(o)}),f(()=>g(i,`href`,T)),v(e,n)});var B=c(z),V=n(B),H=n(V),U=n(H),Ae=e=>{var t=ue();v(e,t)},je=e=>{var t=de();v(e,t)};w(U,e=>{d(A)?e(Ae):e(je,-1)}),u(H);var W=x(H,2),Me=n(W);a(3),u(W),u(V);var G=x(V,2),K=n(G),q=x(n(K),2);re(q),m(q,e=>M=e,()=>M),a(2),u(K);var Ne=x(K,2),Pe=e=>{var t=me(),r=n(t),i=e=>{var t=p(),r=c(t);_(r,17,()=>d(L),e=>e.slug,(e,t)=>{var r=fe(),i=n(r),a=n(i),o=n(a,!0);u(a);var s=x(a),c=n(s,!0);u(s),u(i);var l=x(i,2),p=n(l,!0);u(l),u(r),f(e=>{g(r,`href`,e),y(o,d(t).title),y(c,d(t).description),y(p,d(t).section)},[()=>I(d(t).slug)]),v(e,r)}),v(e,t)},a=e=>{var t=pe();v(e,t)};w(r,e=>{d(L).length?e(i):e(a,-1)}),u(t),v(e,t)},Fe=s(()=>d(j).trim().length>=2);w(Ne,e=>{d(Fe)&&e(Pe)}),u(G),a(2),u(B);var J=x(B,2),Ie=e=>{var t=he();D(`click`,t,()=>b(A,!1)),v(e,t)};w(J,e=>{d(A)&&e(Ie)});var Y=x(J,2),X=n(Y);let Z;var Q=n(X);_(Q,21,()=>ae,e=>e.title,(e,t)=>{var r=ve(),i=n(r),a=n(i),o=n(a,!0);u(a);var c=x(a,2);let l;u(i);var p=x(i,2),m=e=>{var r=_e();_(r,21,()=>d(t).pages,e=>e.slug,(e,t)=>{var r=ge(),i=n(r);let a;var o=n(i,!0);u(i),u(r),f(e=>{g(i,`href`,e),a=S(i,1,``,null,a,{active:O?.slug===d(t).slug}),y(o,d(t).title)},[()=>I(d(t).slug)]),v(e,r)}),u(r),v(e,r)},h=s(()=>!d(P).has(d(t).title));w(p,e=>{d(h)&&e(m)}),u(r),f((e,n)=>{g(i,`aria-expanded`,e),y(o,d(t).title),l=S(c,0,``,null,l,n)},[()=>!d(P).has(d(t).title),()=>({collapsed:d(P).has(d(t).title)})]),D(`click`,i,()=>ke(d(t).title)),v(e,r)}),u(Q),u(X);var $=x(X,2),Le=n($),Re=e=>{var t=Ce(),r=n(t);ee(r,()=>O.html,!0),u(r);var i=x(r,2),o=e=>{var t=Se(),r=n(t),i=e=>{var t=ye(),r=x(n(t)),i=n(r,!0);u(r),u(t),f(e=>{g(t,`href`,e),y(i,k.previous.title)},[()=>I(k.previous.slug)]),v(e,t)},a=e=>{var t=be();v(e,t)};w(r,e=>{k.previous?e(i):e(a,-1)});var o=x(r,2),s=e=>{var t=xe(),r=x(n(t)),i=n(r,!0);u(r),u(t),f(e=>{g(t,`href`,e),y(i,k.next.title)},[()=>I(k.next.slug)]),v(e,t)};w(o,e=>{k.next&&e(s)}),u(t),v(e,t)};w(i,e=>{(k.previous||k.next)&&e(o)});var s=x(i,2),c=n(s),l=n(c);u(c),a(2),u(s),u(t),f(e=>y(l,`© ${e??``} Polymux`),[()=>new Date().getFullYear()]),v(e,t)},ze=e=>{var t=we();v(e,t)};w(Le,e=>{O?e(Re):e(ze,-1)}),u($);var Be=x($,2),Ve=e=>{var t=De(),r=n(t),i=e=>{var t=Ee(),r=x(c(t),2);_(r,21,()=>O.toc,e=>e.id,(e,t)=>{var r=Te();let i;var a=n(r,!0);u(r),f(()=>{g(r,`href`,`#${d(t).id}`),i=S(r,1,``,null,i,{active:d(N)===d(t).id,nested:d(t).level===3}),y(a,d(t).text)}),v(e,r)}),u(r),v(e,t)};w(r,e=>{O.toc.length&&e(i)}),u(t),v(e,t)};w(Be,e=>{O&&e(Ve)}),u(Y),f(()=>{g(H,`aria-label`,d(A)?`Close documentation navigation`:`Open documentation navigation`),g(H,`aria-expanded`,d(A)),g(Me,`src`,T),Z=S(X,1,`docs-sidebar`,null,Z,{open:d(A)})}),D(`click`,H,()=>b(A,!d(A))),ne(q,()=>d(j),e=>b(j,e)),v(h,z),l()}h([`click`]),C(L,{target:document.getElementById(`app`)});