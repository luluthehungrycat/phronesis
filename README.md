# Phronesis

**Practical wisdom from agent experience.**  

Phronesis bridges the gap between OpenCode's powerful plugin ecosystem and Hermes Agent's adaptive learning capabilities. It brings auto-skill creation, session memory, self-improving skills, and intelligent experience reuse to OpenCode — turning raw agent interactions into compounding practical wisdom.

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
└── serve/                       Isolated container for bot2 (port 4097)
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
| `skill-creator` | 🟢 P1 | ✅ 78/78 | Active |
| `session-search` | 🟢 P2 | ✅ 78/78 | Active |
| `persona` | 🟡 P4 | ✅ 78/78 | Active |
| `memory-consolidation` | 🟡 P5 | ⚠️ 70/78 | Active (8 fail on musl — better-sqlite3 needs native rebuild) |
| `remote-execution` | 🟡 P6 | ✅ 78/78 | Active |
| `skill-lifecycle` | 🟡 P8 | ✅ 78/78 | Active |
| `user-profiling` | 🟡 P9 | ✅ 78/78 | Active |

### Gateway

| Platform | Component | Status | Details |
|----------|-----------|--------|---------|
| Telegram | Bot 1 | ✅ Production | `opencode-telegram.service`, port 4096 (legacy) |
| Telegram | Bot 2 | ✅ Production | Phronesis container (`phronesis-test`), port 4098, HEALTHCHECK enabled |
| Telegram | Send CLI | ✅ `phronesis send telegram` | One-off messages via Bot API |
| Webhook | Send CLI | ✅ `phronesis send webhook` | Generic JSON POST to any URL |
| Slack | Send CLI | ✅ `phronesis send slack` | Slack-compatible webhook payload |
| Discord | Send CLI | ✅ `phronesis send discord` | Discord webhook with "Phronesis" username |
| Email | AgentMail MCP | ✅ Configured | Remote MCP at `mcp.agentmail.to` (needs API key) |
| CLI | Native | ✅ Always available | Direct terminal + `phronesis` wrapper |

## Core Philosophy

1. **Leverage existing infrastructure** — SKILL.md, SQLite sessions, 20+ plugin hooks, MCP. Never rebuild what's already there.
2. **Composability over monoliths** — Each capability is a standalone OpenCode plugin that works independently and together.
3. **Learning as the differentiator** — The single highest-leverage feature is auto-skill creation. It compounds every session.

---

*Phronesis is architected and directed by human engineering. Implementation is built collaboratively with OpenCode AI agents — every design decision, tradeoff, and architecture choice is human-owned; the agents execute under active direction.*
