# Phronesis CLI & Multi-Profile Architecture

> **Date**: June 2026
> **Status**: Phase 1a+1b+1c+2 complete. Active development.
>
> See `progress-report.md` for overall project status.

---

## 1. Vision

`phronesis` is a CLI and runtime that wraps OpenCode + Phronesis plugins into a self-contained experience inspired by Hermes Agent. 

**Core principles:**
- Hermes users should feel at home (similar command structure, same profile concept)
- Every phronesis command wraps or composes OpenCode — never replaces it
- Profiles are first-class: each profile is a fully isolated OpenCode workspace with its own gateways, plugins, config, and data
- Migration from Hermes Agent and OpenClaw is a key adoption driver

---

## 2. Command Specification

### 2.1 Command Tree

```
phronesis [--profile <name>]                            → opencode (interactive session, with profile)
phronesis [--profile <name>] chat [<query>]             → opencode [<query>]
phronesis [--profile <name>] continue                   → opencode continue
phronesis [--profile <name>] fork                       → opencode fork

phronesis gateway
  status [--profile <name>]          → Show gateway service status
  start [--profile <name>]           → Start gateway for a profile
  stop  [--profile <name>]           → Stop gateway for a profile
  restart [--profile <name>]         → Restart gateway for a profile
  logs [--profile <name>]            → View gateway logs for a profile
  install [--profile <name>]         → Install/register gateway service
  uninstall [--profile <name>]       → Remove gateway service

phronesis profile
  list                               → List profiles
  use <name>                         → Switch active profile
  create <name> [--from <name>]      → Create new profile (optionally clone)
  delete <name>                      → Remove a profile
  current                            → Show active profile
  path [<name>]                      → Show config directory for a profile

phronesis config
  get [<key>]                        → Get config value (or all)
  set <key> <value>                  → Set config value
  path                               → Show config file location
  edit                               → Open in $EDITOR

phronesis skills
  list                               → List installed skills (opencode run /list-skills)
  install <name>                     → Install a skill
  update <name>                      → Update a skill
  feedback <name> [--score <1-5>]    → Rate a skill

phronesis sessions
  list [--json]                      → List sessions from search index
  search <query> [--limit <N>] [--json]  → FTS5 session search with highlights
  rebuild [--overwrite]              → Rebuild FTS5 search index from opencode.db

phronesis send
  telegram <message> [--profile <name>] [--bot <id>]   → Telegram via Bot API
  webhook <message> [--profile <name>] [--url <url>]    → Generic webhook POST
  slack <message> [--profile <name>] [--url <url>]      → Slack webhook
  discord <message> [--profile <name>] [--url <url>]    → Discord webhook

phronesis create-plugin <name>       → Scaffold a new Phronesis plugin

phronesis setup                      → Interactive first-run wizard
phronesis doctor                     → Diagnostics / system check
phronesis version                    → Show version info
phronesis completion [bash|zsh|fish] → Print shell completion script

# Migration
phronesis migrate
  claw [--dry-run]                   → Migrate from OpenClaw to Phronesis
  hermes [--dry-run]                 → Migrate from Hermes Agent to Phronesis

# Hermes Naming Aliases (for familiarity)
phronesis model                      → alias for `phronesis config get model`
phronesis tools                      → alias for `phronesis config get plugins`
phronesis cron list                  → opencode run /list-schedule
phronesis cron status                → opencode run /check-scheduler
```

### 2.2 Hermes → Phronesis Mapping

| Hermes Command | Phronesis | Notes |
|---|---|---|
| `hermes` (no args) | `phronesis` | Interactive session |
| `hermes chat -q "..."` | `phronesis chat "..."` | Or just `phronesis "..."` |
| `hermes continue` | `phronesis continue` | Wraps `opencode continue` directly |
| `hermes fork` | `phronesis fork` | Wraps `opencode fork` |
| `hermes setup` | `phronesis setup` | Reimplemented for phronesis |
| `hermes config set` | `phronesis config set` | Manages `~/.config/phronesis/config.yaml` |
| `hermes gateway start\|stop\|status\|install\|uninstall` | `phronesis gateway ...` | Same semantics |
| `hermes profile list\|use\|create` | `phronesis profile ...` | Same semantics |
| `hermes skills browse\|install` | `phronesis skills list\|install\|update\|feedback` | Browse replaced by list (no hub) |
| `hermes sessions` | `phronesis sessions list\|search` | Search via FTS5 plugin |
| `hermes send` | `phronesis send telegram ...` | Only Telegram initially |
| `hermes doctor` | `phronesis doctor` | Phronesis-specific diagnostics |
| `hermes claw migrate [--dry-run]` | `phronesis migrate claw [--dry-run]` | Same flag |
| `hermes dashboard` | `phronesis dashboard` | Launches web dashboard (Phase 3) |
| `hermes completion [bash\|zsh\|fish]` | `phronesis completion [bash\|zsh\|fish]` | Same behavior |
| `hermes version` | `phronesis version` | Trivial |
| `hermes model` | `phronesis config get model` | OC manages model config |
| `hermes cron list\|status` | `phronesis cron list\|status` | Via opencode-scheduler |
| `hermes tools` | `phronesis config get plugins` | Plugin list is config |

**Not implemented** (Hermes-specific, no analogue):
- `hermes lsp`, `hermes computer-use` — platform-specific
- `hermes proxy`, `hermes auth`, `hermes portal` — Hermes infrastructure
- `hermes whatsapp`, `hermes slack` — future gateways (Phase 🔴)
- `hermes fallback` — OC handles fallback differently
- `hermes honcho` — replaced by Phronesis memory-consolidation (P5)
- `hermes update`, `hermes uninstall` — handled by npm

---

## 3. Multi-Profile Data Model

### 3.1 Directory Layout

```
~/.config/phronesis/
├── config.yaml                     # Global defaults (active profile, model prefs)
│
└── profiles/
    └── <name>/
        ├── config.yaml             # Profile metadata + gateway config
        ├── opencode.json           # Profile-specific OpenCode workspace config
        ├── oh-my-opencode-slim.json  # OMOS plugin config (if installed)
        │
        ├── gateways/
        │   ├── telegram-1.env      # Bot 1 token + user ID
        │   ├── telegram-2.env      # Bot 2 token + user ID
        │   └── (future: discord.env, slack.env, ...)
        │
        └── data/
            ├── sessions.db         # OpenCode session DB
            ├── phronesis_search.db # FTS5 search index (P2)
            ├── phronesis_memory.db # Memory consolidation (P5)
            ├── phronesis_profile.json  # User profiling (P9)
            └── skills/             # Phronesis skills (P1/P3/P8)
```

### 3.2 Global Config (`~/.config/phronesis/config.yaml`)

```yaml
# Active profile
active_profile: default

# Default OpenCode options
defaults:
  model: "anthropic/claude-sonnet-4"
  agent: "orchestrator"

# Global MCP configuration (shared across profiles)
mcp:
  agentmail:
    enabled: true
    url: "https://mcp.agentmail.to/mcp"
  context7:
    enabled: true
  exa:
    enabled: true
```

### 3.3 Profile Config (`~/.config/phronesis/profiles/<name>/config.yaml`)

```yaml
# Profile metadata
name: work
description: "Work projects profile"
created: 2026-06-12

# Gateway configuration
gateways:
  telegram:
    bots:
      - id: 1
        enabled: true
        env_file: gateways/telegram-1.env
      - id: 2
        enabled: false
        env_file: gateways/telegram-2.env

# OpenCode configuration reference
opencode_config: opencode.json  # relative to profile dir

# Remote OpenCode server (optional — omit for local automation)
# Default: opencode runs locally on the host machine (Docker, systemd unit, or direct)
# Set url or port to connect to a remote server.
server:
  url: "http://192.168.1.50:4097"  # Full URL (takes precedence)
  # port: 4097                     # Shorthand for localhost:<port>

# Phronesis plugin overrides
plugins:
  skill-creator:
    enabled: true
    config:
      auto_create: true
  memory-consolidation:
    enabled: true
    config:
      interval_minutes: 360
```

### 3.4 Switching Profiles

Switching a profile means:

1. **Set env vars** for the current session:
   ```bash
   export OPENCODE_HOME=~/.config/phronesis/profiles/<name>
   export XDG_DATA_HOME=~/.config/phronesis/profiles/<name>/data
   export OPENCODE_TELEGRAM_HOME=~/.config/phronesis/profiles/<name>/gateways
   ```

2. **Start services** pointing at the profile's config:
   ```bash
   opencode serve --config ~/.config/phronesis/profiles/<name>/opencode.json
   ```

3. **Gateways** read env files from the profile's `gateways/` directory.

The `phronesis profile use <name>` command updates `~/.config/phronesis/config.yaml` (active_profile) and sets env vars for the current shell.

### 3.5 Profile Shorthand Scripts

Like Hermes Agent, each profile gets a **shell script** placed at `~/.local/bin/<profile-name>` that proxies all arguments to `phronesis --profile <name>`.

```bash
# ~/.local/bin/work  (auto-created by phronesis profile create)
#!/usr/bin/env bash
exec phronesis "$@" --profile work
```

This means:
- `work chat "hello"` → `phronesis chat "hello" --profile work`
- `work gateway status` → `phronesis gateway status --profile work`
- `work config get model` → `phronesis config get model --profile work`

The scripts are created on `phronesis profile create <name>` and removed on `phronesis profile delete <name>`.

### 3.6 Service Management Per Profile

Each profile can have its own set of gateway systemd services:

```
~/.config/systemd/user/
├── phronesis-gateway-<profile>-telegram-1.service
├── phronesis-gateway-<profile>-telegram-2.service
└── phronesis-gateway-<profile>-serve.service
```

Alternative: Use a single `phronesis` service wrapper that reads the active profile and launches services accordingly.

---

## 4. Migration

### 4.1 `phronesis migrate claw`

**Source**: OpenClaw / Claude Code project configs.

**What to detect:**
- `.claude/settings.json` — Claude Code project settings
- `CLAW.md` — OpenClaw project markdown
- `.claude/settings.local.json` — Local overrides

**What to create:**
- `~/.config/phronesis/profiles/<project-name>/` with appropriate config
- Convert model/provider settings to OpenCode equivalents
- Convert permissions/rules
- Note: Claude Code sessions are stored differently — session migration may not be feasible

**Operation:**
```bash
phronesis migrate claw --dry-run
# > Found OpenClaw project in /home/user/project
# > Would create profile "project" with:
# >   - Model: claude-sonnet-4-20250514 → anthropic/claude-sonnet-4
# >   - Permissions: 3 rules converted
# >   - Skills: 2 skills found
```

### 4.2 `phronesis migrate hermes`

**Source**: Hermes Agent (`~/.hermes/`)

**What to detect:**
- `~/.hermes/config.yaml` — check if Hermes is installed
- `~/.hermes/profiles/*/` — existing profiles

**What to create:**
- One Phronesis profile per Hermes profile
- `~/.config/phronesis/profiles/<name>/` with equivalent structure
- Convert gateway configs:
  - Hermes Telegram config → `gateways/telegram-1.env`
  - Hermes model/provider → OpenCode model string
  - Hermes skills → references if applicable
- Session data can be migrated (`~/.hermes/sessions/` → `data/sessions.db` format conversion if needed)

**Operation:**
```bash
phronesis migrate hermes --dry-run
# > Found Hermes Agent installation at ~/.hermes
# > Found 2 profiles: "default", "work"
# > Would create 2 Phronesis profiles
# >   default:
# >     - Telegram bot token found → would configure telegram-1
# >     - Model: anthropic/claude-sonnet-4
# >   work:
# >     - No gateway config found
# >     - Model: anthropic/claude-opus-4
```

---

## 5. Implementation Plan

### 5.1 Package Structure

```
phronesis-cli/                      # npm package: @phronesis/cli or phronesis
├── package.json                    # type: module, bin: phronesis
├── bin/
│   └── phronesis.js                # CLI entry point (shebang + main)
├── src/
│   ├── cli.js                      # CLI router (yargs or commander)
│   ├── commands/
│   │   ├── chat.js                 # Delegates to opencode
│   │   ├── gateway.js              # systemd management
│   │   ├── profile.js              # Profile CRUD
│   │   ├── config.js               # Config get/set
│   │   ├── skills.js               # opencode run /list-skills etc.
│   │   ├── sessions.js             # opencode run /search-sessions + session listing
│   │   ├── send.js                 # One-shot Telegram send
│   │   ├── setup.js                # Interactive wizard
│   │   ├── doctor.js               # Diagnostics
│   │   ├── migrate/
│   │   │   ├── claw.js             # OpenClaw migration
│   │   │   └── hermes.js           # Hermes migration
│   │   └── completion.js           # Shell completion generation
│   ├── lib/
│   │   ├── config.js               # Config file read/write (YAML)
│   │   ├── profile.js              # Profile management logic
│   │   ├── opencode.js             # opencode CLI wrapper
│   │   ├── gateway.js              # Service management helpers
│   │   ├── telegram.js             # Direct Telegram API (for phronesis send)
│   │   └── paths.js                # Directory resolution
│   └── constants.js                # Paths, defaults
├── README.md
└── install.sh                      # curl-pipe-bash installer
```

### 5.2 Key Dependencies

| Dependency | Purpose |
|---|---|
| `yargs` or `commander` | CLI argument parsing |
| `js-yaml` | YAML config read/write |
| `chalk` or `picocolors` | Terminal output formatting |
| `inquirer` or `@clack/prompts` | Interactive prompts (setup wizard) |
| `node:child_process` | Shelling out to opencode, systemctl |
| `node:fs`, `node:path` | Config file management |

### 5.3 OpenCode CLI Wrapper Pattern

The CLI mostly shells out to OpenCode:

```javascript
// src/lib/opencode.js
import { execSync } from "node:child_process";

export function opencode(args, opts = {}) {
  const profile = opts.profile || getActiveProfile();
  const env = {
    ...process.env,
    ...(profile ? profileEnv(profile) : {}),
  };
  
  const result = execSync("opencode", args, { 
    encoding: "utf8", 
    env,
    stdio: opts.interactive ? "inherit" : "pipe",
  });
  return result;
}

export function opencodeRun(tool, args, opts = {}) {
  return opencode(["run", `/${tool}`, ...args], opts);
}
```

### 5.4 Implementation Sequencing

**Phase 1a — Package scaffold + core commands:**
- [x] `package.json` with bin entry, dependencies
- [x] `bin/phronesis.js` — entry point
- [x] `src/cli.js` — command router
- [x] `phronesis` (no args) → delegates to `opencode`
- [x] `phronesis chat [query]`
- [x] `phronesis continue`
- [x] `phronesis version`
- [x] `phronesis config [get|set|path|edit]`
- [x] `phronesis profile [list|use|create|delete|current|path]`

**Phase 1b — Gateway + Skills + Sessions:**
- [x] `phronesis gateway [status|start|stop|restart|logs]` — profile-aware, reads enabled bots from profile config, fallback to legacy `opencode-telegram[-2]` units
- [x] `phronesis gateway [install|uninstall]` — write/remove systemd user unit + enable/disable
- [x] `phronesis skills [list]` — wired to `opencode run /list-skills` via `opencodeRun`
- [x] `phronesis skills [install|update|feedback]` — wired to opencode plugin tools
- [x] `phronesis sessions [search]` — direct SQLite FTS5 search (not opencode run — faster, zero model tokens)
- [x] `phronesis sessions [list]` — query search DB for distinct session list
- [x] `phronesis sessions rebuild` — build FTS5 index from opencode.db

**Phase 1c — Setup + Doctor:**
- [x] `phronesis setup` — interactive first-run wizard
- [x] `phronesis doctor` — diagnostics
- [x] `phronesis completion [bash|zsh|fish]`

**Phase 2 — Migration:**
- [x] `phronesis migrate claw [--dry-run]`
- [x] `phronesis migrate hermes [--dry-run]`

**Phase 3 — Send + Dashboard:**
- [x] `phronesis send telegram <msg>` — one-off Telegram message
- [x] `phronesis send webhook <msg>` — generic webhook
- [x] `phronesis send slack <msg>` — Slack webhook
- [x] `phronesis send discord <msg>` — Discord webhook
- [ ] `phronesis dashboard` (web dashboard launch — future)

---

## 6. Install Script

`install.sh` — curl-pipe-bash compatible:

```bash
#!/usr/bin/env bash
# Phronesis Installer

set -e

# 1. Check prerequisites (node >= 18, npm, opencode)
# 2. Install phronesis CLI: npm install -g phronesis
# 3. Run phronesis setup (first-run wizard)
# 4. Print success + next steps
```

The script should be published to a URL like:
```
curl -fsSL https://raw.githubusercontent.com/luluthehermeticcrabBot/phronesis/main/install.sh | bash
```

---

## 7. Phase 0 Audit (Current State)

| Item | Status | Action Needed |
|------|--------|---------------|
| Telegram notifications | ✅ **Done** — all 7 plugins wired | None |
| AgentMail MCP | ✅ **Done** — OAuth configured + env var set | None |
| Dogfood | 🔶 Ongoing | Active via Bot 2 |
| Polish | 🔶 Ongoing | Fix as encountered |
| CLI scaffold | ✅ **Phase 1a+1b+1c+2 complete** | 15 commands: chat, continue, fork, version, config, profile, gateway (status/start/stop/restart/logs/install/uninstall), skills (list/install/update/feedback), sessions (list/search/rebuild), create-plugin, completion, doctor, setup, send, migrate |
| Search index | ✅ **FTS5 rebuild** | 3907+ rows indexed from opencode.db |
| Container HEALTHCHECK | ✅ **serve-2** | Curl-based health check added to Dockerfile |
| Session-search plugin | ✅ **Refactored** | Fixed execSync→spawnSync, sqlEscape, snippet column index |

---

## 8. Open Questions

1. **npm package name**: `phronesis` or `@phronesis/cli`? (Check npm availability)
2. **YAML vs JSON for config**: Hermes uses YAML. JSON is simpler to parse in Node. Proposal: YAML for human readability, using `js-yaml`.
3. **Systemd vs direct process**: Gateways currently managed via systemd. Should `phronesis gateway` wrap systemctl or manage processes directly?
4. **Profile switching persistence**: How does a profile switch persist beyond the current shell? (Option: write to `~/.config/phronesis/config.yaml` and source from shell rc)
5. **OpenCode version compatibility**: What happens if a future OpenCode version changes CLI flags?
