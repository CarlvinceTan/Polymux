# LOCALNET-1 PR 192 — attempt 7

Start: `91c35b4ca15d5876f57d5115c4196a0f4d3b5e2f`.
The existing port-zero loopback fix is unchanged. Evidence collection is pending.

## Stream limitation

Command: `/usr/bin/log stream --predicate 'composedMessage CONTAINS "LocalNetwork" AND process != "log"' --style compact`

Observed exit 0 in 0.008 seconds; output only:

```text
Filtering the log data using "composedMessage CONTAINS "LocalNetwork" AND process != "log""
Timestamp               Ty Process[PID:TID]
```

This is not a live stream or a zero-event proof. Use bounded persistent-store
queries with the same predicate, as authorized by the attempt-7 brief.

Builds and tests will run only through the required verify.sh command.

## Positive-control attempts

All queries use the predicate above and explicit start/end timestamps.

- `fresh unsigned copy of /usr/bin/dns-sd -B _polymux._tcp local.`; window `2026-10-13 23:30:13` through `2026-10-13 23:30:13`.
  Output: `.build/localnet/control.out`; store query: `.build/localnet/control.log`; matching events: 0 (one header line).

- `/usr/bin/dns-sd -B _polymux._tcp local.`; window `2026-10-13 23:30:31` through `2026-10-13 23:30:39`.
  Output: `.build/localnet/dnssd.out`; store query: `.build/localnet/dnssd.log`; matching events: 0 (one header line).

- `/usr/bin/python3: send mDNS PTR query to 224.0.0.251:5353`; window `2026-10-13 23:30:57` through `2026-10-13 23:31:00`.
  Output: `.build/localnet/udp.out`; store query: `.build/localnet/udp.log`; matching events: 0 (one header line).

- `fresh ad-hoc-signed copy of dns-sd -B _polymux._tcp local.`; window `2026-10-13 23:31:23` through `2026-10-13 23:31:34`.
  Output: `.build/localnet/control-signed.out`; store query: `.build/localnet/control-signed.log`; matching events: 0 (one header line).

- `fresh UUID and ad-hoc identity: dns-sd -B _polymux._tcp local.`; window `2026-10-13 23:32:08` through `2026-10-13 23:32:19`.
  Output: `.build/localnet/fresh.out`; store query: `.build/localnet/fresh.log`; matching events: 0 (one header line).

- `fresh UUID and ad-hoc identity: bash launches Python UDP multicast`; window `2026-10-13 23:32:38` through `2026-10-13 23:32:42`.
  Output: `.build/localnet/bash.out`; store query: `.build/localnet/bash.log`; matching events: 0 (one header line).

UDP control output (exit 0):

```text
Sent mDNS PTR query to 224.0.0.251:5353
Timestamp               Ty Process[PID:TID]
```

Unsigned copied dns-sd exited 137; the other dns-sd controls reached the 8-second alarm (142). Fresh bash exited 0 and printed `16` bytes sent.

Historical sanity query (not current positive-control proof):

`/usr/bin/log show --start "2026-10-13 21:42:20" --end "2026-10-13 21:42:25" --predicate 'composedMessage CONTAINS "LocalNetwork" AND process != "log"' --style compact` returned the three previously recorded UserEventAgent attribution lines. The store is readable.

Full verification started at `2026-10-13 23:30:40` with `VERIFY_TARGETS=full bash /Users/carlvincetan/code/proj/Polymux/scripts/verify.sh`; output `.build/localnet/verify-before.out`. Result pending.

## Upstream merge scope

`git fetch origin main` succeeded; fetched main is `8b204d0`.
`git diff --stat HEAD...origin/main` reports:

```text
10 files changed, 336 insertions(+), 9 deletions(-)
```

Those 345 upstream changed lines alone exceed the run's 300-line cap.
The requested merge is pending clarification of the permitted Size-reason
exception; no upstream files have been removed or rewritten to fit the cap.

## Fresh Python control

A copy of the installed Python 3.12 executable received a fresh Mach-O UUID and ad-hoc signature (`localnet.attempt7.python`); no source was compiled.
Command (with PYTHONHOME pointing to the installed Python distribution):

```sh
.build/localnet/python-fresh -c 'import socket,time; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); print(s.sendto(b"\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x08_polymux\x04_tcp\x05local\x00\x00\x0c\x00\x01",("224.0.0.251",5353)), flush=True); time.sleep(5)'
```
Window: `2026-10-13 23:35:32` through `2026-10-13 23:35:38`; exit 0. Output `.build/localnet/python.out` and `.build/localnet/python.log`:

```text
37
Timestamp               Ty Process[PID:TID]
```

Matching events: **0**; raw store output has **1** header line. This is a failed positive control, not proof of absent LocalNetwork activity.

The fresh Go control is pending clarification: the brief explicitly recommends `go test -c -tags mdns`, but its final rule requires builds/tests only through the canonical `verify.sh`. No direct Go build/test was run.

## Full verification result

Command: `VERIFY_TARGETS=full bash /Users/carlvincetan/code/proj/Polymux/scripts/verify.sh` (foreground).

Output: `.build/localnet/verify-before.out`; exit **0**.
Store window: `2026-10-13 23:30:40` through `2026-10-13 23:37:05`.

```sh
/usr/bin/log show --start "$(cat .build/localnet/verify-before.start)" --end "$(cat .build/localnet/verify-before.end)" --predicate 'composedMessage CONTAINS "LocalNetwork" AND process != "log"' --style compact > .build/localnet/verify-before.log 2>&1
wc -l .build/localnet/verify-before.log
```

Raw output: **1 line**, the header below; matching event count: **0**.

```text
Timestamp               Ty Process[PID:TID]
```

No events to attribute to a process. Controls also ran during this window; this is not an isolated post-positive-control verification. Without a successful positive control, zero matching events do not establish the requested LocalNetwork proof.

Verification started at `9869726`; evidence-only commits were made during the run to satisfy the lane heartbeat. The summary identifies `0903bbe`, the HEAD at summary generation; no source/test changes occurred during verification.

## verify.sh: PASS
commit `0903bbe` on cvmini, 2026-10-13 23:36:39 +08, worktree lane3-localnet-1-fix-pr-192-at-91c35b4
targets: full
level: **unit-test-verified**, ready (chats.list + 12 sidebar rows + waits): unavailable

| step | result | tests | time |
|---|---|---|---|
| test-integrity | PASS | - | 0s |
| affected-tests | PASS | - | 1s |
| lane-tests | PASS | - | 186s |
| merge-queue-tests | PASS | - | 7s |
| go-vet | PASS | - | 1s |
| go-test | PASS | - | 57s |
| fixture-off | PASS | - | 2s |
| packages | PASS | 184 passed, 0 failed | 22s |
| macos-build | PASS | - | 24s |
| ios-build | PASS | - | 35s |

media: none (readiness test attachments only)
evidence: /Users/carlvincetan/verify-evidence/lane3-localnet-1-fix-pr-192-at-91c35b4/20261013-233639-0903bbe

## Remaining work

- Obtain a real current positive-control event. Clarification requested for the listed direct Go build/test control versus the final verify.sh-only rule.
- Merge fetched `origin/main` and verify the merged head. Clarification requested for the size exception because upstream alone adds 345 changed lines.
- No push, PR creation, PR comment, or source behavior change was made.
