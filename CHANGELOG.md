# Changelog

## [0.1.0] — 2026-06-30

### Added
- CLI with 18 commands: chat, continue, fork, version, config, profile, gateway,
  skills, sessions, create-plugin, plugin (install/list/remove), dashboard,
  completion, doctor, setup, send (telegram/webhook/slack/discord),
  upgrade (auto-update), migrate (claw/hermes)
- Plugin registry with 7 verified + 3 community plugins
- `phronesis plugin install <name>` — install plugins from registry by name
- Dashboard SPA (Express + vanilla JS) with session browser, config viewer, gateway controls
- Webhook adapter (Express) supporting Slack, Discord, Telegram, and generic webhooks
- MkDocs documentation site deployed to GitHub Pages
- CI/CD: test.yml, publish.yml, docs.yml workflows
- CI all-test-suites job running CLI + plugins + E2E in parallel
- Container build with HEALTHCHECK for serve-2
- Install script (`curl | bash` via raw.githubusercontent.com)
- Auto-upgrade via GitHub Releases (`phronesis upgrade`)
- PII cleanup across workflows, config, and repo URLs
- 7 Phronesis plugins: skill-creator, session-search, persona, memory-consolidation,
  user-profiling, skill-lifecycle, remote-execution

### Tests
- 40 CLI unit tests (config, paths, opencode wrapper, search, constants)
- 78 container integration tests (plugin runtime)
- 63 plugin integration tests (per-plugin tool registration and logic)
- 37 E2E smoke tests (full CLI workflow from setup through all major commands)

### Fixed
- Publish workflow decoupled: GitHub Release created independently of npm publish
- Upgrade command now checks GitHub Releases API instead of requiring npm
