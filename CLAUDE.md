# CLAUDE.md

The project guidance for this repo lives in [AGENTS.md](AGENTS.md). Read it
before making changes — it applies to Claude Code as written.

## UI rules — apply to every UI change

These are defaults for every change, not requests to be asked for each time.
[DESIGN.md](DESIGN.md) is the long form with the worked examples and the styles
that already get each one right — read it before writing styles for anything
non-trivial, and check the result against it afterwards.

- **Centre on centre.** An icon, favicon, dot or avatar in a row is centred on
  the *text's* centre, not the row box's. Underlines go under the text only —
  never under the icon — and the icon's offset is cancelled so it stays on the
  text's centre line. Centre a menu or popover on the control it opens from.
  Icon-to-label gap ~8px; icons in the same strip are all one size.
- **Empty and loading states are centred** in the space they fill, both axes —
  not parked at the top-left. Exception: a small in-flow slot inside a stacked
  panel.
- **No stray chrome.** No border or box around an icon; a fallback glyph
  replaces a favicon rather than nesting inside it. No grey pill/circle on icon
  hover — the icon darkens. Row highlights stay inset, never touching a divider.
  Clickable text stays text. Dividers are not edge-to-edge. **No scrollbars
  anywhere.** Cut explanatory copy.
- **Scrollable lists** fade at top and bottom, and the fade at an edge goes away
  once scrolled hard against it. Menus never overflow: cap the height, scroll
  the rest, keep them on screen.
- **Text that does not fit** truncates with an ellipsis — no wrapping, no
  widening. Tooltips only when the text is genuinely truncated, never while that
  control's menu is open, ~1.5s delay on list rows.
- **Motion** cross-fades rather than cuts; a fade never doubles as a move;
  nothing shifts or blurs on hover; state animations stop when the state does.
- **Spacing** is uniform within a section and tight horizontally. Reuse an
  existing pattern exactly rather than styling a near-copy.

The rule that matters most: **after any change to app code, confirm the app
still starts and paints.** A green `tsc`/build does not prove the renderer
mounts. Run `npm run check && npm run renderer:build && npm run test:ui`, then
`npm start`, and check the window has content before calling the work done. See
AGENTS.md for what to inspect when it comes up blank.
