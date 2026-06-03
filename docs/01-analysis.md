# Hermes Agent vs OpenCode Plugin Ecosystem: Gap Analysis

## 1. OpenCode's Current State

### Built-in Architecture

| Feature             | Status                                           |
| ------------------- | ------------------------------------------------ |
| MCP Protocol        | ✅ Native — stdio, SSE, StreamableHTTP, OAuth    |
| Plugin System       | ✅ 20+ hook points (pipeline pattern)            |
| Skill System        | ✅ SKILL.md — progressive disclosure, cross-platform |
| Agent Delegation    | ✅ Primary + subagents via `task` tool              |
| Permission System   | ✅ Allow/ask/deny with glob patterns             |
| Context Compaction  | ✅ Built-in compression tool                     |
| LSP Integration     | ✅ Built-in                                      |
| Event Bus           | ✅ Architecture-level                            |
| LLM Providers       | ✅ 75+ supported                                 |

### Plugins Already Installed (14 in workspace)

| Plugin                                | Purpose                                                    |
| ------------------------------------- | ---------------------------------------------------------- |
| `opencode-supermemory`                  | Persistent memory via Supermemory API, auto-compaction     |
| `opencode-scheduler`                    | Cron — launchd/systemd/schtasks, no-overlap, timeouts      |
| `octto`                                 | Browser brainstorming — 14 question types, multi-branch    |
| `opencode-pty`                          | Background PTY process management                          |
| `opencode-conductor-plugin`             | Context→Spec→Plan→Implement workflow                       |
| `oh-my-opencode-slim`                   | Batteries-included lightweight framework                   |
| `opencode-agent-tmux`                   | Tmux integration for background agents                     |
| `@tarquinen/opencode-dcp`               | Dynamic context pruning                                    |
| `@franlol/opencode-md-table-formatter`  | Markdown table formatting                                  |
| `@openspoon/subtask2`                   | Command orchestration system                               |
| `opencode-worktree`                     | Git worktree isolation                                     |
| `opencode-codebase-index`               | Semantic code search via embeddings + Tree-sitter          |
| `opencode-browser`                      | Browser automation via Browser MCP                         |
| `opencode-firecrawl`                    | Web scraping/crawling                                      |
| `opencode-swarm`                        | Multi-agent swarm (architect/coder/reviewer/test_engineer) |
| `task-command-executor`                 | Command execution tools                                    |

### Available Ecosystem (not installed)

| Plugin                      | Purpose                                                   |
| --------------------------- | --------------------------------------------------------- |
| `opencode-mem`                | Local vector DB — SQLite + USearch, web UI, auto-capture  |
| `opencode-workspace`          | Bundled multi-agent orchestration (16 components)         |
| `opencode-background-agents`  | Async background delegation                               |
| `opencode-skillful`           | Skill discovery + injection                               |
| `micode`                      | Structured brainstorm→plan→implement workflow             |
| `opencode-secure-storage`     | Encrypted credentials/notes via SOPS                      |

---

## 2. Hermes Agent's Key Capabilities

### Memory System
- **Durable facts** — agent-curated knowledge of user, environment, conventions, decisions
- **Session search** — FTS5 full-text search over past conversations + LLM summarization
- **Honcho integration** — dialectic user profiling (personality, preferences, behavior)
- **Periodic mind dumps** — agent wakes on schedule to extract and compact memories
- **3-way split**: durable facts (memory), procedures (skills), conversation recall (session search)

### Skill System
- **Auto-creation** — after complex tasks (5+ tool calls, tricky fixes, non-trivial workflows) → saves as skill
- **Self-improvement** — skills patched/updated when found stale or incomplete during use
- **Agentskills.io compatible** — open standard format
- **Cross-session persistence** — skills load automatically on relevant tasks

### Multi-Platform Gateway

| Platform  | Integration                 |
| --------- | --------------------------- |
| Telegram  | ✅ Full bot API             |
| Discord   | ✅ Full bot API             |
| Slack     | ✅ Events + commands        |
| WhatsApp  | ✅ Cloud API                |
| Signal    | ✅ Signal Messenger API     |
| Email     | ✅ IMAP/SMTP                |
| CLI       | ✅ Native terminal          |

All from a single gateway process sharing memory, skills, and tools.

### Remote Execution

| Backend     | Status                       |
| ----------- | ---------------------------- |
| Local       | ✅                            |
| Docker      | ✅                            |
| SSH         | ✅                            |
| Singularity | ✅ Containers                 |
| Modal       | ✅ Serverless                 |
| Daytona     | ✅ Dev environments           |

### Other
- **SOUL.md** — structured persona: identity, rules, style, constraints
- **40+ built-in tools**
- **Subagent delegation** — isolated Python subagents with RPC tool calling
- **Cron with platform delivery** — schedule → execute → deliver results to any channel
- **Learning loop**: Understand → Act → Verify → Save facts → Convert to skills → Auto-load

---

## 3. Feature Comparison Matrix

| Capability               | Hermes Agent                            | OpenCode                                | Status                 |
| ------------------------ | --------------------------------------- | --------------------------------------- | ---------------------- |
| Persistent memory        | ✅ Agent-curated, durable                | ✅ supermemory + mem plugins              | **Covered**            |
| Session search (FTS5)    | ✅ Built-in, LLM-summarized              | ❌ Not available                        | **GAP**                |
| User profiling (Honcho)  | ✅ Dialectic user modeling               | ❌ Not available                        | **GAP**                |
| Auto-skill creation      | ✅ After complex/tricky tasks            | ❌ Not available                        | **GAP**                |
| Self-improving skills    | ✅ Patch when stale                      | ❌ Static SKILL.md files                | **GAP**                |
| Multi-platform gateway   | ✅ 6 platforms + CLI                     | ❌ TUI/CLI/Desktop only                 | **GAP (big)**          |
| Cron scheduling          | ✅ Built-in, platform delivery           | ✅ scheduler plugin                     | **Covered** (partial)  |
| Remote execution         | ✅ Docker/SSH/Modal/Daytona/Singularity  | ⚠️ Partial via MCP                      | **GAP**                |
| Persona system           | ✅ SOUL.md structured persona            | ⚠️ Agent prompts/instructions           | **Partial**            |
| Subagent delegation      | ✅ Python RPC subagents                  | ✅ task tool subagents                  | **Covered**             |
| MCP support              | ❌ Not native                            | ✅ Full MCP client (3 transports)       | **OpenCode wins**       |
| Plugin hooks             | ⚠️ Toolset system                        | ✅ 20+ hook points                      | **OpenCode wins**       |
| LLM providers            | ~20 providers                            | ✅ 75+ providers                        | **OpenCode wins**       |
| LSP integration          | ❌ Not available                         | ✅ Built-in                             | **OpenCode wins**       |

---

## 4. Gap Analysis — Effort Estimates

### 🟢 Low Effort (Days, plugin-level)

| Gap | What | How | Effort |
|-----|------|-----|--------|
| **Auto-skill creation** | After complex tasks, prompt "Save as skill?" and auto-generate SKILL.md | Hook session completion → analyze tool patterns → LLM distillation → write `.opencode/skills/` | 2-3 days |
| **Session search (FTS5)** | Full-text search over past sessions with LLM summarization | Add FTS5 virtual tables to existing session DB → search tool → LLM summarize results | 2-3 days |
| **Skill improvement** | Detect stale/corrected skills → propose update | Monitor skill invocation success/failure → diff with correction → LLM suggests updated SKILL.md | 3-4 days |

### 🟡 Medium Effort (1-2 weeks)

| Gap | Effort |
|-----|--------|
| **Enhanced persona system** (PERSONA.md convention + auto-injection) | 3-5 days |
| **Background memory consolidation** (scheduled mind dumps via scheduler + memory plugins) | ~1 week |
| **Remote execution abstraction** (Docker + SSH via unified plugin/MCP) | 1-2 weeks |

### 🔴 High Effort (1-3 months)

| Gap | Effort | Notes |
|-----|--------|-------|
| **Multi-platform gateway** (Telegram, Discord, Slack, WhatsApp, Signal, Email) | 1-2 months for initial 3 platforms | Each platform is a full integration. Could integrate Hermes gateway via MCP instead. |
| **Full self-improving skill lifecycle** (versioning, testing, auto-patching, metrics) | 2-3 weeks prototype, 1-2 months production | Builds on auto-skill creation |
| **Honcho-style user profiling** (longitudinal user models) | 2-4 weeks basic, months production | Requires session search foundation first |

---

## 5. Key Insight

The single most impactful gap to close is **auto-skill creation from experience**:

1. ✅ **Highest leverage** — skills make the agent exponentially more capable over time
2. ✅ **Lowest effort** — SKILL.md system, discovery, injection all exist
3. ✅ **Most "Hermes-like" differentiator** — this is what makes Hermes feel alive and growing
4. ✅ **Self-reinforcing** — more skills → more capability → more complex tasks → more skill creation

A plugin that hooks session/task completion, analyzes the work done, and says "Want to save this as a skill?" immediately makes OpenCode feel like it's learning.
