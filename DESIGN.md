# Polymux UI

Follow these rules when adding or changing UI. Reuse the app's shared components
and native controls rather than adding screen-specific interaction patterns.

## Core principle #1: every interaction responds immediately (2026-10-12, Carlvince via Chief)
Every Polymux interaction (buttons, toggles, send, menus, sidebar, settings, approvals, new chat) responds immediately and intuitively. Each press shows visible feedback and its state change on the same frame, optimistically. Backend work runs in the background; on failure the change rolls back with a clear message.
Budgets (enforced by Argus perf checks, unit argus/PERF, run by Cody):
- Feedback in the same frame (under 16 ms).
- State change visible in under 50 ms.
- No network or disk calls on the main thread (LocalCache/SQLite, file I/O, APIClient).
- No blocking spinners; background progress indicators are fine.
- Rollback on failure: restore the previous state and show a clear, specific message (with retry where it makes sense).
This principle overrides any older section of this spec that waits on the server before updating the UI.

## Text inputs

- On macOS, clicking outside an editable input clears its focus. Apply this to
  single-line fields, secure fields, search, recipients, the message composer,
  and multiline editors throughout the app, including settings and panels.
- Clicking a label or empty space outside the editing area also clears focus.
  Clicking within the input, its padding, or its editor's scroll area keeps it.
- Do not swallow clicks: buttons must still act and another input must receive
  focus on the same click. Preserve drafts and existing save/submit behaviour.
- Input-owned suggestions, such as mentions, retain focus while being selected.
  Mark these with `.inputAccessory()` so click-away does not remove the target
  before its action runs. Do not exempt unrelated controls or whole forms.
- Do not change focus in another window or treat selectable, read-only text as
  editable. Keep keyboard navigation and system text editing intact.
- Settings open without automatically focusing a field. Intentional focus for
  a task, such as starting a search or choosing recipients, remains appropriate.
- This shared handler is macOS-only. Embedded HTML, system dialogs, and iOS
  retain their existing input handling.

`InputFocus` is attached once per macOS `AppRoot` window. New native inputs in
that window inherit click-away behaviour without their own mouse monitors.
Separate app-owned windows with editable inputs must attach it as well.
`SettingsFocus` only suppresses initial settings autofocus; `SearchFocus` manages
search styling and focus notifications, not click-away dismissal.

## Panels

- Panels and their rows share one surface, `PanelSurface`: white in light mode,
  30/255 grey in dark mode. Give panel rows `.panelRow()`, never an iOS grouped
  background.
- iOS panels are always `PanelSize.maximumHeight` tall and scroll their content.
  macOS panels fit their content up to that cap.

## Edits

- An edit that is cheap to redo applies immediately: no confirmation, no undo.
- An editable item reveals its edit affordance on hover on macOS, and always on
  iOS. Do not hide it on touch platforms.

## Contrast

- Text meets at least 4.5:1 against its background. Large text (18pt, or 14pt
  bold) and meaningful non-text elements — icons, state indicators, control
  outlines — meet at least 3:1. Disabled content may be lower but must stay
  legible.
- Check the state you changed, and every state that surface can be in: resting,
  selected, focused, hovered, disabled, placeholder, dimmed or secondary text.
  A state that fails is a defect even when the resting state passes.
- Text, icons, and indicators drawn on an accent, tint, or filled selection use
  that surface's paired on-colour. Never rely on the system's automatic text
  colour: when the accent is light in dark mode, the system keeps white text and
  fails.
- Verify from the rendered result — sample the colours of the states you
  changed in a screenshot, or use the Accessibility Inspector. Token values and
  build success are not evidence.

## Visual cards

- Cards are agent-authored HTML rendered inside Polymux's bubble: inner content
  only, with no outer card wrapper, body margins, outer radius, or shadow.
- Cards use the bundled Liquid Glass components: `lg-button`, `lg-switch`,
  `lg-slider`, `lg-segmented`, `lg-panel`. Page-level glass (`lg-navbar`,
  `lg-menubar`, `lg-menu`, `lg-dock`, `lg-lens`, toasts, `createGlass`) stays
  out of cards.
- `apps/server/internal/server/html.go` owns the agent-facing contract and the
  markup lint; `apps/Polymux/Sources/Views/HTMLView.swift` owns the render shell
  (base styles, CSP, theme tokens). When upgrading
  `apps/Polymux/Sources/Resources/LiquidGlass.js`, re-check both.

## Settings copy and layout

- Keep descriptions minimal. A setting is shown by its option and the control
  that changes it: a toggle, switch, picker, or field.
- Add a description only when the setting is genuinely hard to use without one,
  such as a feature with behaviour that cannot be inferred from the control.
  Never add setup steps, commands, hostnames, or example values.
- Label a setting with the concept the user controls, in their words, not an
  internal or implementation term.
- One input per setting, left aligned. Constrain long values so they cannot
  overlap the label, the value, or the action buttons.

## Checks

Run `python3 apps/Polymux/Tests/InputTests/check_focus.py` on macOS after changing
input focus. It exercises native controls in hidden windows, including field
padding, multiline editing, input switching, suggestions, and monitor cleanup.
Build macOS and iOS after changing shared SwiftUI components. These checks do
not replace a visual check of changed layouts or a real SwiftUI interaction.

The copy and layout rules are instruction-only. The macOS click-away rule is
implemented by `apps/Polymux/Sources/Views/InputFocus.swift` and guarded by the
native focus checks above.
