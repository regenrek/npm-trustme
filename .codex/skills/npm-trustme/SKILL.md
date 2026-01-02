---
name: npm-trustme
description: Automate npm Trusted Publisher setup via the local npm-trustme CLI (Playwright browser automation). Use when asked to configure or verify npm Trusted Publishers for GitHub Actions or GitLab, or to run npm-trustme from ~/projects/npm-trustme.
---

# npm-trustme

## Overview

Automate npm Trusted Publisher setup in the npm web UI using the local npm-trustme repo.
Run checks or ensure publishing access without manual browser steps.

## Workflow

- Open the repo: `cd ~/projects/npm-trustme`.
- Install deps once: `pnpm install` and `npx playwright install`.
- Configure inputs in `.env` (or pass flags). Use `--env-file` to point elsewhere.
- Run a check: `pnpm tsx src/cli/main.ts check`.
- Run ensure: `pnpm tsx src/cli/main.ts ensure` (adds missing publisher/access).

## Required Target Inputs

- `package`, `owner`, `repo`, `workflow`, `publisher`, `publishing-access`
- Optional: `environment`, `maintainer`
- Use `--auto-repo` to infer owner/repo from the current git remote.

## Credentials

- Provider order (first wins): direct creds -> 1Password -> Bitwarden -> LastPass -> KeePassXC -> prompt (interactive only).
- Prefer 1Password: set `NPM_TRUSTME_OP_VAULT` and `NPM_TRUSTME_OP_ITEM` (or pass `--op-vault`, `--op-item`).
- For other providers, follow the README in `~/projects/npm-trustme/README.md`.

## Notes

- Use `--env-file` to load a specific `.env` path.
- Use `--storage` to persist Playwright storage state for faster re-runs.
