Show agent activity as centred inline rows in chats, with icons, agent avatars, and repeated events collapsed. Agent messaging opens peer history; routine, memory, skill, subagent, and connector activity links to its associated object. Persist activity through the local cache and stream updates from the server.

DF2 attempt 6b verifies the existing product source from `785d9dd`, with DEBUG-only fixture data and real-view assertions committed locally at `b758832`. Nothing was pushed. The fixture supplies tool activity, agent messaging, three collapsed searches, and a memory object with readable content. Main through #197 remains included.

`bash /Users/carlvincetan/code/proj/Polymux/scripts/verify.sh` exited **0**, full targets, **UI-verified**, on cvmini at 2026-10-14 00:56 SGT. The macOS build used Release through a temporary LaunchAction patch; iOS tests used Debug. The scheme was restored afterward. No tests were removed or weakened. The first run exposed a comma-separated accessibility label; the corrected full rerun passed.

| step | result | tests | time |
|---|---|---|---|
| test-integrity | PASS | - | 1s |
| affected-tests | PASS | - | 8s |
| go-vet | PASS | - | 3s |
| go-test | PASS | - | 61s |
| fixture-off | PASS | - | 1s |
| packages | PASS | 204 passed, 0 failed | 9s |
| macos-build | PASS | - | 38s |
| ios-test | PASS | 2 passed, 0 failed | 84s |
| ios-ready | PASS | 2 passed, 0 failed | 90s |

macOS captures use the worktree's **Release** app and the loopback proxy. iOS captures are XCUITest attachments of real simulator views using the DEBUG fixture. Every chat capture shows a tool row, an agent-messaging row, collapsed repeats, and a linked memory row. Object captures show the result of opening that memory.

![macOS light inline activity](https://github.com/user-attachments/assets/bada485a-bf45-4680-9966-845c089dfbba)
![macOS dark inline activity](https://github.com/user-attachments/assets/40843bf6-1fc6-4f3f-ad48-19d578316671)
![iOS light inline activity](https://github.com/user-attachments/assets/749b56eb-8f96-422b-a58d-07fc8a0493d2)
![iOS dark inline activity](https://github.com/user-attachments/assets/e4eb91ec-5623-4a25-ade0-c119f94c8fac)
![macOS light linked memory](https://github.com/user-attachments/assets/af47a4c1-1ea5-4679-81bd-3fd23be16cff)
![macOS dark linked memory](https://github.com/user-attachments/assets/26880996-ab60-400f-a743-f27d68fffe15)
![iOS light linked memory](https://github.com/user-attachments/assets/b8fab784-0c7e-4182-a328-d0ef5e526088)
![iOS dark linked memory](https://github.com/user-attachments/assets/1b17005e-62df-4482-bf92-f118d5bb1f73)

Release scroll trace: the Release app replayed **700 events** (100 messages and 600 activity events, collapsed to 400 activity rows) before native scrolling. A 20-second app-attached Animation Hitches recording saved successfully, but its exported frame-lifetime, render, update, and hitch tables each contain **0 samples**. Frame-time median/p95/max and hitch rate are **unmeasured**. Empty coverage does not establish zero hitches.

A compositor-inclusive retry (--all-processes, requested 20 seconds, 24 native scroll actions) exited **250** after Cannot save trace document and an uncaught NSException. Command output is preserved in .proof/df2-attempt6b/scroll-all-command.txt, with empty exports in scroll-frames.xml. The retry exhausted local disk space; its failed data and idle preflight data were removed. The valid app-attached raw trace remains at .build/scroll.trace.

**DF2 remains incomplete: usable Release frame-time and hitch measurements are still missing.** The platform/theme captures and full verify.sh run are complete.



![scroll-before](https://github.com/user-attachments/assets/4b34536d-2798-4f18-b427-0f785b78cf7f)

![scroll-movement](https://github.com/user-attachments/assets/0401d5e6-de7f-46f2-8f38-eeafcec2c4e3)

DF2 attempt 7b: this worktree rebuilt Release through the required verifier. A bounded compositor preflight saved and exported successfully (exit 0), resolving the prior save failure, but native control failed twice with `Sky Computer Use native pipe startup failed`. No long-thread scroll could be performed or verified. The preflight was idle and is not scroll coverage. Median/p95/max frame time and hitch rate remain **unmeasured**; DF2 remains **incomplete** and PR #39 should remain **draft**. Command output and compressed table export are preserved under `.proof/df2-attempt7b/`; existing captures remain unchanged.

The first verification failed package timing checks while the collector processed. With profiling idle, `bash /Users/carlvincetan/code/proj/Polymux/scripts/verify.sh` exited **0**, full targets, **UI-verified**, at 2026-10-14 02:18:55 SGT:

| step | result | tests | time |
|---|---|---|---|
| test-integrity | PASS | - | 1s |
| affected-tests | PASS | - | 9s |
| go-vet | PASS | - | 4s |
| go-test | PASS | - | 75s |
| fixture-off | PASS | - | 1s |
| packages | PASS | 204 passed, 0 failed | 8s |
| macos-build | PASS | - | 2s |
| ios-test | PASS | 2 passed, 0 failed | 45s |
| ios-ready | PASS | 2 passed, 0 failed | 30s |

The temporary Release LaunchAction patch was restored. No product source or tests changed. This body is a local review artifact; no push or remote PR edit was performed.

Release Notes:

- Desktop: Added inline agent activity rows in chats.
