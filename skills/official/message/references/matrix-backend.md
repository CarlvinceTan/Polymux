# Matrix backend operations

Read this reference only for bridge administration, MCP loading, trusted room
joining, reconnection, or repair. Ordinary message retrieval uses the core
skill and Matrix tools directly.

## Installed components

- Hub root: `/Users/carlvincetan/Library/Application Support/matrix-hub`
- MCP server: `mcp/server.mjs`
- Midas MCP registration: the `matrix-hub` server in Midas's MCP
  configuration (Settings → MCP, stored at
  `~/Library/Application Support/Midas/mcp.json`)
- Trusted invite service:
  `/Users/carlvincetan/Library/Application Support/matrix-hub/bin/matrix-hub-autojoin`
- LaunchAgent: `com.carlvince.matrix-hub.autojoin`
- Auto-join log: `logs/autojoin.log`
- WeChat read bridge LaunchAgents:
  `com.carlvince.matrix-hub.wechat-http` and
  `com.carlvince.matrix-hub.wechat`
- WeChat bridge health endpoints: `http://127.0.0.1:18400/health` and
  `http://127.0.0.1:29350/health`

The MCP credential is read from the macOS login keychain service
`Matrix Hub Midas Token`. Never print it. Each bridge keeps its own credentials
inside its private bridge data directory; never surface them in tool output.

## Supported routing and health

The hub is configured for WhatsApp, Telegram, Discord, Messenger, Instagram,
LinkedIn, iMessage, and WeChat read/sync and text sending. Connection state is
live data, not a permanent claim. WeChat outbound remains a separate capability
that must be checked independently from inbound sync.

For health checks, distinguish:

1. bridge process available;
2. remote account authenticated;
3. remote transport connected with a current heartbeat or sync;
4. Matrix user joined to the portal room;
5. a real inbound or outbound event bridged successfully.

Do not call a bridge ready based only on a running container or saved token.
For WeChat reading, also require a healthy local HTTP bridge, a successful
Matrix appservice ping, joined portal rooms, and an established inbound stream.
Use `wechat doctor --json` to verify `query_ready`; its overall status may still
report that optional initialization is incomplete. The local send endpoint
accepts `chatId` and `message`; do not substitute other field names. Never test
outbound delivery without the exact normal send authorization. Require the
bridge's positive delivery result and a matching message in the exact WeChat
chat before reporting success.

## Trusted invitation handling

The auto-join service long-polls Matrix with timeline content disabled and
examines only invite membership state. It joins a room only when:

- the invite targets the configured Matrix user;
- the sender belongs to this exact local homeserver; and
- the sender is one of the configured bridge bots or ghost namespaces.

Unknown Matrix invitations remain pending. The service uses bounded concurrent
joins, retries after restart, and never reads room messages. For Discord rooms,
it also invites and joins the local Discord bridge bot so group-message senders
can bridge correctly.

Check it without opening a GUI:

```bash
launchctl print "gui/$(id -u)/com.carlvince.matrix-hub.autojoin"
tail -n 50 "/Users/carlvincetan/Library/Application Support/matrix-hub/logs/autojoin.log"
```

## MCP loading and verification

The registered server provides:

- `matrix_list_rooms`
- `matrix_get_messages`
- `matrix_search_messages`
- `matrix_get_unread_messages`
- `matrix_send_message`

After changing or newly registering the MCP server, a running Midas task may
not discover it dynamically. Verify tool discovery in a fresh task before
calling the integration active. A local smoke test may use the MCP SDK over
stdio, but it does not prove that the current Midas task reloaded its tool
catalog.

## Linking and repair

Prefer each bridge's local provisioning or management API. Use an isolated
user-attention login handoff only when a secret, 2FA, QR approval, CAPTCHA, or
other genuinely user-only step remains. Load `window-control` before anything
that may initialize or reveal a local GUI.

After linking or repair, verify remote connected state and a Matrix-side
message result. Do not retain temporary login helpers or sessions.

