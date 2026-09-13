# Polymux Connect

Polymux Connect is the public transport for Personal Hosts. Each Host keeps its
HTTP server on loopback and opens an authenticated outbound WebSocket to one
Durable Object. Mobile and Desktop clients call
`https://connect.polymux.com/h/<host-id>/polymux-host/v1/*`; the object forwards
each bounded request to the connected Host and returns its response.

Manual pairing uses `POST https://connect.polymux.com/connect`. The Host
publishes a short-lived nine-digit code to a strongly consistent, prefix-sharded
directory; the relay rate-limits attempts, resolves the code, and forwards only
the pairing request. Codes never appear in URLs and are removed after pairing
or expiry.

End users do not create a Cloudflare, Polymux, or VPN account. The Host creates
its opaque id and relay secret locally. The relay stores only a SHA-256 digest
of that Host secret and does not persist request or response bodies. Pairing is
still protected by the Host's short-lived code, attempt limit, and hashed
post-pairing bearer credential. Traffic is encrypted with HTTPS/WSS on both
network legs and terminates at Polymux Connect.

## Development

```sh
npm install
npm run types
npm run check
npm test
npm run dev
```

Point a development Host at the local Worker with
`POLYMUX_HOST_RELAY_ENDPOINT=http://127.0.0.1:8787`.

## Deployment

`wrangler.jsonc` declares the SQLite-backed Durable Object, current
compatibility date, production observability, and a `workers.dev` origin. After
authenticating Wrangler to the Polymux Cloudflare account:

```sh
npm run dry-run
npm run deploy
```

Wrangler prints the generated HTTPS `workers.dev` origin. Set that value as the
`POLYMUX_CONNECT_UPSTREAM` production variable of the sibling
`apps/connect/edge` Vercel deployment, deploy the edge, and assign
`connect.polymux.com` to it. Vercel already owns the domain's authoritative DNS
and forwards bounded mobile HTTPS requests. The Host discovers the direct
`workers.dev` WSS origin from `https://connect.polymux.com/connect-config`, so
the public QR remains on the Polymux domain without asking Vercel's HTTP rewrite
to carry a WebSocket or requiring a nameserver migration.

No Worker secret is required; each Host self-registers the first time its
unguessable id connects and every later connection must present the same
locally stored secret.
