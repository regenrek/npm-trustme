---
name: npm-trustme
description: Automate npm Trusted Publisher setup via the npm-trustme CLI (Playwright browser automation). Use when asked to configure or verify npm Trusted Publishers for GitHub Actions or GitLab with npx npm-trustme, including provider selection and required flags.
---

# npm-trustme

## Overview

Automate npm Trusted Publisher setup in the npm web UI using the published CLI.
Run checks or ensure publishing access without manual browser steps.

## CLI Quick Start

- One-time if browsers are missing: `npx playwright install`
- Check only: `npx npm-trustme check ...`
- Ensure (create if missing): `npx npm-trustme ensure ...`

## Required Target Inputs

- Required: `--package`, `--owner`, `--repo`, `--workflow`, `--publisher`, `--publishing-access`
- Optional: `--environment`, `--maintainer`
- In a git repo, `--auto-repo` can infer owner/repo from the remote.

## Examples

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
- Chrome profile reuse (manual session): `--chrome-profile` / `--chrome-profile-dir` / `--chrome-user-data-dir` / `--chrome-path`.
