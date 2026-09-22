# Phronesis

**Practical wisdom from agent experience.**

Phronesis is a standalone CLI product built on [OpenCode](https://github.com/opencode-ai/opencode), with plugins that add adaptive learning capabilities inspired by [Hermes Agent](https://github.com/NousResearch/hermes-agent). The product interface is `phronesis <subcommand> <arguments>`; Phronesis invokes OpenCode underneath rather than merely exposing a loose collection of plugins.

Hermes is prior art and a behavioral reference, not a Phronesis runtime dependency. MCP/API interoperability with Hermes is a possible future roadmap item, not a current prerequisite or priority.

## Key Features

- **Smart CLI** — A full-featured CLI (`phronesis`) that wraps OpenCode with profile management, session search, structured config, and multi-platform notification sending (Telegram, Slack, Discord, webhooks, email).
- **Session Search** — Full-text search across past agent sessions using FTS5, so you never lose context.
- **Telegram Gateways** — Run OpenCode agents via Telegram bots with multi-instance support, conversation isolation, and health-checked containers.
- **Auto-Skill Creation** — Plugins that monitor agent activity and automatically generate reusable SKILL.md files when patterns emerge.
- **Multi-Profile** — Named profiles (`default`, `expert`, `explain`) with independent personas, plugins, and temperature settings.
- **Memory Consolidation** — Local-first persistent memory that surfaces relevant facts across sessions.

## Quick Start

### Install via npm

```bash
npm install -g @phronesis/cli
phronesis --help
```

### Install via install.sh

```bash
curl -fsSL https://raw.githubusercontent.com/luluthehungrycat/phronesis/main/scripts/install.sh | bash
phronesis --help
```

### Build from source

```bash
git clone https://github.com/luluthehungrycat/phronesis.git
cd phronesis
npm run setup
./cli/bin/phronesis.js --help
```

## Documentation

- [Getting Started](04-first-steps.md) — First steps, next actions, and how to contribute
- [Architecture](03-architecture.md) — Plugin architecture and design decisions
- [Plugin API Reference](05-plugin-api-reference.md) — OpenCode plugin hooks and patterns
- [CLI Reference](13-cli-and-profiles.md) — CLI commands, profiles, and configuration
- [Roadmap](02-roadmap.md) — Product direction, priorities, and non-goals
- [Telegram Gateway Setup](06-telegram-gateway.md) — Running agents via Telegram
- [Contributing](10-contributing.md) — Development guide and how to help

## Project Status

Phronesis is actively developed. All core plugins are implemented and tested:

| Plugin | Phase | Tests | Status |
|--------|-------|-------|--------|
| Skill Creator | P1 | ✅ 78/78 | Active |
| Session Search | P2 | ✅ 78/78 | Active |
| Persona | P4 | ✅ 78/78 | Active |
| Memory Consolidation | P5 | ⚠️ 70/78 | Active |
| Remote Execution | P6 | ✅ 78/78 | Active |
| Skill Lifecycle | P8 | ✅ 78/78 | Active |
| User Profiling | P9 | ✅ 78/78 | Active |

Gateway integrations (Telegram, Slack, Discord, email) are all production-ready.

---

*Built for agents that learn.*
