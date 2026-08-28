---
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
