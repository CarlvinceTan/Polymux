# Standalone WeChat client experiment handoff

Last updated: 2026-09-01

This document is the continuation guide for the standalone personal-account
WeChat experiment. The goal is to determine whether Polymux can authenticate,
sync, and message as a personal WeChat client without launching, attaching to,
or depending on WeChat Desktop.

This is research code, not a production bridge. Work from verified evidence and
keep each boundary separate:

`transport -> QR challenge -> phone approval -> authenticated session -> initial sync -> messaging`

A successful earlier boundary does not prove any later boundary.

## Workspace

- Worktree: `/Users/carlvincetan/code/polymux-wechat-client`
- Branch: `feature/wechat-client`
- Experiment: `experiments/wechat-standalone/`
- The experiment is isolated on `feature/wechat-client`. Preserve that branch
  boundary while continuing the research.
- Older logs or notes may refer to the previous worktree name
  `Polymux-wechat-standalone`; that is the same line of work.

Do not run the ordinary Polymux app for this protocol experiment. None of the
verified work so far required WeChat Desktop or Polymux's GUI.

## Current result

The standalone transport and native QR approval flow work. A phone can scan and
approve the QR, and the server supplies a regional short-link endpoint. The
subsequent native manual-authentication request is rejected, so **no personal
WeChat session has been established**.

The exact current rejection is:

```text
Native session establishment failed with -106
你的应用版本过低，请升级至最新版本后再登录。点击“确定”后将跳转至最新版下载页面。
```

The Chinese message says that the application version is too old and should be
upgraded. That message does not prove that the top-level version integer is the
only mismatch; other device, build, attestation, or trust fields may contribute.

## Verified live evidence

| Boundary | Status | Evidence |
| --- | --- | --- |
| Standalone TCP/MMTLS transport | Verified | Fresh P-256 MMTLS handshake with `long.weixin.qq.com:80` |
| Server identity at the long-link boundary | Verified | Server signing key checked before application traffic was accepted |
| Encrypted transport traffic | Verified | Application keys derived, resumption tickets received, encrypted heartbeat exchanged |
| Native personal-client QR issuance | Verified | Tencent returned a QR challenge and image |
| Phone scan | Verified | Polling emitted `nativeQrState: "scanned"` with `serverRet: 0` |
| Phone approval | Verified | Polling emitted `nativeQrState: "approved"` with `serverRet: 0` |
| Regional routing | Verified | Server-signed redirect assigned `129.226.3.47`; regional MMTLS handshake succeeded in HTTP mode |
| Manual authentication | Blocked | Regional server returned `-106` and the version-too-old message |
| Session persistence | Implemented but unexecuted | `native-session.json` is written with mode `0600` only after authenticated success |
| Initial account sync | Not implemented | No sync cursor, contacts, groups, or conversations obtained |
| Sending/receiving messages | Not implemented | No live message was sent or received |

The test account was new and had no contacts or chats. No personal identifiers,
contacts, history, or messages were obtained by this experiment.

## What is implemented

| File | Purpose |
| --- | --- |
| `mmtls.mjs` | Long-link MMTLS handshake, key schedule, records, tickets, heartbeat |
| `mmtls-short.mjs` | Short-link request binding and MMTLS/HTTP transport |
| `native-auth.mjs` | Native QR, poll, manual-auth encoding/decoding, hybrid encryption |
| `native-qr-probe.mjs` | End-to-end native QR probe through approval and manual authentication |
| `probe.mjs` | Standalone transport probe |
| `web-qr.mjs` / `web-qr-probe.mjs` | Legacy Web WeChat QR challenge diagnostics |
| `web-login.mjs` | Legacy Web WeChat scan/approval polling experiment |
| `mmtls.test.mjs` | Offline protocol and boundary tests |
| `auth-readiness.mjs` | Readiness summary; currently stale and needs updating |
| `README.md` | Initial experiment notes; currently stale after the live native-auth work |

The package scripts currently include:

```sh
npm run test:wechat-standalone
npm run experiment:wechat-standalone
npm run experiment:wechat-auth-challenge
npm run experiment:wechat-login
npm run experiment:wechat-native-qr
```

The last offline run passed all 14 tests. They cover:

- RFC-compatible HKDF and encrypted MMTLS records;
- client/server hello details and session tickets;
- exact short-link request binding;
- native QR request and polling;
- zero-length QR notify payloads;
- separation of account and device sections in manual authentication;
- acceptance of only server-signed short-link redirects;
- separation of transport success from authentication success; and
- strict legacy Web WeChat QR and login-state parsing.

## Current blocker: manual authentication

### Known facts

- QR creation, polling, scan, approval, and regional redirect all complete.
- The rejection comes after the approved QR is converted into a
  `secmanualauth` request at the regional endpoint.
- The logs also contained `ccd deviceToken err`.
- The regional transport was refreshed after redirect and its response was
  decrypted and parsed successfully. This is an application-authentication
  failure, not merely a TCP or MMTLS failure.
- The current client version constant is `0x18004c2a` and the current device
  type string is `iPad Air iPadOS18.8.1`.

### Version attempts already made

- `0x18003b20` (8.0.59 representation): rejected.
- Guessed `0x18004c20` (8.0.76 representation): rejected.
- `0x18004c2a`, supported by public WeChat iOS 8.0.76 user-agent evidence:
  rejected even after rebuilding the device-attestation helper with the same
  value.

Do not repeat random version bumps without first proving which encoded fields
the server evaluates.

### Still unknown

The rejection may involve one or more of:

- a newer server-required client/build value;
- inconsistent version values between the base request, QR request, polling,
  manual-auth fields, and generated `extSpam`/`softType` data;
- device-token registration or trust setup, especially given
  `ccd deviceToken err`;
- a synthetic device fingerprint that is internally inconsistent;
- account- or region-specific policy; or
- opaque attestation fields not reproduced by the current helper.

Do not present any one of these as the confirmed cause until an isolated test
changes the server result.

## Recommended next work

### P0: diagnose the rejected manual-auth request

1. Update `README.md` and `auth-readiness.mjs` so they no longer say native QR
   approval was unattempted or unimplemented.
2. Add a redacted, structured diagnostic for every client version, build,
   device, region, bundle, OS, sequence, and token-presence field used in:
   - the base request;
   - native QR creation;
   - QR polling;
   - `secmanualauth`; and
   - generated `extSpam` and `softType` data.
3. Log field names, lengths, fixed metadata, and cryptographic hashes only.
   Never log QR-approved username/password material, session keys, cookies,
   raw attestation blobs, or full device identifiers.
4. Compare those fields for internal consistency before trying another QR.
5. Trace `ccd deviceToken err`: determine whether a separate device-token or
   trust-registration request must precede manual authentication.
6. Refresh public evidence for the current official iOS/iPad client version
   when the work resumes. Version information is time-sensitive.
7. Change one material variable at a time and record the exact server result.
   Generate a fresh QR only after a justified request change.

Success for P0 is either an authenticated `ret: 0` response or a narrower,
reproducible rejection whose controlling field/request has been isolated.

### P1: establish and safely persist a session

1. Parse and validate the full successful manual-auth response.
2. Verify the account identifier, cookies, session keys, and transport tickets
   are present without printing their values.
3. Exercise the existing `native-session.json` path and verify owner-only
   directory and file permissions (`0700`/`0600`).
4. Add sanitized response fixtures and failure tests.
5. Define expiry, refresh, logout, and deletion behavior before integrating the
   session into Polymux.

Success for P1 requires a fresh process to resume the authenticated session
without another QR and without WeChat Desktop.

### P2: implement initial sync

1. Implement the post-login initialization/new-sync exchange.
2. Persist and advance the sync cursor safely.
3. Confirm the empty/new account case without assuming at least one contact or
   conversation exists.
4. Parse contacts, groups, and recent conversations only after the server
   returns them.
5. Prove incremental sync and restart recovery.

Success for P2 requires an authenticated server response and a stable sync
cursor. An empty account may legitimately return no contacts or chats.

### P3: message send and receive

1. Add receive/sync verification before claiming bridge parity.
2. Use only a dedicated disposable test account and an explicitly approved
   destination. Prefer File Transfer (`filehelper`) if the account exposes it.
3. Send a unique harmless test message, observe the server acknowledgement,
   and verify it arrives again through sync/readback.
4. Add idempotency, retry, ordering, and duplicate-handling tests.

Do not send to arbitrary contacts, and do not claim messaging works from a
request acknowledgement alone.

### P4: production hardening and Polymux integration

1. Replace the opaque RQTX and device-attestation helpers with understood,
   auditable implementations or a legitimate supported interface.
2. Establish production-grade provenance and rotation handling for all pinned
   server verification keys. The regional key is currently experiment-only.
3. Add rate limits, explicit account-risk warnings, secret storage, session
   revocation, and failure recovery.
4. Add the authenticated standalone client behind Polymux's bridge abstraction
   only after session resume and initial sync work independently.
5. Keep Tencent iLink/OpenClaw support conceptually separate: it pairs a bot
   identity and is not ordinary personal-account access to contacts, groups,
   and chat history.

## Safe runbook

### Offline verification

```sh
cd /Users/carlvincetan/code/polymux-wechat-client
npm run test:wechat-standalone
git diff --check
```

### Standalone transport only

```sh
npm run experiment:wechat-standalone
```

This contacts WeChat but does not authenticate an account.

### Native QR through phone approval

First verify the helper container is the intended air-gapped container:

```sh
docker inspect --format '{{.HostConfig.NetworkMode}}' polymux-rqtx-airgap
```

The result must be exactly `none`. Then, only with explicit approval to run a
new live account attempt:

```sh
node experiments/wechat-standalone/native-qr-probe.mjs \
  --live \
  --poll \
  --rqtx-airgap polymux-rqtx-airgap \
  --short-host hkshort.weixin.qq.com
```

Expected current progression:

1. JSON reports `nativeQrChallenge: "verified"` and a private temporary image
   path.
2. The user manually scans and approves the QR.
3. JSON reports `scanned`, then `approved`.
4. A server-assigned regional host may be reported.
5. Manual authentication currently ends with `-106`.

Do not automate the phone or repeatedly ask the user to rescan when the request
bytes have not materially changed. Phone mirroring was unreliable in the prior
attempt and is not the protocol blocker.

## Security and trust boundaries

- The RQTX helper is permitted only inside a Docker container whose network
  mode is `none`. It receives only the MD5 digest of an already encrypted
  request, never account data or session keys.
- The attestation helper receives a synthetic/derived device ID and username
  length, not the actual QR-approved username or password.
- QR-approved account material stays in Node and is hybrid-encrypted before
  network transmission. Never print or persist it outside the encrypted
  session path.
- The regional MMTLS key was recovered consistently from two independent
  regional signatures and is accepted only after a redirect delivered through
  the pinned long-link transport. It was not independently extracted from an
  official iPad client, so this is not production-grade trust.
- The helper implementations and third-party protocol sources are research
  inputs. Do not ship or redistribute opaque artifacts without provenance,
  license review, and a clean-room replacement where necessary.
- Account restrictions remain possible. Use only a dedicated disposable test
  account for live experiments.

## Local ephemeral dependencies

As of this handoff, these Docker containers exist on this Mac:

- `polymux-rqtx-airgap`: running with network mode `none`;
- `polymux-rqtx-gobuild` and `polymux-rqtx-gobuild-arm`: running with normal
  Docker bridge networking; and
- `polymux-rqtx-compiler` and `polymux-rqtx-probe`: stopped.

The active `/work/attestation-probe` SHA-256 in the air-gapped container is:

```text
1fa4be424fce8e0741ea678d985090ee9e32486b42e5099bfafc96a0bcc93a3e
```

Supporting research checkouts and rebuilt helpers are under a temporary path
matching `/tmp/polymux-native-auth.*`. They are not reproducible project state,
may disappear after restart/cleanup, may contain third-party files, and must not
be copied into Git wholesale. Document a clean build procedure before relying
on them elsewhere.

## Documentation drift to fix

`experiments/wechat-standalone/README.md` and `auth-readiness.mjs` describe the
earlier transport-only state. In particular, they still say personal QR
approval was not attempted and native QR was not implemented. Treat this
`PLAN.md` and the live evidence above as the newer status, then update those
files and their tests as the first small cleanup task.

## Completion gates

Do not mark the standalone client complete until all of these are freshly
verified:

- [x] Standalone MMTLS handshake and encrypted traffic
- [x] Native QR challenge
- [x] Phone scan and approval
- [x] Server-assigned regional transport
- [ ] Successful manual authentication
- [ ] Session persistence and fresh-process resume
- [ ] Initial and incremental sync
- [ ] Contacts/groups/conversations where present
- [ ] Live message receive
- [ ] Approved live message send plus sync/readback
- [ ] Auditable integrity and attestation implementation
- [ ] Production-grade key provenance and rotation
- [ ] Polymux integration without WeChat Desktop

Green offline tests do not substitute for these live gates. QR approval does
not equal login, login does not equal sync, and sync does not equal messaging.

## Start here for the next agent

1. Read this file and `experiments/wechat-standalone/README.md`.
2. Inspect `git status` and preserve all existing uncommitted work.
3. Run the offline test suite and `git diff --check`.
4. Update the stale README/readiness summary without changing the protocol.
5. Instrument a redacted manual-auth field inventory.
6. Investigate device-token/trust registration and version-field consistency.
7. Ask for a new live QR scan only after a concrete diagnostic change is ready.
8. Record each attempt here with date, exact change, and exact redacted result.

### Attempt log

| Date | Change | Result |
| --- | --- | --- |
| 2026-08-31 | Baseline native QR and manual auth using `0x18003b20` | Scan/approval succeeded; manual auth rejected with `-106` |
| 2026-08-31 | Updated top-level client version to guessed `0x18004c20` | Rejected with `-106` |
| 2026-08-31 | Used `0x18004c2a` and rebuilt attestation helper with the same version | Rejected with `-106`; version-only change was insufficient |
