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

Check the rendered glyph as well as its box. A small optical correction, such
as a 1px horizontal or vertical offset, is appropriate when uneven glyph
padding makes correct layout look off-centre. Fix layout first, then keep any
necessary correction in the shared icon or control style with its reason.
Do not scatter per-instance offsets or move the surrounding controls to
compensate. Keep text baselines aligned across neighbouring labelled controls.

## Icon consistency

Use the existing icon family and shared icon treatment. Icons in the same
control group match in size, stroke thickness, and perceived weight; equal
bounding boxes alone do not guarantee a visual match. Preserve brand artwork,
but give it consistent placement and scale beside other icons. Reuse the same
glyph for the same action across surfaces. Verify icons at their actual
rendered size, including optical corrections, in both themes.

## Light and dark themes

Use existing theme-aware colour tokens for text, icons, surfaces, borders,
dividers, placeholders, and interaction states. Avoid hard-coded colours that
only work on one background. Text and icons must remain readable against their
actual surface in both themes, including menus, overlays, loading states, and
selected rows. Muted and disabled content should remain identifiable.

Hover increases foreground contrast appropriately for the theme; it does not
always mean making the colour darker. Focus and selection must remain visible
without relying only on a subtle colour shift. Check theme switching with the
affected menus or panels open so stale colours and mismatched surfaces show up.

## Loading skeletons and placeholder states

**Skeletons follow the layout of the components they replace.** Match the
expected rows, text lines, icons or avatars, media shapes, widths, heights, and
spacing using the same layout constraints as the loaded content. Keep them in
the content's eventual position; do not centre a skeleton that represents a
top-aligned list or substitute generic bars for a different component shape.
Reserve predictable space so content arriving does not shift neighbouring UI.
Compare the skeleton with the loaded state at normal and narrow widths.

**Standalone placeholder messages default to the horizontal and vertical centre
of the space they fill.** This includes loading text, empty views, no search
results, and warning or error messages that replace unavailable content. When
there is substantial unused space, centre the message and any related spinner,
hint, or action as a group within that content area, not the entire window.
Ensure the container actually fills the available area before centring it with
flex or grid; `.empty-state` is the reference pattern.

Use the scenario to choose exceptions. A small section in a larger panel may
keep its empty line in the stack's rhythm (`.empty-row`). Field validation stays
beside its field, and a warning accompanying usable content stays near that
content. Do not force these into the centre or reserve a large empty area for
them. Judge whether the message replaces the area's content or supports an
existing control, and follow the closest established pattern.

## No stray chrome

Default to the bare glyph or the bare text. Chrome is added deliberately, not by
habit:

- **No border or box around an icon** unless the design calls for a framed chip
  — no ring around a favicon, a `+`, an `x`, or a browser globe. When a fallback
  glyph stands in for a favicon it *replaces* it at the same size; it never gets
  nested inside the favicon's frame.
- **No grey circle or pill highlight on hover for an icon button.** The icon
  gains foreground contrast instead. Where a whole row highlights, the
  highlight is inset — it must not touch a divider or the container edge.
- **Clickable text stays text** — no border, no background, no button styling.
  Hover subtly increases foreground contrast for the current theme.
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
screen. A menu opened from a control is centred on that control when space
permits; keeping it on screen takes priority at an edge.

## Text that does not fit

Rows truncate with an ellipsis; they do not wrap and they do not push the layout
wider (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap` with
`min-width: 0` on the flex item). A tooltip appears **only** when the text is
actually truncated — never as decoration on an obvious icon, never while that
control's menu is open, and on list rows only after a ~1.5s hover.

## Tooltips

**Tooltips are short: one word where one word names the control, and never a
sentence.** `data-tooltip-label` is a glance, not an explanation — `Add`,
`Sort`, `Filter`, `Chats`, `Settings`. Put the fuller, specific wording in
`aria-label`, which is read out and has room for it; the visible tooltip and the
accessible name do not have to match. A canonical surface name may run a little
longer when no shorter word names it (`Plugin Marketplace`), but do not restate
a label already visible beside the control, and do not turn the tooltip into
copy that explains what the control does.

## Layout bounds and overflow

At normal and narrow widths, long content must not overlap neighbouring text,
icons, actions, or panel boundaries. Let the text area shrink while preserving
the space and hit targets of adjacent controls. Define which content truncates,
clips, or scrolls; do not hide overflow on a parent just to conceal a layout bug
or accidentally clip menus and focus indicators.

When a badge must clip, clip the whole badge, including its border and
background. Do not add a fade unless the established pattern calls for it.
Popovers and submenus stay within the available viewport and clear adjacent
controls and resize handles. Check content extremes and open overlays after
resizing, not just the initial layout with short labels.

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

Keep shared control geometry consistent across loading, selected, hover, focus,
and completed states. Reserve space for changing metrics and status icons so
updates do not shift neighbouring controls. Expanding a row may reveal content,
but its first-line marker and actions stay aligned. On completion or failure,
clear transient animation, dragging opacity, and other active-only treatments.

## Spacing and rhythm

Spacing within a section is uniform and deliberate — equal padding on both sides
of a list, the same gap above and below a divider, matching spacing between a
title, its description and its body. Horizontal gaps run tight; when in doubt,
reduce. When a pattern already exists elsewhere in the app (a search field's
`x`, a rail's fades, a panel's row metrics), reuse it exactly instead of styling
a near-copy.

Reuse the actual shared component, class, or token where one exists. Search for
the established implementation before adding local CSS. If a repeated pattern
needs a correction, make it in the shared implementation and check its affected
callers. Keep equivalent row heights, label gaps, padding, divider insets, and
control treatments consistent across panels; avoid near-duplicate components
that drift independently.
