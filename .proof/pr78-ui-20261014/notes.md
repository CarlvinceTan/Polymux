# PR #78 macOS captures (2026-10-14)

Real macOS captures of the running app, not mockups: the debug Polymux.app launched in the Aqua
session on cvmini with `--verify-fixture` (isolated local transport, no server), driven through its
accessibility tree with the Cua driver. Build head: `8b19c2b` (merge of origin/main into the PR
branch).

Flow per theme: select the Aria chat, open the profile editor from the chat header, press
"Edit avatar".

| file | theme | what it shows |
| --- | --- | --- |
| `mac-light-profile.png` | light | "Edit profile" editor, profile fields loaded |
| `mac-light-avatar.png` | light | "Aria's avatar" editor, shape options |
| `mac-dark-profile.png` | dark | "Edit profile" editor, profile fields loaded |
| `mac-dark-avatar.png` | dark | "Aria's avatar" editor, shape options |

Light used the system appearance; dark used `POLYMUX_VERIFY_THEME=dark` (see
`apps/Polymux/Sources/VerifyFixture.swift`), so both themes come from the app's own theme path.

`bash scripts/verify.sh` at `8b19c2b`: PASS (full targets, UI-verified, readiness yes).
