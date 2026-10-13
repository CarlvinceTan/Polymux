---
title: Drive
slug: drive
description: Work with local files, network folders, S3-compatible storage, and cloud files from an MCP server the agent installs.
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
- S3-compatible storage such as AWS S3, Cloudflare R2, Backblaze B2, or MinIO
- Cloud files through an MCP server the agent installs

Availability can depend on how a particular build was configured.

## Connect storage

Open **Settings → Drive** for a local folder, a network share, or S3-compatible storage, then arrange their priority under **Drive Configuration**. When the agent creates a file, Polymux uses the first available destination in that order.

Cloud drives are not a Polymux sign-in. Ask the agent to install that service’s MCP server. The connection belongs to you, and the files stay on your devices and in the service you connected. See [Skills and MCP](/docs/skills-and-mcp/).

Credentials for local and S3 storage are stored through the operating system’s protected credential storage.

## Work with files

Open Drive from the workspace, select a storage source, and browse or search. File filters narrow the view to documents, images, videos, or other types.

Each chat has a Polymux folder for files created during that conversation. This keeps outputs connected to the work that produced them.

## Network and S3 storage

A network folder remains listed when it is temporarily unmounted, but its contents are unavailable until the share returns. For S3-compatible storage, provide the bucket, region, credentials, and a custom endpoint when the service is not AWS. An optional prefix can confine Polymux to one folder in the bucket.
