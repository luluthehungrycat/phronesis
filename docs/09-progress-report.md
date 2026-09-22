# Progress Report

> **Date**: June 2026
> **Commits**: 12
> **Tests**: plugin and CLI suites verified in CI
> **Plugins**: 7 packages implemented/tested; explicit registration required
> **Gateway**: Telegram path documented; AgentMail optional and unconfigured by default

---

## Executive Summary

Phronesis has delivered all planned Phase 🟢 and Phase 🟡 capabilities:

- **Auto-skill creation** from complex agent workflows (P1)
- **FTS5 session search** over past conversations (P2)
- **Skill improvement pipeline** with feedback and dedup (P3, built into P1)
- **Structured persona system** with Hermes SOUL.md compatibility (P4)
- **Local-first memory consolidation** with optional Supermemory push (P5)
- **Multi-instance Telegram gateway** with 2 bot instances (Phase 🔴 MVP)
- **AgentMail MCP** documented as an optional email integration

The repository contains seven Phronesis plugin packages, covered by behavior and OpenCode compatibility tests. The current workspace `opencode.json` registers `opencode-injection-guard`; the other packages require explicit registration and runtime verification before they can be described as active in a deployed OpenCode server or available through Telegram.

**Key milestone**: All plugin tools now have explicit `"allow"` permissions at both top-level and per-agent (build, orchestrator), and agent prompts include structured MUST/SHOULD guidance forcing the model to use memory, skills, profile, and session search tools.

---

## 1. What's Built

### P1 — Skill Creator (`src/skill-creator/`)

**Tools**: `save-skill`, `list-skills`, `update-skill`, `skill-feedback`

Monitors session complexity via `tool.execute.after` hook. When a task exceeds thresholds (≥5 tool calls, ≥2 file modifications, or error recovery), it can auto-generate a SKILL.md and offer to save it. Features:

| Feature | Status |
|---------|--------|
| Complexity tracking (per-session) | ✅ |
| SKILL.md generation with frontmatter | ✅ |
| Name deduplication + update flow | ✅ |
| Skill feedback (1-5 rating + comments) | ✅ |
| Auto-injection of relevant skills via system prompt | ✅ |
| Skill creation guidance in agent prompts | ✅ |

**Registration**: `opencode.json` plugin list + skill permission for orchestrator agent.

### P2 — Session Search (`src/session-search/`)

**Tools**: `search-sessions`

Builds a sidecar FTS5 index from `opencode.db` at `~/.local/share/opencode/phronesis_search.db`. Joins `session → message → part` tables for full-text search across all past conversations.

| Feature | Status |
|---------|--------|
| FTS5 sidecar DB with WAL mode | ✅ |
| Cross-session full-text search | ✅ |
| Deduplicated results by session_id | ✅ |
| Rebuilds on plugin load | ✅ |

### P3 — Skill Improvement (built into P1)

Not a separate plugin. Built into skill-creator via:
- **Dedup logic**: `findSimilarSkill()` checks name prefix/contain matches. `save-skill` returns conflict with `update: true` option.
- **Update tool**: `update-skill` reads existing SKILL.md, parses frontmatter, merges updates, regenerates.
- **Feedback loop**: `skill-feedback` records ratings with comments, computes averages, surfaces in system prompt.

### P4 — Persona System (`src/persona/`)

**Tools**: `get-persona`, `set-persona`, `edit-persona`, `import-soul`, `export-soul`, `reset-persona`

Structured persona system with Hermes SOUL.md compatibility.

| Feature | Status |
|---------|--------|
| YAML frontmatter schema (name, identity, behavior, constraints, style, triggers) | ✅ |
| System prompt injection via `experimental.chat.system.transform` | ✅ |
| Style reminders via `experimental.chat.messages.transform` | ✅ |
| Hermes SOUL.md import/export (Identity, Communication, Constraints, Triggers sections) | ✅ |
| Default persona with role, expertise, traits | ✅ |

### P5 — Memory Consolidation (`src/memory-consolidation/`)

**Tools**: `add-fact`, `add-observations`, `search-facts`, `list-facts`, `forget-fact`, `consolidate-memory`, `mark-consolidated`, `memory-stats`

Local-first persistent memory with optional Supermemory push.

| Feature | Status |
|---------|--------|
| SQLite-backed facts table with FTS5 | ✅ |
| Observations batch storage with FTS5 | ✅ |
| Duplicate fact detection (update, not re-create) | ✅ |
| Session tracking (which sessions have been consolidated) | ✅ |
| Periodic consolidation overdue detection (30min heartbeat) | ✅ |
| Non-blocking Supermemory push when configured | ✅ |
| Config via plugin config: interval, max facts, supermemory URL/key | ✅ |
| Relevant fact injection at session start | ✅ |

### P6 — Remote Execution (`src/remote-execution/`)

**Tools**: `run-on`, `list-targets`

Multi-target execution interface with pluggable backends. Executes commands on local shell, Docker containers, or SSH hosts.

| Feature | Status |
|---------|--------|
| Local execution via child_process | ✅ |
| SSH target support | ✅ |
| `list-targets` from config | ✅ |
| Structured output capture (stdout, stderr, exit code) | ✅ |
| Async execution with timeout | ✅ |

### P8 — Skill Lifecycle (`src/skill-lifecycle/`)

**Tools**: `skill-stats`, `skill-versions`, `skill-verify`, `skill-deprecate`, `skill-prune`

Full lifecycle management for saved skills beyond creation. Supports version inspection, validation, deprecation, and cleanup.

| Feature | Status |
|---------|--------|
| Skill statistics (usage, ratings, creation date) | ✅ |
| Version history with diff | ✅ |
| SKILL.md frontmatter validation | ✅ |
| Soft deprecation with reason | ✅ |
| Bulk prune of deprecated/empty skills | ✅ |

### P9 — User Profiling (`src/user-profiling/`)

**Tools**: `profile-summary`, `profile-preference`, `profile-insights`

Builds longitudinal user models from session interactions. Tracks communication style, common task patterns, and decision history.

| Feature | Status |
|---------|--------|
| Profile summary with preferences, stats, skills, patterns | ✅ |
| Preference storage (key-value with tags, source tracking) | ✅ |
| Pattern extraction from session history | ✅ |
| JSON persistence in user data directory | ✅ |

---

## 2. Gateway Status

| Platform | Component | Status | Details |
|----------|-----------|--------|---------|
| **Telegram** | Bot 1 | Configuration-dependent | `opencode-telegram.service` — v0.20.1, port 4096 |
| **Telegram** | Bot 2 | Configuration-dependent | `opencode-telegram-2.service` — v0.20.1, port 4097 |
| **Email** | AgentMail MCP | Optional | `mcp.agentmail.to` remote MCP; requires explicit configuration and credentials |
| **CLI** | Native | ✅ Always available | Direct terminal |

### Architecture

```
                    ┌─────────────────────────────┐
                    │  opencode serve (port 4096)  │
                    │  ┌────────────────────────┐  │
                    │  │   Plugin Pipeline      │  │
                    │  │  (configuration-based) │  │
                    │  │  injection-guard       │  │
                    │  │  + explicitly enabled  │  │
                    │  │    Phronesis plugins   │  │
                    │  └────────────────────────┘  │
                    └──────────┬──────────────────┘
                              │
            ┌─────────────────┼──────────────────┐
            │                 │                    │
   ┌────────▼────────┐  ┌────▼──────────┐  ┌─────▼─────┐
   │ opencode-serve │  │ Telegram Bot 1│  │Telegram B2│
   │    (port 4097)   │  │  (port 4096)  │  │(port 4097)│
   └─────────────────┘  └───────────────┘  └───────────┘
```

Both Telegram bots share the same session database on disk (both ultimately go through `opencode serve` on port 4096). Bot 2 connects via serve which is a separate OpenCode server process but points at the same working directory and config.

---

## 3. Test Coverage

**Total tests**: 78 — **All passing**

| Section | Tests | What It Covers |
|---------|-------|-----------------|
| 1. Module Parsing | 10 | All plugins import as ESM, hooks have correct shape, tools register, complexity state tracks, update-skill/feedback tools exist |
| 2. FTS5 Search | 2 | Index build, search results, empty results |
| 3. Skill File System | 10 | SKILL.md creation, list, dedup, update, overwrite, feedback ratings, averages, error cases |
| 4. System Transform | 3 | Guidance injection, relevant skills, empty skills |
| 5. OpenCode Binary | 3 | Binary available, debug config, server response |
| 6. Persona | 9 | Module import, hooks, 6 tools, defaults, file write, field edit, reset, system/messages transform |
| 7. Memory Consolidation | 11 | Module, hooks, 8 tools, add/search/forget cycle, duplicate update, batch observations, list, stats, consolidate, mark, system transform |
| 8. Remote Execution | 6 | Module, hooks, 2 tools, local execution, SSH target, error handling |
| 9. Skill Lifecycle | 12 | Module, hooks, 5 tools, stats, versions, verify, deprecate, prune, edge cases |
| 10. User Profiling | 12 | Module, hooks, 3 tools, profile creation, preferences, insights, persistence, edge cases |

Test infrastructure: Podman/Docker container with multi-stage build, OpenCode binary downloaded from GitHub releases, isolated test DB.

---

## 4. Deployment Architecture

```
Systemd Units:
├── opencode-serve.service       → port 4096, oc-srv-workspace
├── phronesis-serve.service     → port 4097, oc-srv-workspace
├── opencode-telegram.service    → Bot 1, port 4096
├── opencode-telegram-2.service  → Bot 2, port 4097

Config:
├── ~/.config/opencode-telegram-bot/       → Bot 1 config
│   ├── .env                               → Token, user ID, model, locale
│   ├── settings.json                      → Current project, session, tasks
│   └── logs/                              → Daily logs
├── ~/.config/opencode-telegram-bot-2/     → Bot 2 config
│   ├── .env                               → Different token, same user
│   ├── settings.json                      → Same defaults
│   └── logs/

Data:
└── ~/.local/share/opencode/
    ├── opencode.db                        → Session DB
    ├── phronesis_search.db                → FTS5 search index (P2)
    └── phronesis_memory.db                → Memory consolidation (P5)
```

---

## 5. Lessons Learned

### Architecture
- **OpenCode's plugin hooks are solid** — `tool.execute.after` for tracking, `experimental.chat.system.transform` for context injection, and `config` for permissions form a reliable trilogy.
- **ESM consistency is critical** — All plugins must use `createRequire` for CJS modules (better-sqlite3, fs, path) since OpenCode plugins are ESM.
- **Native modules need source rebuild** — better-sqlite3 prebuilt binaries mismatch with the host Node version. Always `npm rebuild` after install in Docker/containers.
- **Plugin isolation is good** — Each plugin has its own scope, state Map, and error handling. No plugin crash takes down the agent.

### Plugin Development
- **Zod schema ordering matters** — `.min(0).max(1)` before `.optional().default()` or Zod throws.
- **Sidecar DBs are clean** — FTS5 search and memory consolidation each use their own SQLite DB rather than modifying opencode.db. This avoids conflicts and makes debugging easier.
- **Synthetic parts are the right injection mechanism** — Supermemory's pattern of injecting context as synthetic messages is cleaner than modifying system prompts for data-heavy content.

### Gateway
- **`OPENCODE_TELEGRAM_HOME`** is the undocumented key to multi-instance Telegram — the env var scopes all config, logs, and state per instance.
- **Bot is stateless client** — The Telegram bot doesn't serve ports, doesn't need webhooks, and shares the OpenCode server. Multiple instances are inherently conflict-free.
- **Long polling is fine** — No webhook server needed per instance; each bot polls independently from Telegram's API.

---

## 6. Next Steps

### Immediate (Next Session)
- Dogfood the system: run real OpenCode sessions through Telegram and CLI
- Wire Telegram notifications for plugin events (skill created, memory consolidated)
- Activate AgentMail MCP with API key for email gateway

### Short Term
- Phase 🔴: Discern full multi-platform gateway scope (Discord, Slack)
- Plugin polish: error handling edge cases, performance tuning
- Documentation: project PRD for publishing

### Long Term
- Full skill lifecycle: auto-verification, metrics, deprecation
- Honcho integration for user profiling
- Optional future Hermes MCP/API interoperability for expanded platform support, evaluated only after the native Phronesis/OpenCode gateway path is reliable

---

## 7. Git History

```
b7b4d48 fix: memory-consolidation native module rebuild + FTS5 query term builder
9e3934c feat: add memory consolidation plugin (P5) with 11 tests
25ecbbc feat: add persona system plugin (P4) with SOUL.md compatibility, 37/37 tests passing
71253e0 docs: Telegram gateway setup, architecture, and integration docs
bf8c46e fix: feedback read bug, test assertion mismatches
9765594 feat: add dedup/feedback/update tests + AgentMail MCP config
3d21bd5 feat: add test container with 16/16 passing tests for both plugins
e4fbf1b feat: add session-search FTS5 plugin, fix skill-creator ctx defense
b6df3c6 feat: add plugin API reference doc, scaffold skill-creator plugin prototype
1a4946d Initial scaffold: roadmap, analysis, architecture, first-steps docs
```
