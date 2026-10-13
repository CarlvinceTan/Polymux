Starting a chat or creating an agent publishes an optimistic sidebar row immediately and keeps the New Chat form usable while the server responds. Successful creation reconciles the local row with the server ID and re-keys any queued messages; a failed creation removes the optimistic row, keeps queued message text, and shows the failure both in the panel and as a sidebar notice.

The change includes `NewChatView`, `ShellView`, `ChatStore`, `InstantChat`, `SidebarStore`, and the instant-send/new-chat tests, plus a `DICTATION_CHECK`-only hook used by the offscreen check harness. `SidebarStore.resolved()` waits on continuations resumed by `replaceStaged`/`dropStaged` instead of polling every 10 ms. ChatStore and SidebarStore could both flush the outbox and send one queued message twice; both now go through `LocalCacheActor.deliver`, which uses in-flight dedupe plus a pending check. `overlappingDeliveriesSendOnce` covers overlapping deliveries and a late call with a stale outbox snapshot. `InstantSend` and `InstantUINewChat` run serialized under `InstantTiming`.

Verification at `7e30aff`: `scripts/verify.sh` **PASS**, level **UI-verified**. Run: 2026-10-14 02:39:43 +08 on cvmini; targets: affected (go: ./...; swift: all; app: 1). Ready (chats.list + 12 sidebar rows + waits): yes.

| step | result | tests | time |
|---|---|---|---|
| test-integrity | PASS | - | 0s |
| affected-tests | PASS | - | 2s |
| go-vet | PASS | - | 1s |
| go-test | PASS | - | 58s |
| fixture-off | PASS | - | 1s |
| packages | PASS | 35 passed, 0 failed | 9s |
| macos-build | PASS | - | 2s |
| ios-test | PASS | 1 passed, 0 failed | 27s |
| ios-ready | PASS | 1 passed, 0 failed | 16s |

Evidence: `/Users/carlvincetan/verify-evidence/lane4-df7-fix-pr-42-nc-instanttiming-s/20261014-023943-7e30aff`, recorded in [verification comment](https://github.com/CarlvinceTan/Polymux/pull/42#issuecomment-6152590101). Media: `ready-141DAF4C-3EE9-4AE4-9644-3CE0FC154836.png` and `ready-8DDAFDE4-0BF5-479A-9B20-9EE735E82D0A.png`; media upload failed. "Validate release note" is green at `7e30aff`.

UI evidence is committed under `.proof/pr42-nc-20261013/`: Release-build captures of the New Chat panel idle and with the error shown, the sidebar notice after a failure, and the optimistic row while the create POST is stalled, light and dark, on macOS (real app window) and iOS (real views/stores in the booted simulator; this host has no Simulator UI and the checkout has no XCUITest target). `tap-trace-mac.txt` and `tap-trace-ios.txt` carry the tap-to-visible InstantUI signpost intervals from the running app (0.04-0.15 ms against the 16/50 ms budgets); `run.log` and `summary.md` carry commands, timestamps, ordering proof and limits. Frame-level display-link latency is not measured.

Release Notes:

- Hub: Improved new chats to appear immediately and show a message if creation fails.
