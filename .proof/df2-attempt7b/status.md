DF2 attempt 7b is incomplete: usable Release scroll frame-time and hitch measurements remain missing.

The required verifier built this worktree's Release macOS app using the same temporary LaunchAction patch as attempt6b. The app launched with a worktree-local data directory and the existing loopback fixture proxy. Native control failed before selecting or scrolling the long thread: two cua.getApp calls returned `Sky Computer Use native pipe startup failed`. The CLI reported no daemon at the worktree-local socket. See commands.txt for output.

A bounded two-second all-processes Animation Hitches preflight saved successfully (exit 0) and exported its table of contents (exit 0). The raw idle trace remains at .build/preflight.trace; preflight-toc.xml.gz preserves the export. It contains the frame-lifetime, render, update, and hitch schemas, but it was recorded before launching Polymux and cannot count as app scroll coverage. No frame statistics or zero-hitch claim is made.

Attempt6b captures and product source are preserved. First verification exited 1: package timing failures with the collector processing; macOS build, iOS tests, and readiness passed. The original failure table and diagnostics are in first-verify.md and package-failures.txt. Full rerun with the collector stopped exited 0 at 2026-10-14 02:18:55 SGT, full targets, UI-verified; all 204 package tests passed. The temporary scheme patch was restored afterward. See verify-summary.md for the complete table. No tests changed or weakened.

Keep PR #39 draft. No push or remote PR modification performed.
