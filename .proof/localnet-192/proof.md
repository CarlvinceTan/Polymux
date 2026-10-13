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
