# Gateway Strategy

## Current Architecture

```
Telegram ──→ opencode-telegram ─HTTP──→ opencode serve ──→ Phronesis plugins
                                            │
AgentMail ─────MCP (remote) ───────────→ opencode serve
                                            │
CLI ──────→ opencode (TUI) ─────────────→ opencode serve
```

## Platforms

### ✅ Telegram (Production)
**Status**: Running via `@grinev/opencode-telegram-bot` v0.20.1  
**Connection**: HTTP to `opencode serve` on port 4096  
**Features**: Sessions, models, permissions, files, voice, scheduling, skills, agents  
**Multi-instance**: Yes — separate bot tokens, shared backend

### 🟡 AgentMail (Optional)
**Status**: Can be configured as a remote MCP server; activation requires explicit configuration and credentials
**Connection**: Remote MCP at `https://mcp.agentmail.to/mcp`  
**Use case**: Email gateway — send emails from OpenCode, receive and process incoming  
**Auth**: x-api-key header or OAuth

### ✅ CLI (Native)
**Status**: Always available  
**Connection**: Direct TUI or `opencode run` commands  
**Use case**: Interactive development, automation scripts, scheduled tasks

## Future Platforms (Priority Order)

### 🟢 Next: Discord
**Effort**: 2-3 days if using existing `discord.js` + `@grinev` patterns  
**Approach**: Fork `opencode-telegram-bot` patterns → adapt for Discord  
**Possible later alternative**: Evaluate Hermes gateway interoperability via MCP/API after the native Phronesis gateway path is reliable. This is not a current dependency.
**Key features needed**: Channels, threads, slash commands, file uploads

### 🟡 Medium: Email (Interactive)
**Effort**: 1 week  
**Approach**: Extend AgentMail MCP or build IMAP/SMTP MCP server  
**Use case**: Email-to-OpenCode (process incoming emails as tasks), OpenCode-to-Email (send results)

### 🟡 Medium: Slack
**Effort**: 1-2 weeks  
**Approach**: Slack Bolt SDK → MCP server → OpenCode  
**Challenges**: Slack API complexity, scopes, event subscriptions

### 🔴 Future: WhatsApp / Signal / IRC
**Effort**: 1-3 months each  
**Priority**: Low for POC — revisit after core Phronesis features are stable

## Gateway Architecture Pattern

```
┌──────────────────────────┐
│  Platform-specific Adapter  │
│  (Telegram, Discord, etc.)  │
│                             │
│  ┌─────────────────────┐  │
│  │ Message Translation  │  │
│  │ Platform ↔ OpenCode  │  │
│  └─────────────────────┘  │
│  ┌─────────────────────┐  │
│  │ Auth & Permissions   │  │
│  │ User mapping         │  │
│  └─────────────────────┘  │
│  ┌─────────────────────┐  │
│  │ Session Management   │  │
│  │ Per-user sessions    │  │
│  └─────────────────────┘  │
└──────────┬───────────────┘
           │ HTTP / SSE
           ▼
┌──────────────────────────┐
│     opencode serve        │
│  ┌────────────────────┐  │
│  │  Phronesis Plugins  │  │
│  │  (skills, memory,  │  │
│  │   persona, search)  │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

Each platform adapter:
1. **Translates** platform-specific message format to OpenCode's API format
2. **Maps** platform users to OpenCode sessions
3. **Enforces** platform-specific auth and permissions
4. **Bridges** responses back to the platform

## Using Hermes Gateway as a Bridge

An optional future alternative to building each platform adapter from scratch would be to use Hermes Agent's existing multi-platform gateway through an MCP/API boundary:

```
Telegram ──→ Hermes Gateway ──MCP──→ opencode serve
Discord  ──→ Hermes Gateway ──MCP──→ opencode serve
WhatsApp ──→ Hermes Gateway ──MCP──→ opencode serve
```

**Pros**: Instant multi-platform, Hermes maintains the platform adapters  
**Cons**: Dependency on external project, potential API changes, added latency  
**Viability**: Undetermined — this must not be treated as a current architectural assumption or prerequisite.

## Phronesis Integration Points

Gateways can benefit from Phronesis when the relevant plugins are explicitly registered and verified in the OpenCode server:

| Feature | How Gateway Users Experience It |
|---------|--------------------------------|
| **Skill Creator** | `/tool save-skill` from any platform |
| **Session Search** | "Remember when..." prompts auto-trigger search |
| **Persona** | Each gateway user gets consistent persona |
| **Memory** | Facts added from any platform persist for all |
| **Consolidation** | Tool-based/heartbeat detection is available when the memory plugin is enabled; scheduler automation remains planned |

## Recommended Path

1. 🟡 **Current**: Telegram gateway path documented; AgentMail remains optional
2. 🟢 **Next**: Verify the target OpenCode configuration, complete Telegram multi-instance setup, and activate AgentMail only if needed
3. 🟡 **After**: Discord adapter (clone telegram-bot pattern)
4. 🔴 **Later**: Evaluate optional Hermes gateway interoperability for remaining platforms, without making Hermes required
