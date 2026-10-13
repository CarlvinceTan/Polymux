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
