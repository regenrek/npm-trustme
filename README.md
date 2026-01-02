# npm-trustme

npm-trustme gives you a 100% automated way to set up npm Trusted Publishers.

![License](https://img.shields.io/badge/License-MIT-yellow?style=flat&colorA=18181B&colorB=28CF8D)
[![Stars](https://img.shields.io/github/stars/regenrek/npm-trustme.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://github.com/regenrek/npm-trustme/stargazers)
[![npm](https://img.shields.io/npm/v/npm-trustme?logo=npm)](https://www.npmjs.com/package/npm-trustme)

## Why
- npm revoked classic tokens and limits granular tokens to short lifetimes, so long-lived CI tokens are unreliable.
- Local npm login now issues short-lived sessions, which forces repeated manual auth.
- Trusted Publishers solve this, but npm only exposes setup via the browser UI.

npm-trustme automates that UI so teams can keep releases fully automated.

## Features
- Browser automation (Playwright) to add Trusted Publishers end-to-end.
- Provider-based credential system; add your own password manager in one file.
- 1Password CLI integration (`op`) + interactive fallback.
- `.env` driven config with `--env-file` override.

## Quick Start

### Install
```bash
pnpm install
npx playwright install
```

### Configure
Copy `.env.example` to `.env` and fill in values.

### Run
```bash
pnpm tsx src/cli/main.ts ensure
```

### Example (explicit flags)
```bash
pnpm tsx src/cli/main.ts ensure \
  --package codex-1up \
  --owner regenrek \
  --repo codex-1up \
  --workflow npm-release.yml \
  --publisher github \
  --publishing-access disallow-tokens \
  --op-vault "Personal" \
  --op-item "npmjs.com"
```

### Check only
```bash
pnpm tsx src/cli/main.ts check
```

## Environment Variables
```bash
NPM_TRUSTME_PACKAGE=codex-1up
NPM_TRUSTME_OWNER=regenrek
NPM_TRUSTME_REPO=codex-1up
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

# Optional Chrome profile reuse (manual login/session)
# NPM_TRUSTME_CHROME_PROFILE=Default
# NPM_TRUSTME_CHROME_PROFILE_DIR=/path/to/Chrome/Profile 1
# NPM_TRUSTME_CHROME_USER_DATA_DIR=/path/to/Chrome/User Data
# NPM_TRUSTME_CHROME_PATH=/path/to/Chrome
# NPM_TRUSTME_CHROME_CDP_URL=http://127.0.0.1:9222
# NPM_TRUSTME_CHROME_DEBUG_PORT=9222
```

## Notes
- Login modes:
  - `auto` (default): uses credential providers to log in.
  - `browser`: uses an existing Chrome profile/session and waits for manual login if needed.
- Chrome profile reuse: `--chrome-profile` / `--chrome-profile-dir` / `--chrome-user-data-dir` / `--chrome-path`.
- Connect to an existing Chrome: `--chrome-cdp-url` or `--chrome-debug-port` (Chrome must be launched with remote debugging).
- Auto profile detection uses `chrome-cookies-secure`. If it fails due to native bindings, run `pnpm approve-builds` and `pnpm rebuild chrome-cookies-secure sqlite3 keytar`.
  - Cookie sync lets you keep Chrome open; npm-trustme copies npmjs.com cookies into a fresh browser context when possible.
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
