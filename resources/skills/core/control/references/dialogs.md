# Dialogs

`dialog.py inspect` identifies controls/buttons in an exact native window using
`--device`, `--app`, `--app-id`, `--pid`, `--native-window-id`. It is read-only.
`resolve` requires either `--button LABEL` or one exact match attribute/value.
Choose the actual consequence from the user's authorized task; labels alone do
not add or remove authorization.

Normally resolve acquires a short exact-window lease using `--owner`. If the
calling agent already owns that same window, pass `--lock-token` to borrow it.
Borrowed ownership is neither reacquired nor released, allowing nested flows and
human help without an artificial attention handoff. A different helper app or
window is a different surface and needs appropriate coordination.

The native action wrapper fences dispatch. Dialog verification reports
`transition_observed` when the dialog closes or controls change. This is not
proof that a file saved, a payment completed, or a permission took effect; verify
the application's intended result separately. Uncertain actions must be
reconciled from live state and must not be blindly repeated. An owned unresolved
operation may remain quarantined; release failure is reported explicitly.

Missing literal capabilities (human biometric confirmation, an inaccessible
secret or an unautomatable challenge) require only that human step. Keep the
lease during the wait; the human can freely use the surface. Never foreground it
or restore an old foreground application on the human's behalf.
