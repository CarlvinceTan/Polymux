# DESIGN.md

Standing UI rules for Polymux's renderer, collected from the corrections that
have come up over and over across sessions. Read this before adding or changing
UI, and check the finished result against it — these are defaults, not requests
to wait for.

Styles live in `src/renderer/public/style.css` unless a component scopes its
own.

## Alignment: centre on centre

**In a row, everything is centred on the text's optical centre.** A row is an
icon (or favicon, status dot, avatar, chip) followed by a label, and the icon's
vertical centre must line up with the centre of the label's text — not with the
centre of the row box, which is a different line whenever the row carries extra
vertical space on one side only.

The cases that get this wrong, and the fix in each:

- **A rule under the row.** The underline belongs under the text, not under the
  icon: drop the `border-bottom` from the row, put it on the label (`flex: 1 1
  auto` so it still runs to the row's end) with a `padding-bottom` above it.
  Then cancel that padding on the icon with an equal `margin-bottom`, so the
  icon centres on the text and not halfway down to the rule. See
  `.summary-page-row` / `.summary-page-icon`.
- **A two-line row** (title plus a detail line). Centre the marker on the first
  line, not on the row — `.task-row` does this, so the dot stays put whether or
  not the second line is there.
- **An inline icon in running text.** Centre on cap height rather than the line
  box: `.link-icon` uses `vertical-align: calc(.35em - 7.5px)`.
- **A control anchored to another control** — a menu opened from a button, a
  popover, a chevron beside a label. Centre it on the thing it belongs to, not
  on the container it happens to sit in.
- **An icon-only button next to a labelled one.** Match the optical centres, not
  the box tops; a glyph with uneven internal padding needs the offset baked in.

Icons in rows sit close to their label — around 8px of gap. A larger gap reads
as two separate columns rather than one labelled item. Icons that appear in the
same strip, rail, or row set are all the same size.

## Empty and loading states

**They are centred in the space they fill.** When a view has no rows yet —
nothing loaded, nothing created, a search with no results — the placeholder text
(and any spinner or hint beside it) goes in the middle of the container, both
horizontally and vertically, not tucked at the top-left where the first row
would have been. Give the container `min-height: 100%` and centre with flex, the
way `.empty-state` does. The same applies to loading text that stands in before
content arrives: it occupies the centre of the space it is holding, so the view
does not jump when the real content replaces it.

The exception is a small fixed-height slot inside a larger panel — a section of
the Summary side panel, for instance — where the empty line is one item in a
stack and centring it would break the stack's rhythm (`.empty-row`). Centre when
the empty state owns the whole space; keep it in flow when it does not.

## No stray chrome

Default to the bare glyph or the bare text. Chrome is added deliberately, not by
habit:

- **No border or box around an icon** unless the design calls for a framed chip
  — no ring around a favicon, a `+`, an `x`, or a browser globe. When a fallback
  glyph stands in for a favicon it *replaces* it at the same size; it never gets
  nested inside the favicon's frame.
- **No grey circle or pill highlight on hover for an icon button.** The icon
  darkens instead. Where a whole row highlights, the highlight is inset — it
  must not touch a divider or the container edge.
- **Clickable text stays text** — no border, no background, no button styling.
  Hover darkens it, subtly.
- **Dividers are not edge-to-edge** and rules do not run under icons.
- **No scrollbars, anywhere.** Every scrollable area hides them
  (`scrollbar-width: none` plus `::-webkit-scrollbar { display: none }`).
- **Cut explanatory copy.** Labels and buttons carry the meaning; a sentence
  telling the user what the control does is the first thing to remove.
- Logos get a solid rounded-square border — never dotted, never dashed.

## Scrollable lists

A scrolling list fades at its top and bottom edges, and the fade at an edge
disappears once the list is scrolled hard against that edge — no fade sitting
over the first row at the top or the last row at the bottom. The settings-modal
rails are the reference implementation; match them rather than inventing a
second treatment.

Menus and submenus never overflow their container or the window: cap the height
to a few rows, make the rest scroll, and flip or shift the menu so it stays on
screen. A menu opened from a control is centred on that control.

## Text that does not fit

Rows truncate with an ellipsis; they do not wrap and they do not push the layout
wider (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap` with
`min-width: 0` on the flex item). A tooltip appears **only** when the text is
actually truncated — never as decoration on an obvious icon, never while that
control's menu is open, and on list rows only after a ~1.5s hover.

## Motion

Transitions are smooth and quiet, and nothing jumps:

- Elements cross-fade in and out rather than appearing or vanishing outright;
  even a fast fade beats a hard cut.
- A fade must not double as a move — if a piece is only meant to fade, it holds
  its position while it does.
- Nothing shifts size or position on hover unless that is the effect: labels
  inside a button stay put, text does not blur mid-transition.
- An animation that responds to state (a typing indicator, the orb, activity
  rows) stops when the state stops, and reads as varied rather than idle.
- Consecutive states hand over: the outgoing one fades out as the incoming one
  slides or fades in, timed so the arrival lands before the transition ends.

## Spacing and rhythm

Spacing within a section is uniform and deliberate — equal padding on both sides
of a list, the same gap above and below a divider, matching spacing between a
title, its description and its body. Horizontal gaps run tight; when in doubt,
reduce. When a pattern already exists elsewhere in the app (a search field's
`x`, a rail's fades, a panel's row metrics), reuse it exactly instead of styling
a near-copy.
