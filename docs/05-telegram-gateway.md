# Telegram Gateway — Current Setup & Architecture

## Overview

The Telegram gateway is powered by [`@grinev/opencode-telegram-bot`](https://github.com/grinev/opencode-telegram-bot) — a standalone CLI application that connects Telegram to an OpenCode server via its HTTP API. It is **not** an OpenCode plugin, but a separate process that bridges Telegram messages ↔ OpenCode sessions.

- **Stars**: 743 · **Contributors**: 20 · **Releases**: 45 · **Latest**: v0.21.0
- **License**: MIT
- **Installed version**: v0.20.1 (global npm, `~/.npm-global/bin/opencode-telegram`)

---

## Current Architecture

```
┌──────────────┐      HTTP API       ┌─────────────────┐
│  Telegram    │◄──────────────────►│  opencode serve  │
│  Bot Client  │    port 4096        │  port 4096       │
│  (systemd)   │                     │  (systemd)       │
└──────┬───────┘                     └────────┬────────┘
       │                                     │
       │  WebSocket updates                   │  Plugin pipeline
       │  + commands                          │  (skill-creator,
       ▼                                     ▼  session-search, etc.)
┌──────────────────────────────────────────────────────────┐
│              oc-srv-workspace / plugins                   │
└──────────────────────────────────────────────────────────┘
```

### Systemd Services

**`opencode-serve.service`** — runs the OpenCode API server:
```
ExecStart=/home/moritz/.opencode/bin/opencode serve --hostname 127.0.0.1 --port 4096
WorkingDirectory=/home/moritz/oc-srv-workspace
```

**`opencode-telegram.service`** — runs the Telegram bot client:
```
ExecStart=/home/moritz/.npm-global/bin/opencode-telegram start
WorkingDirectory=/home/moritz
Restart=always
```

### Configuration Files

| File | Purpose |
|------|---------|
| `~/.config/opencode-telegram-bot/.env` | Bot token, user ID, model, server auth, TTS, locale |
| `~/.config/opencode-telegram-bot/settings.json` | Current project, session, scheduled tasks |
| `~/.config/opencode-telegram-bot/logs/` | Daily rotating log files |

### Key Environment Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `TELEGRAM_BOT_TOKEN` | *(secret)* | Bot token from @BotFather |
| `TELEGRAM_ALLOWED_USER_ID` | *(user ID)* | Restricts bot to single user |
| `OPENCODE_SERVER_USERNAME` | `opencode` | Auth for OpenCode API |
| `OPENCODE_MODEL_PROVIDER` | `opencode` | Default model provider |
| `OPENCODE_MODEL_ID` | `big-pickle` | Default model |
| `BOT_LOCALE` | `en` | Interface language |
| `OPEN_BROWSER_ROOTS` | `~/agent,~/oc-srv-workspace` | Allowed directory roots |

---

## Feature Set

The bot provides full Telegram-native interaction with OpenCode:

### Session Management
- `/start` — create or switch to a session
- `/sessions` — list and switch between sessions
- `/session` — view current session details
- Auto-titles sessions and persists across restarts

### Model & Agent Control
- `/model` — switch models (provider/model/variant)
- `/agent` — switch agents (e.g., `orchestrator`, `build`, `plan`)
- Persists current agent & model across restarts

### File Operations
- Send documents → uploaded to workspace
- `/code` — view/edit files inline
- `/open` — browse directory tree with permission gating

### Skill System
- `/skills` — list, view, and manage SKILL.md files
- Skills integrate with OpenCode's skill discovery

### Permissions
- Interactive allow/deny prompts for tool calls
- Permission gating respects `opencode.json` rules
- Session-level and tool-level permission prompts

### Scheduling
- `/schedule` — create recurring tasks via `opencode-scheduler`
- `/tasks` — manage scheduled tasks
- Results delivered to Telegram

### Advanced
- **Live tracking** — streaming updates during assistant responses
- **Voice/TTS** — Google Cloud TTS with en-US-Studio-O voice
- **Subagents** — switch agents mid-conversation
- **Worktree support** — switch between git worktrees
- **i18n** — 6 languages (en, de, es, fr, ru, zh)
- **Pinned message** — quick-status pinned to chat

---

## How It Connects to Phronesis Plugins

The Telegram bot communicates with `opencode serve`, which loads all configured plugins. This means **all Phronesis plugins are automatically available through Telegram**:

| Plugin | Available via Telegram |
|--------|----------------------|
| `skill-creator` | ✅ Agent can call `save-skill`, `list-skills`, `update-skill`, `skill-feedback` via Telegram |
| `session-search` | ✅ Agent can call `search-sessions` via Telegram |
| `supermemory` | ✅ Agent can access persistent memory via Telegram |
| `opencode-scheduler` | ✅ `/schedule` and `/tasks` commands |
| `opencode-pty` | ✅ Background process management |
| `octto` | ✅ Brainstorming (via browser) |

No additional integration needed — the bot delegates all LLM interactions to the OpenCode server, which runs the plugin pipeline.

---

## Platform Comparison for Gateway Phase

| Platform | OpenCode Bot Available | Status for Phronesis |
|----------|-----------------------|---------------------|
| **Telegram** | ✅ `@grinev/opencode-telegram-bot` (v0.20.1) | **Active & running** |
| **Email** | ⚠️ AgentMail MCP (`mcp.agentmail.to`) | **Config added** — needs AgentMail API key |
| **Discord** | ❌ No mature bot | Future consideration |
| **Slack** | ❌ No mature bot | Future consideration |
| **WhatsApp** | ❌ No mature bot | Future consideration |
| **Signal** | ❌ No mature bot | Future consideration |
| **IRC** | ❌ No known bot | Future consideration |

### Email via AgentMail

AgentMail has been added as an MCP server in `opencode.json`:

```json
"agentmail": {
    "type": "remote",
    "url": "https://mcp.agentmail.to/mcp",
    "enabled": true
}
```

To activate it, you need:
1. An AgentMail account and API key
2. Configure the `x-api-key` header or OAuth for authentication
3. AgentMail's MCP tools will then be available to the agent

---

## Future Plans

### Phase 🔴 (Gateway Expansion)

1. **Telegram v0.21.0 upgrade** — Currently blocked by `better-sqlite3` native compilation failure in the global npm context. Needs root-free rebuild or containerized bot.
2. **Multi-platform gateway** — Options under consideration:
   - **Build native MCP servers** — One per platform (high effort, full control)
   - **Integrate Hermes gateway** — Hermes already has full Telegram/Discord/Slack/Signal/Email gateway. Bridge via MCP as passthrough.
   - **Hybrid** — Hermes gateway as message router, OpenCode as brain
3. **Email bridge** — AgentMail MCP already configured. Next step: define email-handling agent workflow.

### Upgrade Path for Telegram Bot

```bash
# Use npm with --build-from-source or switch to pnpm
npm install -g @grinev/opencode-telegram-bot --build-from-source

# Or use containerized approach
docker pull ghcr.io/grinev/opencode-telegram-bot:latest
```

---

## Troubleshooting

**Bot not responding**:
```bash
sudo systemctl status opencode-telegram.service
sudo journalctl -u opencode-telegram.service -n 50 --no-pager
```

**Server not reachable**:
```bash
sudo systemctl status opencode-serve.service
curl -s http://localhost:4096/ | head
```

**Check logs**:
```bash
ls -t ~/.config/opencode-telegram-bot/logs/
tail -f ~/.config/opencode-telegram-bot/logs/bot-$(date +%F).log
```
