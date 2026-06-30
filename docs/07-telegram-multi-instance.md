# Telegram Multi-Instance Deployment

## Overview

Phronesis uses [@grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot) (v0.20.1) as its Telegram gateway. This is a standalone CLI application that connects to OpenCode's HTTP API (`opencode serve`), not an OpenCode plugin — which provides better reliability isolation.

You're running it right now — this very conversation is going through this gateway.

## Architecture

```
Telegram User ←→ opencode-telegram ←HTTP→ opencode serve ←→ Phronesis plugins
                                            │
                                            ├── opencode-skill-creator
                                            ├── opencode-session-search
                                            ├── opencode-persona
                                            └── opencode-memory-consolidation
```

## Multi-Instance Strategy

### Why Multiple Instances?

Different use cases benefit from separate bot instances:

| Instance | Purpose | Bot Token | Agent Config | Persona | Memory Scope |
|----------|---------|-----------|--------------|---------|-------------|
| **Main** | Daily workflow agent | Primary bot | Full orchestrator | Default assistant | Full project |
| **Code Review** | Automated PR review | Secondary | Headless reviewer | "Expert Reviewer" | Codebase |
| **Ops** | System monitoring | Ops token | Plan/execute | "DevOps Specialist" | Operations |
| **Research** | Web research | Research token | Researcher/scribe | "Research Assistant" | Research |

### Shared Infrastructure

All instances share:
- Same `opencode serve` process (port 4096)
- Same Phronesis plugins (skills, memory, persona)
- Same session database
- Separate Telegram bot tokens (different bots in Telegram)

### Configuration Per Instance

```bash
# Instance 1: Main
opencode-telegram start \
  --token "BOT_TOKEN_1" \
  --port 4096 \
  --allowed-users "user1,user2" \
  --model "primary"

# Instance 2: Code Review
opencode-telegram start \
  --token "BOT_TOKEN_2" \
  --port 4096 \
  --allowed-users "user1" \
  --model "reasoning" \
  --agent "reviewer"
```

### Configuration via `settings.json`

```json
{
  "bots": [
    {
      "token": "BOT_TOKEN_1",
      "name": "Main Assistant",
      "allowedUsers": ["user1", "user2"],
      "defaultModel": "primary",
      "port": 4096
    },
    {
      "token": "BOT_TOKEN_2",
      "name": "Code Reviewer",
      "allowedUsers": ["user1"],
      "defaultModel": "reasoning",
      "systemPrompt": "You are a senior code reviewer. Be thorough and constructive.",
      "port": 4096
    }
  ]
}
```

## Systemd Multi-Instance Setup

Create separate service files per instance:

### `/etc/systemd/system/opencode-telegram-main.service`

```ini
[Unit]
Description=OpenCode Telegram Bot — Main
After=network.target opencode-serve.service
Requires=opencode-serve.service

[Service]
Type=simple
User=user
EnvironmentFile=/home/user/.opencode-telegram/main.env
ExecStart=/home/user/.npm-global/bin/opencode-telegram start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Environment File (`~/.opencode-telegram/main.env`)

```env
OPENCODE_TELEGRAM_BOT_TOKEN=your_bot_token_here
OPENCODE_TELEGRAM_ALLOWED_USERS=user1,user2
OPENCODE_TELEGRAM_PORT=4096
OPENCODE_TELEGRAM_DEFAULT_MODEL=primary
```

## Container Deployment

For production, each instance runs as a container:

### Docker Compose

```yaml
version: "3.8"
services:
  opencode-serve:
    image: opencode-server:latest
    ports:
      - "127.0.0.1:4096:4096"
    volumes:
      - opencode-data:/home/opencode/.local/share/opencode
      - ./opencode.json:/home/opencode/.config/opencode/opencode.json
    command: ["opencode", "serve", "--port", "4096"]

  telegram-main:
    image: opencode-telegram:latest
    depends_on: [opencode-serve]
    environment:
      - BOT_TOKEN=${MAIN_BOT_TOKEN}
      - OPENCODE_URL=http://opencode-serve:4096
      - ALLOWED_USERS=${ALLOWED_USERS}

  telegram-reviewer:
    image: opencode-telegram:latest
    depends_on: [opencode-serve]
    environment:
      - BOT_TOKEN=${REVIEWER_BOT_TOKEN}
      - OPENCODE_URL=http://opencode-serve:4096
      - ALLOWED_USERS=${ALLOWED_USERS}
      - AGENT=reviewer

volumes:
  opencode-data:
```

## Integration with Phronesis Plugins

All Telegram instances automatically benefit from Phronesis plugins loaded in `opencode serve`:

### Skill Creator
- `save-skill` and `update-skill` available via Telegram
- After complex conversations → agent suggests saving as skill
- Users can trigger: "/tool save-skill name='...' description='...'"

### Session Search
- "Remember when we fixed the database issue?" → agent uses `/search-sessions`
- Cross-session context injection via system prompt

### Persona
- Each bot instance can have a different persona via `set-persona`
- Persona persists across sessions
- `/tool set-persona persona='{"name":"..."}'` from Telegram

### Memory Consolidation
- Facts stored via Telegram persist locally
- `memory-stats` available via Telegram
- Consolidation happens automatically in background

## Current Production Instance

Your current setup (already running):

| Component | Status | Details |
|-----------|--------|---------|
| `opencode serve` | ✅ Running | Port 4096, v1.15.10 |
| `opencode-telegram` | ✅ Running | v0.20.1, foreground mode |
| AgentMail MCP | ✅ Configured | Remote MCP server |
| Phronesis plugins | ✅ Loaded | skill-creator, session-search, persona, memory-consolidation |

## Upgrade Path

When ready to upgrade the Telegram bot (currently blocked by better-sqlite3 native compilation):

```bash
# Option 1: Rebuild from source (needs build tools)
npm install -g @grinev/opencode-telegram-bot --build-from-source

# Option 2: Use Docker image (recommended)
docker pull grinev/opencode-telegram-bot:latest

# Option 3: Wait for prebuilt binary matching your Node version
# Current: v0.20.1 (works), target: v0.21.0
```

## Security Considerations

- Bot tokens are secrets — use environment variables or a secrets manager
- `allowedUsers` restricts who can interact with each bot instance
- Each instance can have different permission levels
- Container deployment keeps bots isolated
- AgentMail MCP requires API key for outbound email
