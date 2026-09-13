# Conversation sharing

The chat menu creates a snapshot of the conversation. The share action beneath
an assistant reply includes messages through that reply, inclusively. Creation
freezes the content; later edits and messages do not change the link.

`POST /api/shares` returns `https://polymux.com/share/<random token>` and a
server-generated deadline 24 hours after creation. `GET /api/shares?id=<token>`
returns only an unexpired snapshot. Both responses disable caching. Public pages
are excluded from indexing and clear their content when the deadline passes.

## Hosting

Configure these **server-only** variables on the Polymux site deployment:

- `SHARES_REDIS_REST_URL`: the HTTPS endpoint of a Redis REST database.
- `SHARES_REDIS_REST_TOKEN`: its server credential with GET, SET and EVAL access.

The endpoint uses the Redis REST JSON command format supported by Upstash. No
credential is shipped to the desktop or browser. Redis removes snapshots with
an `EX 86400` TTL; the endpoint independently checks the stored deadline. There
is no process-local storage fallback. A missing or unavailable database produces
a retryable error in the modal, never a pretend link.

Deploy the site with repository files outside `apps/site` available: the public
transcript directly reuses the desktop Message, AgentActivity and stylesheet.
The site build substitutes a rejecting bridge for the desktop API; public pages
cannot invoke local actions. The `/share/:id` rewrite serves the dedicated entry.

Creation accepts at most 1 MB / 2,000 messages and 30 links per client IP per day.
The Vercel-provided client IP is hashed before use as a rate-limit key. Tokens
contain 192 random bits and are never reused or extended. Sharing is anonymous:
anyone holding a link can read it before expiry.

Snapshots contain message text, attachment names and activity display details.
Native attachment bytes, native file paths, run IDs, device/browser preview
handles, and account settings are not uploaded. Links and Markdown use the same
sanitized rendering as the app; desktop file actions are unavailable publicly.

## Verification

Run `node --test apps/site/test/shares.test.js` for expiry, storage TTL, cutoff,
validation and failure cases. `apps/desktop/src/renderer/tests/share.spec.ts`
covers menu/reply creation, the read-only field and actual clipboard feedback
using a mocked creation endpoint. These checks do not prove a production Redis
connection or deployment.
