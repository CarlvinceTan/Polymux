Show agent activity as centred inline rows in chats, with icons, agent avatars, and repeated events collapsed. Agent messaging rows open peer history or a bots popover; routine, memory, skill, subagent, and connector activity links to its associated object. Persist activity through the local cache and stream updates from the server.

The current diff includes activity emission/storage, U15–U17 server evals, collapse/cache/transport tests, shared activity and history views, and snapshot rendering checks. Main through #197 is merged locally at cd1422d; this run has not been pushed.

Verification evidence is in `.proof/df2-attempt5/`. `verify.sh` exited 0 at cd1422d with UI-verified readiness: 204 package tests passed, macOS built, and iOS tests/readiness passed. The summary, ready.json, and two readiness screenshots are committed there. This PR remains incomplete: readiness sidebar screenshots alone do not verify inline activity; light/dark macOS/iOS activity captures and a Release scrolling frame-time trace are still required. Frame times and hitches are unmeasured. Earlier headless snapshots and Debug builds do not satisfy those requirements.

The mandatory main merge contributes 1,360 additions and 288 deletions against this run's start, already exceeding its 300-line cap. No new product behaviour is authored in this run.

Release Notes:

- Desktop: Added inline agent activity rows in chats.
