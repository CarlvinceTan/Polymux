# Polymux Connectivity Spec (v3, 11 Oct 2026)

Owner constraints (Carlvince, final): **zero setup, no accounts, zero cost to users and to Carlvince, no Polymux-operated service of any kind.** Polymux is open source and must keep working if the project disappears. v2 (a Polymux-hosted relay) is withdrawn.

## 0. Current state (main @ dd052ff, v0.4.0)
- `apps/server` binds to the **Tailscale interface**. `tailnet()` in `cmd/server/main.go` fails with "no Tailscale interface found" unless you are in dev loopback mode. Ports: backend 7337, controller 7338, pinned-TLS device listener 7339 (`cmd/server/host.go`, `device.go`).
- Pairing is done through the CLI: `polymux-server device pair -agent ID` prints a **single-use ticket that expires in 10 minutes**. The user pastes it into Settings > This Mac. `device list|revoke` exist. The device socket uses a pinned TLS config (`pairings.TLSConfig()`).
- So today the user needs a Tailscale account plus a terminal step. This spec removes both. The existing pinned-TLS and ticket model is reused as the base for security.

## 1. Goals and non-goals
Goals
1. Install, scan a QR code, done. No accounts, no CLI, no Tailscale required (still supported as an opt-in, §10).
2. **Same network always works** (Bonjour), offline included.
3. **Away from home works whenever the networks allow a direct path**, using only public or community infrastructure that Polymux doesn't run, and only for signalling and discovery (bytes, never data).
4. End-to-end encryption between paired device keys on every path.
5. When no direct path exists, explain it plainly and offer one-tap relay options the user (or a friend) controls.

Non-goals
- Guaranteed remote connectivity on every network. Without a relay this is **physically impossible** on symmetric-NAT/CGNAT pairs (§4), and we say so in the UI.
- Any Polymux-run server, relay, signalling worker, domain or paid account.
- Relaying data through public infrastructure we don't operate. Public relays carry signalling only.

## 2. Pairing (QR + E2E). Unchanged in substance
1. The Mac generates an Ed25519 identity (Keychain) and shows a QR: `polymux://pair?k=<hostPubKey>&s=<256-bit secret>&l=<LAN addrs>&n=<nostr relay hints>`. It is single-use, has a 10-minute TTL, and has a short code fallback that runs through PAKE.
2. A phone that finds the Mac over Bonjour `_polymux._tcp` still needs a **QR scan or 6-digit SAS** confirmation. Nothing pairs silently.
3. Noise `XXpsk` handshake keyed by the secret. Each side stores the other's public key. Afterwards all sessions are Noise IK between paired keys, with forward secrecy.
4. Remove/unpair works from either side with a signed revoke. "Reset host key" kills all pairings. Remote **commands capability is off by default** and enabled per device.
5. **The pairing exchange also stores everything needed for remote access:** both keys, a shared rendezvous secret (used to derive rotating, unlinkable Nostr/DHT lookup IDs), and the user's chosen relay list (empty by default). No server learns about the pairing.

## 3. Options evaluated (current official sources)

### 3.1 iroh (n0), QUIC P2P with relays
- **Public relays:** "Iroh hardcodes a set of public relays provided by n0.computer, free to use… rate-limit traffic… carry no uptime or performance guarantees… suitable for development and testing" (https://www.iroh.computer/docs/concepts/relays). Public relays page: "**development and hobby use only. For production, use managed relays.** No SLA… n0.computer reserves the right to remove support for older iroh versions at any time… reserve the right to block offending IP addresses or users" (https://docs.iroh.computer/iroh-services/relays/public). Rate limits are "**not published today, as they get tuned as needed**… Do not rely on it for production workloads" (https://docs.iroh.computer/relays/rate-limiting).
- **Paid alternative:** Shared relays on the Pro plan (10k concurrent endpoints, 100 GB egress, 5 MB/s, then $0.09/GB) cost money, so they are excluded (https://docs.iroh.computer/iroh-services/relays/shared).
- **Hole punching:** "roughly 9 out of 10 networking conditions allow a direct connection" (vendor claim, https://www.iroh.computer/docs/concepts/relays). ProbeLab notes it hasn't seen data backing the >90% claims (https://probelab.io/blog/can-libp2p-punch-through-nats/).
- **Critical:** in iroh the **relay is also the hole-punch coordinator** (address exchange happens through the home relay). Without a relay iroh can only dial addresses that are already reachable. Using it "properly" therefore means relying on n0's relays against their stated policy, or self-hosting.
- **Swift:** iroh-ffi ships Swift (SwiftPM, CocoaPods), Kotlin, Python and JS bindings for the iroh 1.0 surface. Go is community-maintained only (https://github.com/n0-computer/iroh-ffi). Our Go server would need a Rust sidecar.
- **Self-host:** `iroh-relay` is open source. Rate limiting is off by default when self-hosted (https://docs.iroh.computer/relays/rate-limiting).
- **Verdict:** best engine, but its zero-config path depends on a service whose terms say "not for production". Kept as a tradeoff (§9 #1).

### 3.2 Nostr relays for signalling
- An open protocol with many independently run public relays. Events are signed JSON over WebSocket (NIP-01, https://github.com/nostr-protocol/nips/blob/master/01.md). Relays publish limits via NIP-11 `limitation` (message length, subscriptions, `restricted_writes`, payment required) (https://github.com/nostr-protocol/nips/blob/master/11.md). Payload encryption: NIP-44 (https://github.com/nostr-protocol/nips/blob/master/44.md). Ephemeral kinds 20000–29999 are not stored (NIP-01).
- **Fit:** good for small, latency-tolerant (~0.2–2 s) offer/answer and candidate exchange. Our messages are about 1–2 KB, a handful per connection attempt, so the load on any relay is trivial.
- **Risk:** each relay is a volunteer with its own policy. Some require payment or proof-of-work, some drop ephemeral events, and they come and go. Mitigations: publish to **4–6 relays in parallel** from a bundled list refreshed with each app release, a user-editable list, and per-pair rotating throwaway Nostr keys so relays can't link sessions to a user. Content is Noise-encrypted to the peer, and relays see only random pubkeys, IPs and timing.

### 3.3 BitTorrent Mainline DHT (pkarr)
- pkarr publishes **Ed25519-signed DNS packets to the Mainline DHT** (BEP44 mutable items) with no registrar or platform (MIT) (https://github.com/pubky/pkarr, BEP44 https://www.bittorrent.org/beps/bep_0044.html). It is a huge, ownerless, decade-old network, so nobody can withdraw it.
- **Fit:** an always-available lookup "where is host K right now?" (current public IP:port, IPv6, and which Nostr relays it is listening on). It is a fallback when Nostr relays fail and a way to bootstrap the relay list.
- **Limits:** needs UDP (fine for native apps). Lookups take ~1–5 s, records must be republished (hours scale), and payloads are ≤1000 bytes. HTTP pkarr relays exist for UDP-blocked clients, but those are someone's server, so we use them only as a last resort.
- **Verdict:** use for discovery and the IPv6/direct address, and as backup signalling (one-shot "punch now" records). Too slow to be the primary signal.

### 3.4 WebRTC with public STUN, and no free TURN
- ICE does hole punching and STUN reveals the reflexive address. WebRTC's own docs: "For most WebRTC applications to function a server is required for relaying the traffic… a TURN server" (https://webrtc.org/getting-started/turn-server). **There is no free, sanctioned public TURN**, and TURN by design needs credentials and costs bandwidth.
- Google's `stun.l.google.com:19302` is widely used, but Google publishes it **without a documented public SLA or terms of service**, so treat it as best-effort. Bundle several independent STUN servers (Google, Cloudflare `stun.cloudflare.com`, and others), and remember STUN is tiny (one UDP round trip). Also: STUN is unnecessary if the peer learns its reflexive address from the other side's observation during Nostr signalling.
- **Stacks:** Go `pion/webrtc` (MIT, https://github.com/pion/webrtc), plus `pion/turn` for an embeddable TURN server (https://github.com/pion/turn). On iOS, the WebRTC framework builds (libwebrtc), or simply pion compiled via gomobile into the app.

### 3.5 libp2p circuit relay v2 + DCUtR
- Circuit v2 introduced **"limited relaying… with a limited duration and data cap"** (https://github.com/libp2p/specs/blob/master/relay/circuit-v2.md). go-libp2p defaults are **2 min and 128 KB per direction**, intended only to coordinate a hole punch (https://github.com/libp2p/go-libp2p/blob/master/p2p/protocol/circuitv2/relay/resources.go). DCUtR then punches.
- **Measured:** on the live IPFS network, **~70% overall hole-punch success**. Port-restricted cone 82.9%. "Symmetric" 39.7% (small sample, likely misclassified, since true symmetric should be lower) (https://probelab.io/blog/can-libp2p-punch-through-nats/, https://github.com/probe-lab/dcutr-project/blob/main/docs/dcutr-final-report.md).
- **Fit:** public IPFS peers as volunteer coordinators is technically possible, but it's a heavy dependency, there's no maintained Swift implementation, and it borrows IPFS volunteers' resources. Rejected, but its measurements are our best honest baseline.

### 3.6 Bonjour/mDNS
Native (`NWListener`/`NWBrowser`) and zero infrastructure. It is the same approach as OpenCode's `--mdns` (https://opencode.ai/docs/server/).

## 4. Honest reliability
| Situation | Expected outcome without a relay | Source |
|---|---|---|
| Same Wi-Fi/LAN | ~100% (except client-isolated guest/hotel Wi-Fi) | Bonjour |
| Either side on public IPv6 with inbound allowed (common on mobile carriers) | Usually direct | — |
| Typical home NAT ↔ typical home NAT or cone-NAT mobile | Hole punch usually works. **~70% overall, ~83% for port-restricted cone** (libp2p live network). iroh claims ~90% (vendor, unverified) | ProbeLab; iroh docs |
| Symmetric NAT / many CGNATs on either side, especially both | **Mostly fails.** Measured "symmetric" success ~40% is likely inflated. Symmetric↔symmetric should be treated as ~0% | ProbeLab |
| Mobile carriers | Varies by carrier. A 4-carrier Dutch 5G test: 3 punched, **Lyca (symmetric NAT) failed, i.e. 75%** (https://ar5iv.labs.arxiv.org/html/2311.04658). An older 72-carrier study found **26.4%** use connection-restricted mappings (https://cs.ucr.edu/~zhiyunq/pub/sigcomm11_netpiculet.pdf) | cited |
| Corporate/UDP-blocked networks | Fails (needs TCP/443 relay) | — |

**What to tell Carlvince plainly:** without any relay, expect **roughly 70–85% of away-from-home sessions to connect directly and 15–30% to fail**, clustered on specific networks (some carriers, CGNAT ISPs, corporate Wi-Fi). It is deterministic per network pair: if it works on a given network pair it keeps working, and if not it keeps failing until a relay is added.

**Other honest risks:**
- **Public infra withdrawal:** n0 relays are explicitly not for production (§3.1), so we don't depend on them. Individual Nostr relays disappear or rate-limit, which we mitigate with 4–6 in parallel plus DHT fallback. The Mainline DHT has no owner to withdraw it. Google/Cloudflare STUN could be rate-limited, which we mitigate with multiple servers plus peer-observed addresses.
- **iOS:** the phone app gets suspended in the background, so connections are established on foreground. That adds 1–3 s to connect remotely (signalling plus punch). Push notifications for agent events without a server need APNs, which needs a sender, so that's out of scope (see §9 #6).
- **The Mac must be awake and online.** Apple "Wake for network access" helps on the LAN only.

## 5. Recommended stack
**Bonjour LAN + WebRTC data channels (pion on both sides) + Nostr signalling over several public relays + Mainline DHT (pkarr) discovery/backup + public STUN, with the Noise IK session inside the data channel, plus an optional TURN-compatible relay that the user or a friend runs (embedded `pion/turn` in polymux-server).**

Why WebRTC/pion over iroh:
- ICE does standards-based hole punching **without needing anyone's relay for coordination**, because Nostr/DHT carry the offer and answer. iroh's punching needs a relay.
- Pure Go on the server (pion) and the same pion code via gomobile on iOS/macOS, so one implementation and no Rust toolchain.
- TURN is the standard relay, so "self-host" or "borrow a friend's" relay is just a TURN URL plus credential, with a mature open-source ecosystem (coturn, pion/turn).
- The Noise layer keeps E2E independent of DTLS and of whatever relay is used.

## 6. Fallback order and what the user sees
Connect attempts are raced; the first authenticated Noise session wins, and the session upgrades when a better path appears.
1. **LAN direct:** Bonjour-resolved or last-known LAN address. ~instant.
2. **Direct known address:** IPv6 or public IP from DHT/previous session.
3. **P2P hole punch:** ICE (host/srflx candidates) via Nostr signalling, with DHT signalling as backup. ~1–3 s.
4. **User-controlled relay (TURN), only if configured:** self-hosted, borrowed from a peer, or from the community list.
5. **No path:** a clear state, not a spinner.

UI when no path works (shown after ~10 s, never during onboarding):
> **Connected on the same Wi-Fi only.**
> This network blocks direct connections to your Mac. To reach it from here, add a relay:
> - **Borrow a friend's relay:** scan their Polymux "Share my relay" QR. Their Mac relays your encrypted traffic; they can't read it.
> - **Use your own:** turn on "Act as relay" on a Mac/PC with a reachable port, or run `polymux-server relay` on any VPS/home server. Pair it by QR.
> - **Community relays:** pick from a list maintained in the open-source repo (volunteer-run, no guarantees). You choose; nothing is enabled by default.
> [Try again] [Details]

"Details" shows the detected NAT type for each side and which step failed, which makes support possible without logs.
Status pill in the app: "Same Wi-Fi" / "Direct" / "Via relay: <name>" / "Offline".

## 7. Security without accounts (deltas from v2)
- Identity, pairing, Noise IK, revoke and capabilities are as in §2.
- **Signalling privacy:** Nostr events use throwaway keys derived per pair per day from the rendezvous secret. Payloads are encrypted to the peer, so relays see random pubkeys, IPs, timing and size. DHT records are keyed by a derived key (not the identity key) and contain only addresses plus relay hints, signed.
- **Relays (TURN) see** IPs and byte counts only, never content. A borrowed relay issues a TURN credential scoped to the borrower's key, revocable by the lender from "Shared relay > Users". Lender caps: default 2 GB/day and 1 MB/s per borrower, max 5 borrowers.
- **No open relaying:** the embedded relay only accepts credentials it issued via QR. There is no anonymous use.
- **Signalling abuse:** every signal must decrypt and authenticate against a paired key or it is dropped silently. Each host processes at most 20 signals/min, and pairing attempts lock for 15 min after 5 failures.

## 8. Implementation units (coding-pipeline style)
- **C1 Identity and pairing:** Ed25519/Keychain, QR + VisionKit scan, PAKE short code, SAS, devices list, revoke. Replaces the CLI ticket.
- **C2 Make Tailscale optional (amended):** the `tailnet()` requirement is no longer fatal; Tailscale stays as an opt-in path (§10). The server listens on loopback (backend) and LAN (pinned-TLS device port).
- **C3 Bonjour:** advertise/browse `_polymux._tcp`, plus Info.plist local-network keys.
- **C4 Noise session layer:** Go and Swift (or gomobile-shared) with cross-language test vectors.
- **C5 Signalling:** Nostr client (4–6 relays, NIP-44, ephemeral kinds, rotating keys, NIP-11 limit awareness), bundled relay list plus a user override.
- **C6 Discovery:** pkarr/Mainline DHT publish and resolve in Go (and gomobile). Republish timer, derived keys.
- **C7 P2P transport:** pion WebRTC data channel in the server, and pion via gomobile in the app. Public STUN list. ICE restart on network change.
- **C8 Connection manager:** racing dialer per §6, path upgrade, status pill, "no path" screen with diagnostics.
- **C9 Optional relay:** embedded `pion/turn` behind "Act as relay" / `polymux-server relay`. QR-issued scoped credentials, caps, lender UI.
- **C10 Community relay list:** a plain file in the repo (`relays.json`), PR-maintained, signature-pinned in releases, opt-in only.
- **C11 Test matrix:** netns NAT simulation (full/restricted/port-restricted/symmetric, CGNAT), real-carrier field tests, connection-success telemetry kept **local only** (no phone-home).

## 9. Remaining tradeoffs for Carlvince (default in bold)
1. **iroh + n0 public relays for coordination instead of WebRTC/Nostr?** It is higher quality (n0 claims ~90%) and simpler to build, but n0's terms say "development and hobby use only" and they may block or rate-limit at any time. **Default: no. Use WebRTC + Nostr + DHT.** Revisit if n0 ever offers a free production tier for open-source apps.
2. **Bundled Nostr relay list:** **default on, 5 well-known free relays, user-editable.** It is the only third-party dependency used by default, and it carries signalling only.
3. **Community relay list in-app:** **shown only on the "no path" screen, opt-in, volunteer relays with a clear warning.**
4. **"Act as relay" on a user's own Mac:** **off by default, one toggle.** It needs a reachable UDP/TCP port (UPnP/NAT-PMP attempted automatically).
5. **Public STUN servers (Google, Cloudflare):** **use them as best-effort, multiple, plus peer-observed addresses.** They see only a STUN ping.
6. **Push notifications while the phone is backgrounded:** **out of scope.** APNs needs a sender, which means a server. Show updates on foreground instead.
7. **Local-only connection diagnostics:** **on, never uploaded.**

## Sources
- iroh relays: https://www.iroh.computer/docs/concepts/relays ; public relays policy: https://docs.iroh.computer/iroh-services/relays/public ; rate limiting: https://docs.iroh.computer/relays/rate-limiting ; shared (paid): https://docs.iroh.computer/iroh-services/relays/shared ; add a relay: https://docs.iroh.computer/add-a-relay ; FFI: https://github.com/n0-computer/iroh-ffi
- Nostr: https://github.com/nostr-protocol/nips/blob/master/01.md , https://github.com/nostr-protocol/nips/blob/master/11.md , https://github.com/nostr-protocol/nips/blob/master/44.md
- Mainline DHT / pkarr: https://github.com/pubky/pkarr , https://www.bittorrent.org/beps/bep_0044.html
- WebRTC TURN: https://webrtc.org/getting-started/turn-server ; pion: https://github.com/pion/webrtc , https://github.com/pion/turn
- libp2p: https://github.com/libp2p/specs/blob/master/relay/circuit-v2.md , https://github.com/libp2p/go-libp2p/blob/master/p2p/protocol/circuitv2/relay/resources.go
- Hole-punch measurements: https://probelab.io/blog/can-libp2p-punch-through-nats/ , https://github.com/probe-lab/dcutr-project/blob/main/docs/dcutr-final-report.md
- Mobile/CGNAT: https://ar5iv.labs.arxiv.org/html/2311.04658 , https://cs.ucr.edu/~zhiyunq/pub/sigcomm11_netpiculet.pdf
- OpenCode (mDNS reference): https://opencode.ai/docs/server/ , https://opencode.ai/docs/web/
- OpenTunnel (rejected): https://opentunnel.net/
- Polymux code: github.com/CarlvinceTan/Polymux @ dd052ff, apps/server/cmd/server/{main,host,device}.go

## 10. Optional integrations (amendment, 11 Oct 2026)
Server-free linking (§2–§6) stays the default and needs nothing else. **Tailscale is kept**, not removed: it becomes an opt-in integration instead of a requirement. Opt-in integrations exist for users who want always-reachable links and/or background push; none is enabled by default and none is run by Polymux.

| Integration | What it adds | Cost/setup for the user | Phase |
|---|---|---|---|
| **Tailscale** (existing code path) | Always-reachable link wherever both devices are on the tailnet, including symmetric NAT/CGNAT (DERP fallback) | Tailscale account + app on both devices; server flag `-tailscale` / Settings toggle | Phase 1: made optional (no longer required); UI toggle later |
| **Self-hosted relay** (§3/C9, `polymux-server relay` or a friend's relay) | Reachability when no direct path exists | A VPS/home box with a reachable port, or a friend's relay QR | Phase 2–3 |
| **Push sender** (own APNs key, below) | Real background push | Apple Developer Program membership | Optional, self-build only |

Phase 1 change to §8 C2: "Remove Tailscale" becomes **"Make Tailscale optional"**: the server no longer fails without a tailnet interface; with `-tailscale` (or `POLYMUX_TAILSCALE=1`) it binds the tailnet IP exactly as today.

### 10.1 iOS background push: honest note
- Real background push (alert while the phone app is suspended, or a silent push that wakes it) **requires APNs**, and APNs only accepts requests from a provider holding credentials for the app's team: a token signed with a `.p8` APNs key (Key ID + Team ID, `apns-topic` = the bundle ID) or a provider certificate. Sources: https://developer.apple.com/help/account/capabilities/communicate-with-apns-using-authentication-tokens/ , https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns , https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns .
- **The user's own Mac cannot send APNs for the App Store build** unless the team's `.p8` key ships inside the app. That key can push to every install of the app and cannot be scoped per user, so shipping it is unsafe. **Not done.** (The existing `internal/push/apns.go` path works only when the operator supplies their own key via `POLYMUX_APNS_KEY_FILE`.)
- Options without a Polymux server:
  1. **Self-build with your own Apple Developer account** ($99/yr): build the app under your team/bundle ID, put your own `.p8` on your Mac, and the Mac sends APNs directly. Real push, but developer-only.
  2. **Tailscale (or LAN) + the Mac holding a connection open:** gives reachability, not background wake. iOS suspends the app shortly after it leaves the foreground, so the socket dies; updates appear on foreground only. https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time
  3. **ntfy / UnifiedPush-style:** on iOS, ntfy's own app still relies on APNs; a self-hosted ntfy server must forward via the ntfy.sh upstream (`upstream-base-url`) to get instant iOS notifications, i.e. a third-party service holding the APNs key (https://docs.ntfy.sh/config/#ios-instant-notifications). UnifiedPush has no iOS distributor. Polymux cannot reuse ntfy's APNs topic for its own app. Not a server-free option.
  4. **Local notifications via Background App Refresh (`BGAppRefreshTask`)**: the app wakes occasionally, polls the Mac, and posts a local notification. Best-effort only: the system decides whether and when to run it, can skip it entirely, and the user can disable it; not timely. https://developer.apple.com/documentation/backgroundtasks/bgapprefreshtask , https://developer.apple.com/documentation/backgroundtasks/bgtaskscheduler
- **Default:** foreground updates + opt-in background-refresh local notifications (labelled "may be delayed"); real push only for self-builders with their own key. §9 #6 stands.

## 11. Any device can be the server (amendment, 11 Oct 2026)
**Setup = download the app on each device and pair.** Every install gets full access once paired. The Go server ships inside the app wherever feasible (macOS app bundle; Windows/Linux builds when they exist; not iOS, see limits).

**Choosing the server.** Settings > Devices lists all linked devices (name, kind, online state, last seen, power, uptime). The user marks exactly one as **Server**: the host that runs agents and holds data. If none is chosen, auto-pick by score, in this order: can run the server (excludes iOS) > desktop/Mac over laptop > on mains power > longest 7-day uptime > CPU cores > RAM; ties go to the device that did the pairing. The choice is a signed record replicated to every paired device; the user can change it at any time.

**Server offline.** Clients show "Server offline (last seen …)", keep a read-only local cache of recent chats, memory and routines, and queue new sends in an outbox (idempotent request IDs, which the server already dedupes per PARITY G4) that flushes in order on reconnect. Nothing executes while the server is offline.

**Switching the server (hand-off).** 1) The new host takes a snapshot of the old host (DB, memory, skills, routines, agent config, device registry) over the E2E link. 2) It applies an incremental sync until the lag is under ~1 s. 3) The old host **drains**: it stops accepting turns, finishes or checkpoints in-flight runs (B3 recovery), and sends a final delta. 4) **Atomic flip**: a signed `server=new, epoch+1` record is broadcast, clients reconnect, and the old host goes read-only. 5) **Rollback**: if verification (checksums plus a smoke turn) fails or the flip times out, the epoch reverts and the old host resumes. Epoch numbers fence out split-brain, so a stale host refuses writes.

**Server lost for good.** Optional client-side snapshots (default on for Macs/PCs, off for iOS because of storage) are E2E-encrypted, daily plus after major changes. Restoring: pick a new server, load the newest snapshot from any client that holds one, then bump the epoch. The UI states what may be missing (everything after the snapshot time). Without any snapshot, only the clients' read-only caches survive.

**Feasibility limits.** iOS can't be the always-on server: there's no background execution for long runs, and the app is suspended within seconds to minutes. iOS is client-only, plus an optional snapshot holder. A laptop server sleeps, so the auto-pick deprioritises it. Hand-off needs both devices online; otherwise it's a restore. Windows/Linux server builds depend on the Go server's portability (CGO sqlite and FTS5) and are unverified.

**Phase 1 constraints (so nothing here is blocked):** identities and pairings are role-neutral. Every install has its own Ed25519/X25519 keys, any device can issue or redeem a pairing offer, and pairing records store a role field (default `client`) plus room for the server epoch. Phase 1 code still only pairs a phone with the Mac's server.

## 12. Auto-updates and version compatibility (amendment, 11 Oct 2026)
Zero cost and no project server: every update channel is either a store or GitHub Releases.
- **macOS:** Sparkle 2 with an **EdDSA (ed25519)-signed appcast**. The appcast XML and the signed, **notarized** DMG/zip are attached to GitHub Releases, and the app's `SUFeedURL` points at the release asset URL. The signing key stays offline with Carlvince; the public key is in Info.plist. (https://sparkle-project.org/documentation/ , https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- **iOS:** App Store / TestFlight only. Apple handles updates.
- **Other platforms:** their stores where they exist (Microsoft Store, Flathub). Otherwise GitHub Releases, with an in-app check of the GitHub Releases API (unauthenticated, rate-limited, so at most once a day) and signature verification before install.
- **Bundled server** updates with its app (§11), so the server version equals the app version on that device.
- **Protocol compatibility:** each side sends `{proto, min_proto, app_version}` in the pairing handshake and on every connect (inside the Noise payload). The server supports clients at **N and N-1**. **The server updates first.** A client newer than the server's supported range, or older than N-1, refuses gracefully with "Update Polymux on <device> to continue" and keeps its read-only cache (§11). Hand-off (§11) requires that both hosts are on the same protocol.
- **Schema:** no breaking DB or schema change without a forward migration run on server start, a pre-migration snapshot, and a migration test; a down-migration or snapshot restore is the rollback.
- Phase 1 hook: the pairing offer and the Noise prologue carry `v=1` / `polymux/1`, which leaves room for the version exchange.
