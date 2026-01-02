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
  --package codex-1up \
  --owner regenrek \
  --repo codex-1up \
  --workflow npm-release.yml \
  --publisher github \
  --publishing-access disallow-tokens
```

Ensure (create if missing):
```
npx npm-trustme ensure \
  --package codex-1up \
  --owner regenrek \
  --repo codex-1up \
  --workflow npm-release.yml \
  --publisher github \
  --publishing-access disallow-tokens
```

## Credentials

Provider order (first wins):
direct creds -> 1Password -> Bitwarden -> LastPass -> KeePassXC -> prompt (interactive only).

Preferred (1Password):
- `--op-vault "Personal"` and `--op-item "npmjs.com"`
- Or env: `NPM_TRUSTME_OP_VAULT`, `NPM_TRUSTME_OP_ITEM`

Other providers (flags or envs):
- Bitwarden: `--bw-item`, optional `--bw-session`
- LastPass: `--lpass-item`, optional `--lpass-otp-field`
- KeePassXC: `--kpx-db`, `--kpx-entry`, optional `--kpx-keyfile`, `--kpx-password`, `--kpx-pw-stdin`
- Direct (discouraged): `--username`, `--password`, optional `--otp`

## Notes

- `--env-file` can load a specific `.env` path.
- `--storage` can persist Playwright storage state for faster re-runs.
