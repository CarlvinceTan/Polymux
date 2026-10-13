# Grok Bot avatar defaults (mirror → Polymux)

`profile.json` fields: `avatarShape`, `avatarColor` (English ids from Grok Bot).

## TODO — empty `avatarColor` (`-` or missing)

Match what Grok Bot's sidebar actually renders for each agent (verify on box):

| Agent | Shape | Color (Grok) | Polymux fallback today |
| --- | --- | --- | --- |
| Bolt | wedge | - | triangle + encre |
| Cody | blob | - | galet + encre |
| Odin | wedge | - | triangle + encre |
| Tide | wedge | - | triangle + encre |
| Polymux | (unset) | (unset) | app default cercle/encre |
| Caprtech | (unset) | (unset) | app default |
| Trader | (unset) | (unset) | app default |
| Argus | (unset) | (unset) | app default |

Until this table is verified, `contract.GrokBotAvatarDesign` uses `encre` when color is empty.
