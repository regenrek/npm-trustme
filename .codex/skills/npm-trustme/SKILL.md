---
name: npm-trustme
description: Automate npm Trusted Publisher setup via the npm-trustme CLI. Use when asked to configure or verify npm Trusted Publishers for GitHub Actions or GitLab with npx npm-trustme, including WebAuthn-friendly token bootstrap and browser automation.
---

# npm-trustme

## Overview

Automate npm Trusted Publisher setup in the npm web UI using the published CLI.
For WebAuthn-only accounts, bootstrap a short-lived bypass token with a one-time approval.

## CLI Quick Start

- One-time if browsers are missing: `npx playwright install`
- Bootstrap token (recommended for WebAuthn-only): `npx npm-trustme token create ...`
- Capture template (required for token mode): `npx npm-trustme capture ...`
- Check only: `npx npm-trustme check ...`
- Ensure (create if missing): `npx npm-trustme ensure ...`

## Required Target Inputs

- Required: `--package`, `--owner`, `--repo`, `--workflow`, `--publisher`, `--publishing-access`
- Optional: `--environment`, `--maintainer`
- In a git repo, `--auto-repo` can infer owner/repo from the remote.

## Examples

Bootstrap token:
```
npx npm-trustme token create \
  --name trustme-setup \
  --packages <PACKAGE_NAME> \
  --bypass-2fa \
  --output .npm-trustme/token.json
```

Check:
```
npx npm-trustme check \
  --package <PACKAGE_NAME> \
  --owner <GITHUB_OWNER> \
  --repo <GITHUB_REPO> \
  --workflow <WORKFLOW_FILE> \
  --publisher <PUBLISHER> \
  --publishing-access <PUBLISHING_ACCESS>
```

Ensure (create if missing):
```
npx npm-trustme ensure \
  --package <PACKAGE_NAME> \
  --owner <GITHUB_OWNER> \
  --repo <GITHUB_REPO> \
  --workflow <WORKFLOW_FILE> \
  --publisher <PUBLISHER> \
  --publishing-access <PUBLISHING_ACCESS>
```

Token mode (no browser):
```
npx npm-trustme ensure \
  --auth-token <GRANULAR_TOKEN> \
  --publishing-access skip
```

## Credentials

Provider order (first wins):
direct creds -> 1Password -> Bitwarden -> LastPass -> KeePassXC -> prompt (interactive only).

Provider requirements:
- Install the matching CLI for the provider you use (e.g., `op`, `bw`, `lpass`, `keepassxc-cli`).

Other providers (flags or envs):
- 1Password: `--op-vault` and `--op-item` (or env `NPM_TRUSTME_OP_VAULT`, `NPM_TRUSTME_OP_ITEM`)
- Bitwarden: `--bw-item`, optional `--bw-session`
- LastPass: `--lpass-item`, optional `--lpass-otp-field`
- KeePassXC: `--kpx-db`, `--kpx-entry`, optional `--kpx-keyfile`, `--kpx-password`, `--kpx-pw-stdin`
- Direct (discouraged): `--username`, `--password`, optional `--otp`

## Notes

- `--env-file` can load a specific `.env` path.
- `--storage` can persist Playwright storage state for faster re-runs.
- `--login-mode browser` skips credential providers and waits for manual login.
- Token bootstrap uses the npm registry web auth flow. If no session token is found, run `npm login --auth-type=web` first.
- Token mode requires a captured template (`npm-trustme capture`) and skips publishing access updates.
- Inline cookies (Sweet Cookie format) are supported: `--inline-cookies-json`, `--inline-cookies-base64`, or `--inline-cookies-file`.
- Requires Node >= 22 (Sweet Cookie uses node:sqlite).
- Chrome profile reuse (manual session): `--chrome-profile` / `--chrome-profile-dir` / `--chrome-user-data-dir` / `--chrome-path`.
- Connect to an existing Chrome: `--chrome-cdp-url` or `--chrome-debug-port` (Chrome must be launched with remote debugging).
- Cookie import: `--import-cookies` (default true) to copy npm cookies from your main Chrome profile.
- Dedicated Chrome for passkey/extension flows:
  - `npx npm-trustme chrome start` launches a dedicated Chrome profile with CDP and stores it in config.
  - `npx npm-trustme chrome status` verifies the CDP endpoint.
  - Install the passkey extension (e.g., 1Password) and sign in to npm once in that profile.
- Auto profile detection uses `chrome-cookies-secure`; if native bindings fail, rebuild them.
- Cookie sync allows keeping Chrome open; npm-trustme copies npmjs.com cookies into a fresh context when possible.
