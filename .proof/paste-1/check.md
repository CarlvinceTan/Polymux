Clipboard image verification

The optional Data unwrapping fix is already present in ab79622. No product code changed in this run.

verify.sh exited 0: Go vet/test, fixture-off, 184 Swift package tests, macOS build and iOS build passed. See verify.md.

Installed and launched a copy of the worktree-built app under .build/PasteProof.app, using a temporary bundle identifier to avoid LaunchServices choosing /Applications/Polymux.app. Only the copy's Info.plist identifier changed; executable hashes match. See launch.json and installed.txt. The initial path-as-name launch returned APP_NOT_INSTALLED; registering and launching by the unique identifier resolved it before the paste test.

Loaded clipboard.png (64x64 PNG) onto the real macOS pasteboard:

```applescript
set the clipboard to (read (POSIX file "/Users/carlvincetan/code/wt/lane3-paste-1-fix-pr-186-composerview/.proof/paste-1/clipboard.png") as «class PNGf»)
clipboard info
```

clipboard.txt confirms PNGf data. Background input did not focus the composer. After exact-window foreground activation and a fresh screenshot, clicked the composer at window pixel (660,730), then sent cmd+v with cua-driver. No message was sent.

The fresh accessibility snapshot exposed exactly one button named Preview Pasted-92B44F12.png, with PNG image help. A Python assertion checked the button count and passed; assertion.json records the result. paste-light.png and paste-dark.png show the blue image attachment above the focused composer. The chip remained present when changing themes through Settings. Restored the original System theme afterward.

Verification gap: verify.sh reports readiness unavailable because apps/Polymux/PolymuxUITests/ReadinessTests.swift and the UI test target are absent from this checkout. Its output says "media: none (readiness test attachments only)" and level unit-test-verified. Thus native image paste is visually verified in both themes, but the requested combined UI-verified level and verify.sh readiness captures remain incomplete. No tests were skipped, deleted, or weakened.
