# Hub backend operations

Read this reference only for bridge health, linking, repair, room invitations, or
runtime maintenance. Ordinary message retrieval uses the core skill and the
`message_*` tools directly.

## What the backend is

FlareAI runs its own Matrix homeserver and bridge fleet inside the app. There is
no separately installed server, no MCP registration and no launch agent to
inspect: the hub starts and stops with FlareAI, its data lives under FlareAI's
own application-support directory, and it is reached through the `message_*` and
`email_*` tools rather than over the network.

So the hub's own surface is where it is administered — Settings → Hub lists every
platform, its connection state and its login route. Report what those tools and
that tab actually say; never infer a working bridge from the app being open, and
never surface a bridge credential in tool output.

## Supported routing and health

The hub bridges WhatsApp, Telegram, Discord, Messenger, Instagram, LinkedIn,
iMessage and WeChat for read/sync and text sending. Connection state is live
data, not a permanent claim, and each platform is connected separately: one
working bridge says nothing about the next. WeChat outbound in particular is a
separate capability from inbound sync and must be checked on its own.

For health checks, distinguish:

1. the bridge process being available;
2. the remote account being authenticated;
3. the remote transport being connected with a current heartbeat or sync;
4. the Matrix user being joined to the portal room;
5. a real inbound or outbound event having been bridged successfully.

Do not call a bridge ready on the strength of a running process or a saved
token alone. Before reporting that a chat can be read, confirm the room exists
and has recent traffic; before reporting a send succeeded, require the tool's
positive delivery result and a matching message in that exact chat.

## Trusted invitation handling

Room invitations are accepted only when the invite targets the configured Matrix
user and the sender belongs to this local homeserver's own bridge bots or ghost
namespaces. An invitation from anywhere else stays pending rather than being
joined — treat one as a finding to report, not something to accept manually.

## Linking and repair

Prefer each platform's own login route in Settings → Hub. Use a user-attention
handoff only when a secret, 2FA, QR approval, CAPTCHA or other genuinely
user-only step remains, and load `gui-control` before anything that may
initialize or reveal a local GUI app.

After linking or repair, verify both the remote connected state and a real
message result before calling it fixed. Do not retain temporary login helpers or
sessions.
