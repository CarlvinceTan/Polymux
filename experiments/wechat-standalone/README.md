# Standalone WeChat transport experiment

This experiment asks one narrow question: can Polymux establish WeChat's own
encrypted transport without launching or attaching to WeChat Desktop?

As verified on 2026-08-31, the answer is **yes at the transport layer**. The
probe performs a fresh P-256 MMTLS handshake with `long.weixin.qq.com:80`, pins
and verifies the server signing key, derives application traffic keys, receives
resumption tickets, and exchanges an encrypted heartbeat. It uses only Node's
built-in networking and cryptography libraries.

The transport probe does **not** log in, send a message, read personal data, or
claim that personal-account authentication works. A separate companion probe
requests and validates an anonymous QR challenge, then discards it without
polling or involving an account. Neither probe uses WeChat Desktop.

The regional MMTLS verification key used by the native-login probe was
recovered consistently from two independent signatures returned by the
server-assigned regional endpoint. It is accepted only after a redirect
delivered through the already pinned WeChat transport and is not independently
extracted from an official iPad client. This remains an experiment-only trust
boundary, not a production pin.

## Run it

```sh
npm run test:wechat-standalone
npm run experiment:wechat-standalone
npm run experiment:wechat-auth-challenge
npm run experiment:wechat-login
```

`native-qr-probe.mjs` is a separate diagnostic for the current native QR
request. It requires an explicitly named network-disabled RQTX container and
passes that isolated helper only the MD5 digest of an already encrypted,
anonymous request. Account data, transport keys, and QR responses never enter
the helper. This is useful for protocol validation, but the opaque integrity
transform must be clean-room reimplemented before this path is shippable.

The live command is deliberately restricted to the known WeChat long-link host
and emits status only. It does not print ephemeral keys or session tickets.

## What is proven

| Layer                                    | Result          |
| ---------------------------------------- | --------------- |
| TCP access to WeChat long link           | Verified        |
| MMTLS `0xf104` ECDHE negotiation         | Verified        |
| Pinned server signature                  | Verified        |
| Encrypted application heartbeat          | Verified        |
| Anonymous legacy Web WeChat QR challenge | Verified        |
| Anonymous native personal-client QR      | Experimental    |
| Personal-account QR approval/login       | Not attempted   |
| Contact sync and messaging               | Not implemented |

## Authentication boundary

The next native-MMTLS milestone is a current, accepted personal-account QR
request. Historical protocol work identifies the shape as:

1. create a logged-out device identity and static inner ECDH material;
2. encode a `GetLoginQRCodeRequest` and send CGI `502` through MMTLS;
3. poll the returned QR UUID until the phone approves it;
4. complete `manualauth`, persist the server-issued session, and perform initial
   sync.

Those are separate from the MMTLS transport proven here. The uncertain parts
are the current protobuf fields, inner request encryption/framing, and whether
WeChat accepts a newly generated third-party device identity. Testing those
against a primary account would carry an account restriction risk, so the next
live step should use a dedicated disposable test account.

There is also a narrower fallback path: Tencent's still-live legacy Web WeChat
endpoint currently issues an anonymous QR challenge and image without WeChat
Desktop. The second live probe validates and discards that image without
printing its token. This proves that a login prompt can be created, but **not**
that a particular account will be allowed to complete Web WeChat login. That
eligibility check necessarily requires a user to scan the QR code and should be
done only with a disposable test account.

`experiment:wechat-login` writes the ephemeral QR and login state into a
private temporary directory, then polls for scan and phone approval for up to
four minutes. The approval redirect is treated as a credential: it is never
printed and is stored with owner-only file permissions.

## Research basis

- [Citizen Lab's protocol report](https://github.com/citizenlab/wechat-security-report)
  documents MMTLS and WeChat's inner business-layer encryption.
- [Tencent's MMTLS overview](https://github.com/WeMobileDev/article/blob/master/%E5%9F%BA%E4%BA%8ETLS1.3%E7%9A%84%E5%BE%AE%E4%BF%A1%E5%AE%89%E5%85%A8%E9%80%9A%E4%BF%A1%E5%8D%8F%E8%AE%AEmmtls%E4%BB%8B%E7%BB%8D.md)
  describes the transport design.
- [gommtls](https://github.com/duo/gommtls) provides an independently testable
  public reference for the wire format and key schedule.
- [Tencent's iLink/OpenClaw integration](https://github.com/Tencent/openclaw-weixin)
  is a useful comparison, but its QR flow authorizes a bot identity; it is not a
  personal WeChat custom-client login.

This is research code, not a production bridge. It intentionally stops before
account authentication.
