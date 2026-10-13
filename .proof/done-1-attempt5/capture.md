DONE-1 attempt 5 — incomplete

- Built and tested with `bash /Users/carlvincetan/code/proj/Polymux/scripts/verify.sh`; exit 0. See verify-summary.md. The harness reports unit-test-verified and no media: its ReadinessTests.swift is absent.
- Installed `.build/DD/Build/Products/Debug/Polymux.app` into `/Applications/Polymux.app` with ditto and launched using cua-driver 0.34.1 on cvmini.local.
- Submitted a short Echo turn to the live server. turn.json records the assistant reply with status done.
- No finished-turn alert was captured. desktop-after-turn.png is the actual desktop after completion, not alert proof. notification-error.png shows the app's notification error.

Live commands and evidence:

`cua-driver get_window_state '{"pid":55237,"window_id":3899,"session":"done-1-attempt5","include_screenshot":false,"query":"notification"}'`

Output includes `AXStaticText = "Couldn’t update notification permission."` (notification-state.txt).

`/usr/bin/log show --last 10m --style compact --predicate 'process == "Polymux" AND subsystem == "com.apple.UserNotifications"'`

Output includes `Requested authorization [ didGrant: 0 hasError: 1 hasCompletionHandler: 1 ]` (authorization.log).

`cua-driver get_desktop_state '{"session":"done-1-attempt5","screenshot_out_file":"/Users/carlvincetan/code/wt/lane3-done-1-fix-pr-181-real-capture-o/.proof/done-1-attempt5/desktop-after-turn.png"}'`

Full output is desktop-state.json. Capture succeeded at 1920×1080. System prompts were left untouched. Saved serverAddress remained http://127.0.0.1:20755; the displayed draft was restored to that value.

No product changes, push, or PR update. Required alert proof and UI-verified level remain unmet.
