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
- WebAuthn-friendly token bootstrap (opens auth URL, polls for approval).
- Browser automation (Playwright) to add Trusted Publishers end-to-end.
- Inline cookie payloads via Sweet Cookie (no native addons).
- Provider-based credential system; add your own password manager in one file.
- 1Password CLI integration (`op`) + interactive fallback.
- `.env` driven config with `--env-file` override.

## Quick Start

### Install (dev)
Requires Node >= 22.

```bash
pnpm install
npx playwright install
```

### Configure
Copy `.env.example` to `.env` and fill in values.

### Optional: inline cookies (no DB access)
If you can’t read local cookies (locked DB, app-bound cookies, remote machine), export cookies via the Sweet Cookie Chrome extension and pass the payload:

```bash
npx npm-trustme ensure --inline-cookies-file /path/to/sweet-cookie.cookies.json
```

### Bootstrap token (recommended for WebAuthn-only accounts)
```bash
npx npm-trustme token create \
  --name trustme-setup \
  --packages <PACKAGE_NAME> \
  --bypass-2fa \
  --output .npm-trustme/token.json
```

### Capture template (one-time)
Run this once in browser mode to capture the Trusted Publisher form template:

```bash
npx npm-trustme capture \
  --package <PACKAGE_NAME> \
  --owner <GITHUB_OWNER> \
  --repo <GITHUB_REPO> \
  --workflow npm-release.yml \
  --login-mode browser
```

### Run
```bash
npx npm-trustme ensure
```

### Run (token mode, no browser)
```bash
npx npm-trustme ensure \
  --auth-token <GRANULAR_TOKEN> \
  --publishing-access skip
```

### Example (explicit flags)
```bash
npx npm-trustme ensure \
  --package <PACKAGE_NAME> \
  --owner <GITHUB_OWNER> \
  --repo <GITHUB_REPO> \
  --workflow npm-release.yml \
  --publisher github \
  --publishing-access disallow-tokens \
  --op-vault "Personal" \
  --op-item "npmjs.com"
```

### Check only
```bash
npx npm-trustme check
```

## Environment Variables
```bash
NPM_TRUSTME_PACKAGE=<PACKAGE_NAME>
NPM_TRUSTME_OWNER=<GITHUB_OWNER>
NPM_TRUSTME_REPO=<GITHUB_REPO>
NPM_TRUSTME_WORKFLOW=npm-release.yml
NPM_TRUSTME_PUBLISHER=github
NPM_TRUSTME_PUBLISHING_ACCESS=disallow-tokens
# NPM_TRUSTME_LOGIN_MODE=auto

# Optional GitHub environment
# NPM_TRUSTME_ENVIRONMENT=

# 1Password item lookup (preferred)
NPM_TRUSTME_OP_VAULT=Personal
NPM_TRUSTME_OP_ITEM=npmjs.com
# Optional custom field names
# NPM_TRUSTME_OP_USERNAME_FIELD=username
# NPM_TRUSTME_OP_PASSWORD_FIELD=password
# NPM_TRUSTME_OP_OTP_FIELD=one-time password

# Optional direct credential overrides (discouraged)
# NPM_TRUSTME_USERNAME=
# NPM_TRUSTME_PASSWORD=
# NPM_TRUSTME_OTP=

# Token bootstrap (optional)
# NPM_TRUSTME_SESSION_TOKEN=
# NPM_TRUSTME_TOKEN_PATH=~/.npm-trustme/token.json
# NPM_TRUSTME_PRINT_TOKEN=false
# NPM_TRUSTME_AUTH_TOKEN=

# Bitwarden CLI
# NPM_TRUSTME_BW_ITEM=
# NPM_TRUSTME_BW_SESSION=

# LastPass CLI
# NPM_TRUSTME_LPASS_ITEM=
# NPM_TRUSTME_LPASS_OTP_FIELD=totp

# KeePassXC CLI
# NPM_TRUSTME_KPX_DB=
# NPM_TRUSTME_KPX_ENTRY=
# NPM_TRUSTME_KPX_KEYFILE=
# NPM_TRUSTME_KPX_PASSWORD=
# NPM_TRUSTME_KPX_PW_STDIN=true

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

## Notes
- Requires Node >= 22 (Sweet Cookie uses node:sqlite).
- Login modes:
  - `auto` (default): uses credential providers to log in.
  - `browser`: uses an existing Chrome profile/session and waits for manual login if needed.
- Chrome profile reuse: `--chrome-profile` / `--chrome-profile-dir` / `--chrome-user-data-dir` / `--chrome-path`.
- Connect to an existing Chrome: `--chrome-cdp-url` or `--chrome-debug-port` (Chrome must be launched with remote debugging).
- Cookie import can be toggled with `--import-cookies` or `NPM_TRUSTME_IMPORT_COOKIES` (default: true).
- Dedicated Chrome (keeps your main browser open + supports passkey extensions):
  - `npm-trustme chrome start` launches a dedicated Chrome profile with CDP on port 9222 and saves it to config.
  - `npm-trustme chrome status` checks if the CDP endpoint is available.
  - After first run, install the 1Password extension and sign in to npm once in that profile.
- Token bootstrap uses the npm registry web auth flow. If no session token is found, run `npm login --auth-type=web` first.
- Cookie import uses `@steipete/sweet-cookie` (no native addons). Inline cookies from the Sweet Cookie extension are supported.
- Cookie sync lets you keep Chrome open; npm-trustme copies npmjs.com cookies into a fresh browser context when possible.
- Token mode requires a captured template (`npm-trustme capture`). It does not update publishing access; use `--publishing-access skip` or run browser mode for that step.
- If the workflow filename includes a path, it is normalized to just the filename.
- `publishing-access` options:
  - `disallow-tokens` (recommended for OIDC-only)
  - `allow-bypass-token` (allows granular tokens with bypass 2FA)
  - `skip`
- The script never prints secrets; screenshots are saved only on errors when `--screenshot-dir` is provided.
- To add a new password manager, implement a `CredentialProvider` in `src/core/credentials/providers` and register it in `src/core/credentials/index.ts`.
- Password manager providers supported out of the box: 1Password, Bitwarden, LastPass, KeePassXC.

## Codex Skill
This repo ships a Codex skill at `.codex/skills/npm-trustme`.

Copy it into a project so agents can use this repo correctly:
```bash
mkdir -p /path/to/your/repo/.codex/skills
cp -R .codex/skills/npm-trustme /path/to/your/repo/.codex/skills/
```

Trigger it in prompts with `npm-trustme` or `$npm-trustme`.
