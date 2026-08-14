---
name: spreadsheets
description: Create, inspect, analyze, edit, and verify spreadsheet files including XLSX, XLS, CSV, and TSV. Use for formulas, tables, charts, financial models, data cleaning, and workbook-based analysis.
allowed-tools: read write edit bash
author: Midas
category: Documents
---

# Spreadsheets

Keep workbooks correct, auditable, editable, and visually readable.

## Workflow

1. Inspect sheet names, used ranges, formulas, formats, tables, charts, and
   hidden structure before editing.
2. Use an installed spreadsheet library appropriate to the format. Check first;
   do not install dependencies without permission.
3. Preserve established styling and formula patterns. Make the smallest change
   that satisfies an edit request.
4. Store numbers, dates, percentages, and currency as typed values with number
   formats, not display strings. Put derived results in formulas and keep
   assumptions in visible cells.
5. Extend formulas, references, conditional formatting, tables, and charts when
   added rows or columns require it.
6. Scan for formula errors and reconcile important totals.
7. Render or preview every affected sheet and fix clipping, unreadable columns,
   broken charts, and accidental blank sheets.
8. Reopen the final workbook and verify key values and formulas before reporting
   success.

For read-only questions, trace the relevant formula and its inputs without
changing or exporting the workbook.

