---
name: pdf
description: Read, create, edit, extract, render, and verify PDF files, including forms and scanned pages. Use whenever PDF content or page layout is central to the request.
allowed-tools: read write edit bash
author: Midas
category: Documents
---

# PDF

Treat a PDF as both structured content and a rendered artifact.

## Workflow

1. Inspect metadata, page count, text availability, and whether pages are
   scanned or digitally generated.
2. Use installed tools such as `pdftotext`, `pdfinfo`, `pdftoppm`, `pypdf`,
   `pdfplumber`, or `reportlab` according to the task. Check availability first.
3. Use OCR only for pages that need it and clearly mark uncertain text.
4. Preserve the source by default; write edits to a new output file.
5. Render every changed or created page and inspect it for clipping, incorrect
   page size, missing fonts, misplaced form values, and unreadable content.
6. Reopen the final PDF and verify its page count and expected text before
   reporting completion.

Do not alter a PDF for a read-only question. Never invent text that extraction
or visual inspection cannot establish.

