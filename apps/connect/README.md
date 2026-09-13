# Polymux Connect

Polymux Connect is one service with two deployment targets:

- `relay` is the Cloudflare Worker and Durable Object transport. It owns pairing,
  authenticated Host WebSockets, and request forwarding.
- `edge` is the small Vercel routing layer that keeps public HTTPS requests on
  `connect.polymux.com` while the domain remains on Vercel.

Mobile and Desktop HTTPS requests enter through `edge` and reach `relay`. A Host
discovers the Worker's origin through `/connect-config`, then opens its
authenticated WebSocket directly to `relay` because Vercel external rewrites do
not preserve WebSocket upgrades.

Use the root `connect:*` and `test:connect*` scripts to work with the service.
