# WeChat Integration Architecture

Polymux implements a macOS WeChat Matrix Application Service in
`packages/wechat`. The bridge maps WeChat conversations and messages into the
Hub. Desktop enables native inbound reading when exactly one keyed account is
available, with the external `wechat-use` relay as fallback. Outbound operations use the native writer,
with provider-dependent fallbacks and verification.

This is a hybrid integration. The native inbound implementation does not make
the complete integration independent of the provider, debugger permissions, or
the installed WeChat build.

## Native-only mode and upgrade handling

`POLYMUX_WECHAT_PROVIDER=native` is an opt-in path for an already-provisioned
account. It disables the external CLI, relay HTTP/SSE, relay startup/recovery,
and the legacy key-registry fallback. The writer reads account identity,
contacts and exact delivery history through Polymux's own authenticated database
snapshots. Sticker, unread, group, voice and file-cache reads use the same own
registry. Group member and avatar reads use the bridge's native store.

The registry is selected by `POLYMUX_WECHAT_STORE_REGISTRY`, or the ordinary
Polymux `wechat/store.json` location. Selection requires exactly one account;
invalid entries, foreign account directories and unsupported required message
columns are rejected. Message IDs stay strings, compressed content is bounded,
and each sender is resolved through its own message shard's directory. No
native-only request is silently retried through an installed provider.

Existing installations can import and validate previously obtained keys with
`node scripts/wechat/wechat-key-collect.mjs --check`. This is a one-time data
migration, **not independent fresh key acquisition**. Automatic key capture for
a fresh account or key rotation is still unfinished. One uncached catalog sticker
has been downloaded and digest-verified; general uncached-media retrieval and
full native-only delivery parity remain unverified. The default remains the
hybrid integration until these gates pass.

The bundled writer now exposes a read-only `compatibility --json` preflight.
It hashes the selected WeChat dylib before Hub can launch/warm the desktop or
invoke the sender. Native operations retain their own exact-build checks too.
Unknown builds show “This WeChat version needs a Polymux update before sending.
Your imported chats are still available.” No profile is guessed, no binary is
patched, and no uncertain message is automatically resent. Native-only mode
also refuses to attach a debugger over an external capture or a stopped WeChat.

Plain text can use the profiled Desktop message service directly, including
its normal local outbox persistence. Two File Transfer sends originating in the
test Hub were reconciled to nonzero native server IDs and completed outgoing
Hub bubbles. A subsequent resident-channel attempt was not confirmed and was
not retried. This establishes working examples, not reliable delivery under
every competing-debugger condition. The read-only native session probe can
recognize the selected signed-in account when Qt exposes no AX windows; it
cannot override explicit logout, QR, remembered-login or locked states.

This limits failure consequences; it is **not a guarantee that future WeChat
updates work**. The private sender still supports the explicitly profiled
4.1.11 build 269136. Future encryption, schema, ABI or authentication changes
require adaptation and live validation. Packaging must rebuild the writer using
`node scripts/wechat/build-wechat-writer.mjs`; the new registry and reader modules
are included in that bundle.

During the September 9 live review, the installed app was updated to 4.1.13
build 269602. Both the source and rebuilt packaged writer rejected that build
in their read-only compatibility checks. Its executable has hardened runtime
signing, and the guarded cold-launch preflight also rejects it. After the user
restarted and signed in, an isolated native-only Hub loaded 102 conversations
using existing authenticated keys. Live UI checks loaded the original 1080×1920
photo and stickers, played and paused a 26.1-second video, and played a recovered
16.98-second voice message. The enlarged photo/video views were also exercised.
These establish existing-key reads and those media examples on 4.1.13, not
fresh-key capture, new-message sync latency, background login or outbound parity.
The 4.1.11 native addresses and launch permissions must not be reused.

Native appmsg type 6 files enter the attachment reader, including videos shared
as files. Cached placeholders are upgraded without duplicate messages or changed
timestamps, and obsolete fallback cards are removed. Headerless, fully framed
SILK voice rows are normalized in a private buffer before isolated decoding;
the source database stays read-only. Native-only history preserves cached chats
and a retryable cursor when a shard is unavailable. Checkout testing selects the
source helper using Forge's development marker because the renamed executable
can also report `app.isPackaged: true`.

## Inbound paths

```text
                       WeChat Matrix AS
                       packages/wechat
                              |
             +----------------+----------------+
             |                                 |
       Fallback provider                   Desktop default when keyed
       wechat-use HTTP/SSE                  Native store reader
       127.0.0.1:18400                      + WAL watcher
             |                                 |
       Provider runtime                 Private SQLCipher snapshots
             |                                 |
             +------------- WeChat.app --------+
```

### Relay

The bridge consumes `/messages/stream` and uses the provider's HTTP/CLI routes
for directory discovery, history, account identity, and media where needed.
The upstream provider is [`leeguooooo/wechat-use`](https://github.com/leeguooooo/wechat-use).
Installation and any activation required by that provider remain external
prerequisites. Deployment must check the distribution terms for the exact
provider version.

### Native database reading

Named development isolates leave the external WeChat integration disabled by
default. This prevents ordinary account discovery, relay access and automatic
history/media import from crossing the isolate's data boundary. For intentional
live-account QA, set `POLYMUX_WECHAT_ISOLATE_LIVE=1` on the isolate launch. That
opt-in uses the Mac's real WeChat state; the inbound and registry settings below
do not provide account isolation. Synthetic bridge tests can still construct a
`WeChatBridge` with fixture stores and transports directly.

Desktop enables native conversation/history import and inbound traffic by default
when exactly one keyed account is available. Set `POLYMUX_WECHAT_NATIVE_INBOUND=0`
to explicitly use only the relay. Readable conversations remain connected in Hub
even when the independent native sender is not ready.

Native inbound currently accepts **one keyed account per bridge**. If discovery
returns multiple keyed accounts, the bridge logs the ambiguity and uses the
relay. It must not merge their cursors or rooms by chat ID. There is no native
account-selection UI yet. `POLYMUX_WECHAT_STORE_REGISTRY` changes the native
registry path, but Desktop discovery also reads the legacy fallback registry;
the combined result must contain only the intended keyed account.

Before starting the watcher, the bridge opens the session store and all keyed
message shards. Failure logs the reason and falls back to relay SSE. A missing
optional contact key leaves names unavailable without blocking conversations.
Database failures after startup are retried by later watcher passes. They do
not establish that the account or its keys are still current.

`packages/wechat/src/wechat-native-store.ts` reads:

- `session/session.db` for conversations and read state.
- `contact/contact.db` for names and group membership when its key is available.
- `message/message_*.db` for history and live rows, using `Msg_<md5>` tables and
  each shard's `Name2Id` directory for sender identity. History merges every
  keyed shard containing the conversation, keeping the newest copy of a
  repeated server message. Table discovery is refreshed instead of caching
  the first matching file indefinitely.

Each `SqlcipherLiveSnapshot` owns a unique private plaintext file. Its worker
(`scripts/wechat/wechat-snapshot-worker.mjs`) authenticates and decrypts pages,
then applies committed WAL frames. The source fingerprint belongs to the bytes
read, so a commit during publication remains visible to the next refresh.
Checkpoint/reset handling consults the WAL index and rebuilds when required.
Rebuilds publish by rename; reads and refreshes are serialized so incremental
patches cannot overlap a query. Closing one reader does not delete another
reader's snapshot.

The reader opens the source database and its WAL/SHM companions for reading;
decryption, patches, renames and cleanup affect its private snapshots. A
regression fixture verifies unchanged source bytes and permissions across
reads, refresh, wrong-key failure, retry and close. This protects the reader's
source files; it is not a guarantee against WeChat itself crashing during a
native operation.

`packages/wechat/src/wechat-wal-stream.ts` combines directory notifications with
a periodic sweep. Existing chats start at their newest local row in each shard; historical
imports use the bridge's history/backfill routes. Newly discovered chats start
before their first row, so messages that caused discovery are included. Bursts
drain over successive batches even when the database stops changing. Cursors
advance after ingestion succeeds; a failed batch is retried, with bridge
deduplication handling already-ingested rows. Abort signals stop and join the
filesystem watchers.

Native cursors are in memory and scoped to both conversation and shard because
local IDs restart in each file. A new chat table in an already keyed shard is
discovered on later passes. Restart history recovery depends on the bridge's
backfill path. Native reads and periodic sweeps now recheck the pinned Polymux
registry, with coalesced checks spaced at least five seconds apart. A newly
provisioned or changed key must authenticate the encrypted database before it
is admitted. A replacement rebuilds the private snapshot atomically while
existing readers retain their serialized snapshot object. Invalid updates keep
the previous key; account or container changes are rejected.

Each admitted key change advances a generation. The watcher resets that
shard's cursors even if a history read consumed the registry reload first, so
restarted local row numbers are not skipped. Removed keys close their snapshots;
re-adding a shard requires authentication again. Closing the store also drains
in-flight key admission and removes its private candidate copy. A database
without a newly captured key remains outside coverage: automatic fresh key
capture is still unfinished. Actual live key rotation and database rollover
remain separate acceptance checks from the encrypted-fixture regressions.

### Photos, stickers, and message ownership

`wechat-local-media.ts` resolves photos through the read-only snapshot of
`message/message_resource.db`. It requires the exact chat, local message ID,
type, and timestamp before using the resource digest to locate an attachment.
Local V2 `.dat` decoding uses account metadata from the same WeChat container;
it does not attach a debugger or modify WeChat files. Paths must remain inside
the account directory, files have size limits, and decoded image signatures
must be recognized. The V2 format was cross-checked against
[wxcli's decoder](https://github.com/hydewww/wxcli/blob/main/src/attachment/decoder/v2.rs).

The reader prefers an available original, then the high-resolution variant,
then a thumbnail. A thumbnail is a preview, not proof that the original is
available. Reading a cached Hub page revisits imported previews and replaces
them when an exact local original becomes available. Missing originals never
downgrade an existing image. Each photo lookup refreshes its resource snapshot
first, so a newly committed resource record is visible without restarting Hub.

Cached videos use the authenticated `message_resource.db` record for the exact
conversation, server ID, local ID and send time. Only its recognized resource
digest may select a file under that account's `msg/video` directory. The
reader prefers the original MP4, checks its signature, and verifies the native
message's size and digest when available. Thumbnails and mismatched files are
not substituted. Native video and voice durations are preserved. Video
retrieval that requires a new Desktop/CDN download is still unimplemented in
the native-only provider.

Stickers can come from a local plaintext cache or an ordinary download URL.
Appmsg type 8 stores its reference in a bounded base64 protobuf rather than an
`emoji` XML attribute. Only the matching digest and download URL are consumed;
encrypted-download keys are not used. Downloads are bounded and must have a
recognized image signature and match the reference digest. GIFs retain their
animation.

Reading a cached Hub page also retries missing photos, stickers, voice notes,
videos and file attachments, including the account's own messages, and repairs
imported authorship from native history. Cached-page identity and media reads
use Polymux's own registry and history reader even in hybrid mode; unavailable
native history does not fall back to the external CLI. Ordinary sticker URLs
may still be downloaded with the existing bounded, digest-checked reader.
The refresh coalesces work per room, limits each pass, and applies a per-event
cooldown. Enrichment uses an edit by the original local event author with the
remote marker retained, so it does not send a new WeChat message or change its
authored time. It neither launches WeChat nor invokes the native media capture
path. Missing local media retain their fallback.

WeChat's account-folder discriminator is excluded from its actual sender ID.
For already imported messages, the bridge persists per-event ownership attested
by native history. Hub accepts that map only for its current local owner and
mapped room, fixing bubble alignment without rewriting historical senders.

Hub also reads the visible caption inside cached native `voipmsg` records.
This restores call duration and missed/declined/cancelled status without
rewriting history; WeChat's separate numeric duration field can be zero even
when the caption contains a completed call's duration. Calls use the shared Hub
call bubble, also used for `com.beeper.action_message` call markers and supported
legacy bridge call notices. Missing duration stays unknown rather than becoming
`00:00`.

## Background sync

The desktop backend starts WeChat ingestion at app launch, independently of Hub
navigation. A non-overlapping five-second retry resumes passive ingestion when
access becomes available. Explicit unlink suspends it and shutdown stops it.
This path does not call sender readiness or launch a user-quit WeChat app.

The bridge publishes the complete available conversation directory before
loading history. Failed initial imports are retried even after the bridge has
registered, and concurrent startup requests share one operation. Once imported,
existing inbound and directory watchers keep the list current. Opening Hub reads
that populated local state; a first import still takes time to complete.

Saved WeChat room mappings also outlive the local Hub login. On reuse, the bridge
verifies the room's WeChat identity and reconciles the current Hub owner's
membership before publishing it. A changed local login therefore reuses the
existing rooms and history rather than leaving them attached only to a previous
local identity. Membership is acknowledged only after the homeserver confirms it;
explicit leave/ban state is not overridden.

## Desktop login in Hub

Hub shows a centred **Sign in to WeChat Desktop** message and an **Open WeChat**
button. Only that explicit action invokes Launch Services in the foreground.
Signing in, QR scanning, phone approval and login options belong to Desktop.
The active Hub flow does not capture QR codes or change login controls.

The existing background sync loop checks sign-in and read availability about
three seconds after its preceding check completes, even before Hub is opened.
Concurrent checks share one observation and stop with the backend. A visible
sign-in panel also refreshes status and conversations every two seconds, with no
sender preparation or application launch. Source selection is read-only too.

Signed-in status is separate from database access: if keys or readable stores
are missing, Hub explains that chat access is not ready instead of claiming
logout or displaying an empty-conversation message. In native-only mode, a
startup snapshot failure is retried after confirmed manual sign-in. Every keyed
message snapshot and the directory must validate before native ingestion resumes;
failed retries remain unavailable and are limited to once per ten seconds.

The guarded native login helpers below remain available for their separate
explicit tooling, but Desktop no longer wires them into the ordinary Hub login
flow. Current-build sending and fresh-key provisioning remain separate gates.

### Background login protection

Automatic cold launch no longer uses a launch-notification delay followed by
hiding or debugger attachment. The launcher verifies the exact executable,
Desktop library and signing restrictions before starting a child with the
versioned guard inserted by dyld. The guard initializes before application
initializers. If insertion is unsupported or a required guard hook is missing,
the application is not admitted for login. There is no unguarded `open -g`
fallback and no delayed Launch Services launch request.

The persistent guard intercepts application activation, front/key window
ordering, floating levels and attempts to restore a cloaked window's opacity.
Front-order requests use background ordering without invoking the original
front/key method. A startup deadline cannot release this protection. Explicit
activation through macOS restores the saved window frame, opacity, mouse handling
and level. Automatic actions never restore or change the user's foreground app
after a failure. Manual Dock reopening was confirmed for the guarded test
process, with its sign-in window visible when the user opened it.

The pinned Qt build keeps a rendered surface at alpha `0.001` with mouse input
disabled because zero opacity previously broke its accessibility tree. macOS
can clamp its offscreen frame onto a display. This is not a universal
zero-pixel guarantee: the window-order monitor retains exposure flags and
records opacity separately. The latest live cold-launch attempt kept keyboard
focus unchanged but exposed this near-transparent rendering surface.

A cold remembered-login window may expose an enabled “Open WeChat” button with
no focused element and no AXPress action. The helper can now set focus only on
that unique, verified login button, through its writable accessibility
attribute. It leaves any existing focused control alone, then rechecks the
button, account markers, sync options, process, window and guard before sending
Return to WeChat's PID. Each response records attempted login submission and
actual AX dispatch results. This path has compiled fixture coverage; its live
rerun is pending a normal restart of the previous test process.

Each login mutation requires a fresh private guard report matching the process
birth and current bundled revision. A stale report, changed hook, foreground
WeChat, locked or unknown console session, or unavailable guard blocks the action.
Automatic login never attaches a debugger to an existing WeChat session. It
requires a guard already installed by cold launch or a supervised native writer.
If it cannot verify one, Hub says “Continue in WeChat” and explains that signing
in there will resume sync. A helper update refuses to stack another guard over
an older resident revision; that process needs a normal user restart before the
new revision can be used. The previous guard keeps its own restoration state.

Installation preflights every required selector before swapping any method.
Optional newer AppKit selectors are guarded when present. Guard reports are
published atomically so concurrent readers cannot see a partial refresh. Manual
foreground takeover during launch ends automation and preserves the process.
A slow child with an observed guard also survives the launch deadline.

Compiled tests exercise the production interception functions, dyld initializer
ordering (C initializers and Objective-C `+load`), expired/replaced reports,
concurrent guard revisions and guarded checkbox/Return behavior. The production
child lifecycle is also tested against owned non-GUI children: failed admission
stops only the exact unverified child, while manual takeover and a slow guarded
launch preserve it. These
are not a completed live cold-login test of this replacement. Unknown Desktop
builds/signatures intentionally require manual opening or a Polymux update;
future private UI and macOS changes still require validation.

### Unconfirmed delivery

After submission, a missing native acknowledgement is an uncertain outcome.
Hub retains one outgoing message with **Delivery unconfirmed**, clears the
submitted draft, and never automatically sends it again. A crash, malformed
response or timeout after a sending helper starts receives the same treatment;
the separate native cleanup hold is preserved. A failure to start the helper
or a definite rejection still reports an error and restores the draft.

The status is persisted in Polymux's local event content and survives reopening
Hub. A later verified result clears it. Ordinary text can also reconcile one
unambiguous fresh native server acknowledgement against its pre-send history
baseline, preserving the local event's identity and timestamp. Ambiguous matches
stay unconfirmed. A delayed negative result after the caller's deadline does
not make an uncertain bubble appear delivered. Delivery labels do not clear
native-operation safety holds or establish that a queued callback has ended.

## Key provisioning

`scripts/wechat/wechat-key-collect.mjs` writes Polymux's registry at
`~/Library/Application Support/Polymux/wechat/store.json` by default. It can
import existing `~/.wx-rs/keys.json` and `config.json`, or record a hand-captured
raw key with `--set <wxid> <entry>`. The latter reads one 64-character hex key
from stdin; keys must not appear in command arguments or shell history.

Collection preserves previously provisioned keys and rejects malformed existing
registries instead of overwriting them. Writes use an owner-only temporary file
and atomic rename. Readable imported databases are checked against their first
page HMAC. An unavailable imported database cannot overwrite an existing key;
new entries are checked by the reader before plaintext publication.
The recorder also authenticates readable databases before writing and refuses
to replace an existing key when its database is unavailable. Ambiguous account
containers and unsupported or conflicting options are rejected.

`--capture <wxid>` is an experimental, explicit setup path for an existing
Desktop account with encrypted database files. It requires WeChat to be
stopped and the guarded launcher to accept the installed executable. It never
attaches a debugger, changes the application's signature, or falls back to
external keys. It is not enabled by ordinary startup.

The launcher loads a separate observer for the public CommonCrypto AES call.
The observer preserves the original call, error and output, and accepts a key
only when it authenticates one of the selected encrypted first pages. Capture
is bounded to 60 seconds, 128 pages and 512 distinct candidates. Only accepted
keys are written to owner-only staging; the host authenticates them again
against the current source before recording them. Missing keys are reported as
partial capture. Staging is removed when the attempt finishes. The launcher
rejects invalid staging before starting WeChat, and login requests pin the new
process's PID and BSD birth, retain the background guard, and never retry an
uncertain request.

The bounded observer remains active when that same process temporarily hides
its accessibility controls during startup or a login-window replacement. If a
login dispatch is recorded but the chat list is not ready, setup continues
read-only observation; it does not press sign-in again or treat dispatch as
successful authentication. Explicit logout, locking, a changed process, an
unrecognized state or a guard refusal stops the attempt. A login which never
finishes still reports missing keys when the existing budget expires.

This path passed a complete disposable CommonCrypto-to-registry test without
legacy keys. It still needs live WeChat acceptance. A first-ever Desktop login
before databases exist, databases not accessed within the capture window,
automatic setup and actual key rotation remain open; this is not yet proof of
fresh-install independence or complete upgrade resilience.

`--lldb` prints reference information for the public SQLCipher keying APIs on
an explicitly identified, permitted test build. The installed 4.1.11 library
does not expose those named symbols. This is reference information, not an
automated or live-validated key extractor. `sqlite3_key` and `sqlite3_key_v2`
have different pointer/length argument positions; a passphrase or encoded key
literal is not a raw 32-byte key. See the
[SQLCipher API signatures](https://www.zetetic.net/sqlcipher/sqlcipher-api/index.html#sqlite3_key).

## Outbound operations and verification

`scripts/wechat/polymux-wechat-driver.mjs`, `wechat-wire.mjs`, and
`packages/wechat/src/native/` implement the native writer. The resident model
socket and AppKit window guard support background operations; Mars requests
support text, replies, attachments, voice, video, stickers, and recall on
supported WeChat builds. Some routes still use provider commands, including
history-based verification and fallback sends. Provisioning database keys does
not remove these outbound dependencies.

Successful local verification requires a matching, self-authored history row
with a nonzero server message ID. Sender checks use the account's stable WeChat
ID; numeric sender IDs must be resolved in the destination shard. For images,
an unrelated fresh row or a similar size cannot prove delivery. Verification
requires an exact content digest or an explicit acknowledged message ID. Image
re-encoding without either can therefore remain unverified even if WeChat sent
it. A local verified row does not prove remote receipt or that a person read it.

Debugger-backed operations coordinate daemon pauses and cleanup. Composer
timeout and cancellation use the detach protocol before terminating the helper.
If detachment cannot be confirmed, the driver returns
`relayRecoverySafe: false`. The bridge holds further writes, readiness probes,
relay reconnection, and media retries; it requires restarting WeChat and
Polymux before recovery. Automatically restarting a provider in that state could
attach a second debugger to a still-stopped target.

An externally supervised relay uses an independent guarded pause. The guard
captures the native target's PID and birth/executable identity; driver helpers
must use that identity and refuse to discover a replacement. Parent exit or
the six-minute deadline does not resume the relay while that target remains
alive. An explicit release refuses stopped or traced targets; watcher exit
alone is not a successful release. If the owner dies, the guard waits for the
original target to exit or be replaced before resuming the relay. This
deliberately trades availability for safety: a failed operation can leave sync
paused until WeChat is restarted. Fixture processes cover expiry, parent exit,
target exit, stopped targets and watchdog termination; actual debugger
behavior on the installed WeChat build remains a live acceptance check.

Polymux-owned relay shutdown also captures and pins the native target before
stopping that relay. If no exact target is available, it refuses the operation
and leaves the relay running. Desktop hosts resolve the exact WeChat process
when the relay omits its PID; ambiguous discovery never substitutes a stale
relay identity. Cold launch may need WeChat to be opened first. Unknown relay shutdown, driver timeout,
abnormal exit or malformed response retains the recovery hold. Voice helpers
use the same conservative failure rule and wait for process exit before
returning ownership to the bridge.

Plain text through the native writer holds the same exclusive pause until the
operation completes. Its composer can fall back to a debugger; a fixed time
window is insufficient to protect a slower send. Every configured native text
send uses this guarded route, even when the relay advertises an attached app.
The composer requires a known matching recipient before paste and checks it
again before delayed submission; it never fills an empty recipient by writing
that identity into memory. Sending
while another chat is selected is therefore an explicit parity limitation,
not a reason to bypass the recipient check.

When that guard rejects a send, Hub removes the optimistic message, restores
the draft and explains that the intended conversation must be opened in
Desktop. Readiness and login preparation also stop at the macOS lock screen,
even if WeChat leaves a previously signed-in accessibility tree readable.

A dispatched send is never retried by warming the relay or switching send
transports. Relay-only delivery requires `delivered_verified: true`; generic
`ok` or `success` does not confirm delivery. CLI fallback is restricted to a
missing executable, and an accepted resident request with a missing response
stays pending verification. A recipient rejection stops before any debugger
fallback.

Appservice sends commit an event/destination fence to Polymux's private
`wechat/outbox.sqlite` before dispatch. This journal is independent of the
disposable import cache and uses SQLite's full synchronous commits. Restarting
converts interrupted attempts to unconfirmed delivery without submitting them
again. Duplicate event delivery, including a different appservice transaction,
cannot repeat the native action. Confirmed native IDs restore message mappings
even if the import cache lost them. An unreadable journal blocks sending rather
than resetting the fence.

For ordinary text, a pre-send baseline also survives a restart. A single matching
self-authored row with a new server ID and an authored time within the send
window can reconcile the existing Hub event. A later independent same-text
message does not match. Media, replies and mentions without an exact native
receipt remain unconfirmed; recovery does not infer delivery from their media
kind or placeholder text. Journal crash recovery, bridge restart and media
no-replay behavior have fixture coverage, including recorded audio across a
bridge restart. Hub records voice locally and submits the completed take through
the same journaled media route. The obsolete Desktop hold-to-record API has been
removed; the bundled driver never supported that command. Before submission, an
interrupted local recording cannot send anything to WeChat. Live crash acceptance
and authenticated voice delivery on the upgraded Desktop build remain open.

See the [upstream design comparison](reviews/wechat-live-20260908/upstream-design.md)
for differences from current wechat-use, including its separate WeChat container.

Development loads writer and snapshot scripts from `scripts/wechat`; packaged
builds load the shipped copies. Missing files do not silently select the other
runtime, which could hide an untested or stale implementation.

## Account and data risk

This integration cannot be certified ban-safe. WeChat's
[Acceptable Use Policy](https://www.wechat.com/en/acceptable_use_policy.html)
restricts unauthorized plugins and interoperating software, and permits
account restrictions, suspension or termination. Passing automated or live
tests does not establish permission from WeChat or quantify enforcement risk.
Use a disposable account for development checks after accepting that risk.

Native sending operates inside WeChat's process and can change its own
database through its message services. Exact-build checks and conservative
cleanup reduce known technical risks; they cannot guarantee no crash, no
corruption, or complete Desktop parity. The source-file immutability result
above applies specifically to the database reader.

## Verification

The automated suites cover encrypted database/WAL fixtures, snapshot ownership
and concurrent access, checkpoints, cursor draining, delivery retry, watcher
shutdown, key-registry preservation, sender identity, image verification, and
fake-debugger cleanup, source-file immutability, pinned process identities and
guarded relay recovery. Bridge integration tests use a local test homeserver
and fake native stores/relay to exercise startup fallback and recovery holds.

```sh
npm run test:wechat
node --test scripts/wechat/*.test.mjs
npm run test:hub
npm run check
```

Passing these checks is not live WeChat parity. Before enabling native inbound
for routine use, verify the exact WeChat build and account with controlled
conversation discovery, restart/backfill, checkpointing, account/shard changes,
text and media sends, and forced failures.
Burst handling above 200 messages is covered by fixtures; any additional live
load checks belong only on a disposable test account with explicit scope.
Visual background behavior and actual recipient delivery require separate live
evidence. The initial September 2026 reliability review used fixtures and local
test services. Subsequent authorized live checks found stale development
runtime selection, first-shard-only history and an insufficient plain-text
relay pause. Those fixes have regression coverage. Live sending and rendering
remain separate acceptance gates; see the dated live-test report for outcomes.

The 8 September automatic-recovery follow-up achieved live Hub-to-Desktop text
delivery to File Transfer, with exact-body database reconciliation and Desktop
visual evidence. It fixed two recovery gaps: stopping the provider alone could
leave WeChat stopped, and resident composer readiness skipped cleanup of the
independent capture debugger. Both paths now require exact-process cleanup;
cold recovery also waits for a continuous quiet interval. The session probe
allows process-startup overhead beyond its internal one-second AX deadline.
See [the automatic-recovery report](reviews/wechat-live-20260908/automatic-recovery.md)
for historical timings and acceptance limits. The current Hub uses manual
Desktop sign-in as described above. The integration is not signed off for
unattended sending.

The [9 September media and ownership follow-up](reviews/wechat-live-20260908/media-ownership-20260909.md)
records a live background Polymux UI check of photos, animated stickers, and
incoming/outgoing alignment, with its preview and coverage limits.
