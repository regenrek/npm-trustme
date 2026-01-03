# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Auto-detection for package, repo, and workflow when flags are omitted.

### Fixed
- Publishing access selection now targets the strict (disallow tokens) radio reliably and waits for 2FA completion.
- Include the Codex skill folder in npm package files.

## [0.1.4]

### Added
- `npm-trustme workflow init` to scaffold an npm release workflow for Trusted Publishing.
- `npm-trustme doctor` to verify local readiness for Trusted Publisher setup.

### Fixed
- npm provenance publishing by adding repository metadata.
