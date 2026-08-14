---
name: documents
description: Create, inspect, edit, and verify Word-compatible documents, especially DOCX files. Use for reports, letters, proposals, templates, redlines, comments, or any task where document structure and rendered layout matter.
allowed-tools: read write edit bash
author: Midas
category: Documents
---

# Documents

Work from the user's requested format and preserve an existing document's
styles, sections, headers, footers, tables, and numbering unless asked to
redesign them.

## Workflow

1. Inspect the source document and identify its structure before editing.
2. Prefer `python-docx` or an equivalent installed library for DOCX work.
   Check availability before relying on it; do not install dependencies without
   permission.
3. Keep edits targeted. Use native headings, lists, tables, links, comments,
   and page breaks rather than visual approximations.
4. Save a new file unless the user explicitly requests an in-place edit.
5. Render the final document to PDF or page images when supported, inspect
   every page, and repair clipping, overflow, broken tables, orphan headings,
   and inconsistent spacing.
6. Verify the final file exists and can be reopened before reporting success.

For read-only questions, inspect and answer without changing the document.

