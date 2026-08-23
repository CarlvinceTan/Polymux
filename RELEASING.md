# Releasing Polymux

Polymux can be packaged for macOS Apple silicon, Windows x64 and Linux x64.
Platform coverage is explicit rather than emulated:

- macOS ships all 14 bundled messaging bridges.
- Linux x64 ships 13 native bridges, including the pinned Google Chat CI
  artifact; only iMessage is unavailable.
- Windows ships the desktop app and built-in tools, but no messaging bridges,
  because upstream does not publish Windows binaries. The Hub reports them as
  unavailable and never packages foreign executables.

JavaScript skill helpers use the pinned Node runtime bundled with Polymux. The
user does not need to install Node, Python, or another development runtime.

## One-time GitHub configuration

Add these Actions secrets to `CarlvinceTan/Polymux`:

- `MACOS_CERT_P12`: base64-encoded Developer ID Application certificate.
- `MACOS_CERT_PASSWORD`: password protecting that certificate.
- `APPLE_ID`: Apple ID used for notarisation.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for that Apple ID.
- `APPLE_TEAM_ID`: Apple Developer team identifier.
- `POLYMUX_TELEGRAM_API_ID` and `POLYMUX_TELEGRAM_API_HASH`: optional bundled Telegram application credentials.

The workflow discovers the imported Developer ID identity rather than storing its display name as another secret.

## Release gate

1. Set the new stable version in the root `package.json` on `dev`. This is the
   single release-version source; the website package's internal version does
   not control desktop releases.
2. Open a pull request from `dev` into `main`. The `Release version` check
   refuses a reused, malformed, unchanged, or older version.
3. Run `npm ci`, `npm run build`, `npm run package`, and
   `npm --prefix apps/site run build` on macOS.
4. Confirm `Polymux.app` opens and its signature is valid.
5. Confirm the DMG installs into `/Applications`, first-run onboarding works,
   and a basic local chat completes.
6. Merge the pull request. GitHub Actions creates the annotated `v<version>`
   tag and dispatches the release build automatically; do not create a tag by
   hand for this path.

The tag workflow builds, signs, notarises, makes the platform installers,
verifies them, and creates the GitHub Release. The Vercel endpoint at
`https://polymux.com/api/releases` turns the latest public GitHub Release into
the Squirrel.Mac update feed.

Do not make the repository public or push a release tag until the repository-history privacy audit and signing checks both pass.
