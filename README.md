# npm-trustme

npm-trustme automates npm Trusted Publisher setup with a one-time WebAuthn approval.

![License](https://img.shields.io/badge/License-MIT-yellow?style=flat&colorA=18181B&colorB=28CF8D)
[![Stars](https://img.shields.io/github/stars/regenrek/npm-trustme.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://github.com/regenrek/npm-trustme/stargazers)
[![npm](https://img.shields.io/npm/v/npm-trustme?logo=npm)](https://www.npmjs.com/package/npm-trustme)

## Why
- npm revoked classic tokens and limits granular tokens to short lifetimes, so long-lived CI tokens are unreliable.
- Local npm login now issues short-lived sessions, which forces repeated manual auth.
- Trusted Publishers solve this, but npm only exposes setup via the browser UI.

npm-trustme reduces the manual work to a single WebAuthn approval, then automates the rest.

## Features
- Browser automation (Playwright) to add Trusted Publishers end-to-end.
- Reuse an existing Chrome session via CDP (keeps your main browser open).
- Inline cookie payloads via Sweet Cookie (no native addons).
- `.env` driven config with `--env-file` override.

## Quick Start

### Install (dev)
Requires Node >= 22.

```bash
pnpm install
npx playwright install
```

```bash
npx npm-trustme ensure --inline-cookies-file /path/to/sweet-cookie.cookies.json
```

### Run
```bash
npx npm-trustme ensure --yes
```

### Generate npm-release.yml
Create a GitHub Actions workflow that publishes via Trusted Publishing:

```bash
npx npm-trustme workflow init
```

Common overrides:
```bash
npx npm-trustme workflow init \
  --file npm-release.yml \
  --pm pnpm \
  --node 22 \
  --trigger release \
  --workflow-dispatch true \
  --build-command "pnpm build"
```

### Doctor
Check local readiness (Node, Playwright, Chrome, config):
```bash
npx npm-trustme doctor
```

### Example (explicit flags)
```bash
npx npm-trustme ensure \
  --package <PACKAGE_NAME> \
  --owner <GITHUB_OWNER> \
  --repo <GITHUB_REPO> \
  --workflow npm-release.yml \
  --publishing-access disallow-tokens \
  --yes
```

### Check only
```bash
npx npm-trustme check
```

### Auto-detection (default)
If you omit flags, npm-trustme will infer:
- `--package` from `package.json#name`
- `--owner`/`--repo` from `git remote origin`
- `--workflow` from `.github/workflows/npm-release.yml` (or the only workflow file)

## Environment Variables
```bash
NPM_TRUSTME_PACKAGE=<PACKAGE_NAME>
NPM_TRUSTME_OWNER=<GITHUB_OWNER>
NPM_TRUSTME_REPO=<GITHUB_REPO>
NPM_TRUSTME_WORKFLOW=npm-release.yml
NPM_TRUSTME_PUBLISHING_ACCESS=disallow-tokens

# Optional GitHub environment
# NPM_TRUSTME_ENVIRONMENT=

# Optional runtime tweaks
# NPM_TRUSTME_STORAGE=.cache/npm-trustme-storage.json
# NPM_TRUSTME_SCREENSHOT_DIR=.cache/screenshots
# NPM_TRUSTME_CONFIG=~/.npm-trustme/config.json
# NPM_TRUSTME_INLINE_COOKIES_JSON=
# NPM_TRUSTME_INLINE_COOKIES_BASE64=
# NPM_TRUSTME_INLINE_COOKIES_FILE=

# Optional Chrome profile reuse (manual login/session)
# NPM_TRUSTME_CHROME_PROFILE=Default
# NPM_TRUSTME_CHROME_PROFILE_DIR=/path/to/Chrome/Profile 1
# NPM_TRUSTME_CHROME_USER_DATA_DIR=/path/to/Chrome/User Data
# NPM_TRUSTME_CHROME_PATH=/path/to/Chrome
# NPM_TRUSTME_CHROME_CDP_URL=http://127.0.0.1:9222
# NPM_TRUSTME_CHROME_DEBUG_PORT=9222
```

## 2FA / Passkeys (Trusted Publisher UI)
The Trusted Publisher UI submit triggers WebAuthn. The smoothest path is:
- iCloud Keychain passkey
- Hardware security key (YubiKey, etc.)
- Google Password Manager / Chrome passkeys

Password-manager browser extensions can work, but require installing + signing into the extension in the same profile used by the automation. This is usually more effort than using your platform passkey or hardware key.

## Notes
- Requires Node >= 22 (Sweet Cookie uses node:sqlite).
- Chrome profile reuse: `--chrome-profile` / `--chrome-profile-dir` / `--chrome-user-data-dir` / `--chrome-path`.
- Connect to an existing Chrome: `--chrome-cdp-url` or `--chrome-debug-port` (Chrome must be launched with remote debugging).
- Cookie import can be toggled with `--import-cookies` or `NPM_TRUSTME_IMPORT_COOKIES` (default: true).
- Dedicated Chrome (keeps your main browser open + supports passkey extensions):
  - `npm-trustme chrome start` launches a dedicated Chrome profile with CDP on port 9222 and saves it to config.
  - `npm-trustme chrome status` checks if the CDP endpoint is available.
- Cookie import uses `@steipete/sweet-cookie` (no native addons). Inline cookies from the Sweet Cookie extension are supported.
- Cookie sync lets you keep Chrome open; npm-trustme copies npmjs.com cookies into a fresh browser context when possible.
- If the workflow filename includes a path, it is normalized to just the filename.
- `publishing-access` options:
  - `disallow-tokens` (recommended for OIDC-only)
  - `allow-bypass-token` (allows granular tokens with bypass 2FA)
  - `skip`
- `npm-trustme ensure` prompts for confirmation; use `--yes` to skip (required in non-interactive runs).
- The script never prints secrets; screenshots are saved only on errors when `--screenshot-dir` is provided.

## Security
- Inline cookie payloads should live outside your repo or in a gitignored path.
- npm-trustme only reads cookies into an ephemeral browser context unless you connect to an existing Chrome via CDP.
- Passkey/2FA happens in the browser; npm-trustme does not store tokens or passwords.
- Screenshots/storage state (when enabled) are written with restrictive perms (dir 700, file 600).

## Codex Skill
This repo ships a Codex skill at `.codex/skills/npm-trustme`.

Copy it into a project so agents can use this repo correctly:
```bash
mkdir -p /path/to/your/repo/.codex/skills
cp -R .codex/skills/npm-trustme /path/to/your/repo/.codex/skills/
```

Trigger it in prompts with `npm-trustme` or `$npm-trustme`.
