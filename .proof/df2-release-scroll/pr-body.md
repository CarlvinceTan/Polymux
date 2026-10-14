Show agent activity as centred inline rows in chats, with icons, agent avatars, and repeated events collapsed. Agent messaging opens peer history; routine, memory, skill, subagent, and connector activity links to its associated object. Persist activity through the local cache and stream updates from the server.

Lane 4 fixes Liam's FIX at 669bd88 on top of main through #255 (`67036cb` merge, no rebase, no force-push). The accepted macOS and iOS activity captures under `.proof/df2-attempt6b/` are unchanged: tool rows, agent messaging, three collapsed searches, and a linked memory object with readable content on both platforms and themes. `testInlineActivity` now scrolls the chat until the memory row is hittable before pressing it; attempt 1's blocked click came from a macOS System Events TCC prompt over the chat pane, not from the product.

![macOS light inline activity](https://github.com/user-attachments/assets/bada485a-bf45-4680-9966-845c089dfbba)
![macOS dark inline activity](https://github.com/user-attachments/assets/40843bf6-1fc6-4f3f-ad48-19d578316671)
![iOS light inline activity](https://github.com/user-attachments/assets/749b56eb-8f96-422b-a58d-07fc8a0493d2)
![iOS dark inline activity](https://github.com/user-attachments/assets/e4eb91ec-5623-4a25-ade0-c119f94c8fac)
![macOS light linked memory](https://github.com/user-attachments/assets/af47a4c1-1ea5-4679-81bd-3fd23be16cff)
![macOS dark linked memory](https://github.com/user-attachments/assets/26880996-ab60-400f-a743-f27d68fffe15)
![iOS light linked memory](https://github.com/user-attachments/assets/b8fab784-0c7e-4182-a328-d0ef5e526088)
![iOS dark linked memory](https://github.com/user-attachments/assets/1b17005e-62df-4482-bf92-f118d5bb1f73)

`bash /Users/carlvincetan/code/proj/Polymux/scripts/verify.sh` exited **0**, full targets, **UI-verified**, on cvmini at VERIFY_DATE SGT, head `VERIFY_SHA`.

VERIFY_TABLE

**Release scroll (the open FIX point).** Armed measurement, `.proof/df2-release-scroll/measure-release-scroll.sh`: it builds the app in Release, serves the staged long thread through `.proof/df2-release-scroll/proxy.py` (100 messages and 600 activity events, collapsed to 400 activity rows), has the UI test open `t-long` and scroll up 30 then down 30 steps, and reads the CADisplayLink frame intervals logged by the new `FrameLog` hook (inert unless launched with `--verify-frame-log`). Only frames inside the scroll window count:

| metric | value |
|---|---|
| frames in the scroll window | FRAMES |
| median frame time | MEDIAN ms |
| p95 frame time | P95 ms |
| max frame time | MAX ms |
| display period (p10) | REFRESH ms |
| hitching frames (>1.5x display period) | HITCHES |
| hitch rate | RATE% |

Frame log: `.proof/df2-release-scroll/frames.log`; stats: `.proof/df2-release-scroll/scroll-stats.json`; command output: `.proof/df2-release-scroll/run.log`. The earlier app-attached Animation Hitches routes exported zero samples (`.proof/df2-attempt6b/scroll-frames.xml`, `scroll-all-command.txt`), so the numbers above come from the Release build's own display link. A Photos local-network prompt sat on the desktop during the run (`.proof/df2-release-scroll/permission-dialog.png`); it did not intercept the scrolling, and the frame log covers the whole window.

![scroll-before](https://github.com/user-attachments/assets/4b34536d-2798-4f18-b427-0f785b78cf7f)

![scroll-movement](https://github.com/user-attachments/assets/0401d5e6-de7f-46f2-8f38-eeafcec2c4e3)

Closes #121

Release Notes:

- Chat: Added inline agent activity rows (tools, messaging, memory and routines) to chats, with repeats collapsed.
