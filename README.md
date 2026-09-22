# Phronesis

**Practical wisdom from agent experience.**  

Phronesis is a standalone product built on OpenCode. It supplies the plugins and product-level CLI wrapper needed to make OpenCode behave more like the Hermes-inspired experience we want to provide: `phronesis <subcommand> <arguments>` runs the implemented functionality through OpenCode.

Hermes Agent is an inspiration and behavioral reference, not a runtime dependency or service boundary. Interoperability with Hermes through MCP or an API may be considered later, but it is not a current priority.

## Why

OpenCode has a rich plugin architecture, full MCP support, and a solid skill system — but it lacks the learning loop that makes Hermes Agent feel alive:

- **No auto-skill creation** — complex workflows are forgotten after the session
- **No session search** — past conversations are opaque
- **No self-improving skills** — SKILL.md files are static
- **No multi-platform gateway** — agents are TUI/CLI/Desktop only

Phronesis fills these gaps, one plugin at a time.

## Project Structure

```
cli/                             Phronesis CLI & wrapper
├── bin/phronesis.js             Entry point
├── src/
│   ├── cli.js                   Command router (15 commands)
│   ├── commands/                Modular commands (version, config, profile, etc.)
│   └── lib/                     Shared libs (opencode wrapper, config, search, paths)
├── package.json                 npm package (@phronesis/cli)
└── README.md

docs/
├── 01-analysis.md               Hermes vs OpenCode gap analysis
├── 02-roadmap.md                Strategic phases and priorities
├── 03-architecture.md           Technical architecture for plugins
├── 04-first-steps.md            Getting started guide
├── 05-plugin-api-reference.md   OpenCode plugin API reference
├── 06-telegram-gateway.md       Telegram bot setup & config
├── 07-telegram-multi-instance.md  Multi-instance deployment
├── 08-gateway-strategy.md       Gateway architecture & plan
├── 09-progress-report.md        Current progress & lessons learned
├── 10-contributing.md           Development guide
├── 11-notification-system.md    Telegram notification wiring
├── 12-p6-p8-p9-architecture.md  Remote exec, lifecycle, profiling
└── 13-cli-and-profiles.md       CLI specification & multi-profile model

src/
├── skill-creator/               P1 — Auto-skill creation plugin
├── session-search/              P2 — FTS5 session search plugin
├── persona/                     P4 — Structured persona plugin
├── memory-consolidation/        P5 — Local-first memory plugin
├── remote-execution/            P6 — Multi-target remote exec plugin
├── skill-lifecycle/             P8 — Skill versioning & deprecation
└── user-profiling/              P9 — Longitudinal user model plugin

servers/
└── serve/                     Isolated container for bot2 (port 4097)
    └── Dockerfile               Multi-stage + HEALTHCHECK

tests/
└── container/                   Podman/Docker test container
    ├── Dockerfile               Multi-stage build
    ├── test.mjs                 78-test suite (70/78 pass in Alpine, 8 need musl-native better-sqlite3)
    └── entrypoint.sh            Test runner with serve mode support
```

## Status

| Plugin | Phase | Tests | Status |
|--------|-------|-------|--------|
| `skill-creator` | 🟢 P1 | ✅ Tested | Implemented; enable via OpenCode config |
| `session-search` | 🟢 P2 | ✅ Tested | Implemented; enable via OpenCode config |
| `persona` | 🟡 P4 | ✅ Tested | Implemented; enable via OpenCode config |
| `memory-consolidation` | 🟡 P5 | ✅ Tested | Implemented; enable via OpenCode config |
| `remote-execution` | 🟡 P6 | ✅ Tested | Implemented; enable via OpenCode config |
| `skill-lifecycle` | 🟡 P8 | ✅ Tested | Implemented; enable via OpenCode config |
| `user-profiling` | 🟡 P9 | ✅ Tested | Implemented; enable via OpenCode config |

### Gateway

| Platform | Component | Status | Details |
|----------|-----------|--------|---------|
| Telegram | Bot 1 | Configuration-dependent | `opencode-telegram.service`, port 4096 (legacy) |
| Telegram | Bot 2 | Configuration-dependent | Phronesis container (`phronesis-test`), health check available |
| Telegram | Send CLI | ✅ `phronesis send telegram` | One-off messages via Bot API |
| Webhook | Send CLI | ✅ `phronesis send webhook` | Generic JSON POST to any URL |
| Slack | Send CLI | ✅ `phronesis send slack` | Slack-compatible webhook payload |
| Discord | Send CLI | ✅ `phronesis send discord` | Discord webhook with "Phronesis" username |
| Email | AgentMail MCP | Optional | Requires explicit MCP configuration and credentials |
| CLI | Native | ✅ Always available | Direct terminal + `phronesis` wrapper |

## Product Boundary

- **OpenCode is the prerequisite runtime.** Phronesis runs OpenCode rather than replacing it.
- **Phronesis is more than a plugin collection.** Plugins provide capabilities inside OpenCode; the CLI, profiles, configuration, services, and documentation form the standalone product.
- **The CLI is the primary product interface.** Implemented Hermes-inspired operations are exposed as `phronesis` commands, with OpenCode doing the underlying agent work.
- **Hermes is prior art, not a dependency.** We reproduce selected functionality and interaction patterns without making Hermes installation, APIs, or MCP connectivity prerequisites.

## Core Philosophy

1. **Leverage existing infrastructure** — SKILL.md, SQLite sessions, 20+ plugin hooks, MCP. Never rebuild what's already there.
2. **Composability over monoliths** — Each capability is a standalone OpenCode plugin that works independently and together.
3. **Learning as the differentiator** — The single highest-leverage feature is auto-skill creation. It compounds every session.

---

*Phronesis is architected and directed by human engineering. Implementation is built collaboratively with OpenCode AI agents — every design decision, tradeoff, and architecture choice is human-owned; the agents execute under active direction.*
