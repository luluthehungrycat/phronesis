# Strategic Roadmap

## Phase 🟢: Do First (Days)

### P1: `opencode-skill-creator` — Auto-Skill Creation
**Status**: ⬜ Not started  
**Effort**: 2-3 days  
**Depends on**: Nothing (pure plugin)

**What it does**:
- Monitors session/task completion via plugin hooks
- Analyzes tool usage — if complex (5+ tool calls, multi-file edits, error recovery), triggers skill creation
- Uses LLM to distill the approach into a valid SKILL.md
- Writes to `.opencode/skills/<name>/SKILL.md`
- Registers for discovery on next agent start
- Asks user: "This task required solving X. Want to save this approach as a reusable skill?"

**Hook points**:
- `willExecuteTask` / `didExecuteTask` — completion detection
- `didCompleteToolCall` — complexity tracking

**Architecture**:

```
Session complete → Complexity check → LLM extracts pattern
    → Generate SKILL.md → Write to .opencode/skills/
    → Notify user → Ready for next session
```

### P2: `opencode-session-search` — FTS5 Session Search
**Status**: ⬜ Not started  
**Effort**: 2-3 days  
**Depends on**: Nothing

**What it does**:
- Creates FTS5 virtual tables over OpenCode's existing session SQLite database
- Provides `/search-sessions` tool: query → FTS5 search → LLM summarize relevant snippets
- Results include session ID, timestamp, relevance score, and summary
- Optional: auto-inject relevant context when starting a new session

**Architecture**:

```
User query → FTS5 search on sessions.db → Rank results
    → LLM summarizes top matches → Return context
    → (future: auto-inject into session context)
```

### P3: Skill Improvement Pipeline
**Status**: ⬜ Not started  
**Effort**: 3-4 days  
**Depends on**: P1

**What it does**:
- Tracks when a loaded skill is invoked
- Detects when the user corrects or deviates from the skill's approach
- On session end, compares actual vs skill-prescribed behavior
- If significant deviation, LLM suggests an updated version
- User can approve, edit, or reject the update

---

## Phase 🟡: Do Second (1-2 Weeks)

### P4: `opencode-persona` — Structured Persona System
**Status**: ⬜ Not started  
**Effort**: 3-5 days  
**Depends on**: Nothing

**What it does**:
- Defines `PERSONA.md` convention with schema: identity, behavior rules, communication style, constraints, triggers
- Auto-injects into agent instructions on session start
- Provides `/set-persona`, `/get-persona`, `/edit-persona` tools
- Compatible with Hermes' SOUL.md format (bidirectional import/export)

### P5: `opencode-memory-consolidator` — Background Mind Dumps
**Status**: ⬜ Not started  
**Effort**: ~1 week  
**Depends on**: `opencode-scheduler`, `opencode-supermemory` or `opencode-mem`

**What it does**:
- Cron-triggered background task (e.g., every 6 hours)
- Reviews recent sessions since last consolidation
- Extracts durable facts: user preferences, project decisions, environment changes
- Compacts into supermemory or local vector DB
- Prunes redundant/outdated memories
- Reports: "Consolidated N new facts from M sessions"

### P6: Remote Execution Plugin
**Status**: ⬜ Not started  
**Effort**: 1-2 weeks  
**Depends on**: Docker/SSH MCP servers or direct SDK integration

**What it does**:
- Unified `run-on <target> <command>` interface
- Backends: local, Docker container, SSH host
- Pluggable transport — add Modal or Daytona as MCP servers
- Results streamed back to agent context

---

## Phase 🔴: Do Third (1-3 Months)

### P7: Multi-Platform Gateway
**Status**: ⬜ Not started  
**Effort**: 1-2 months  
**Depends on**: All of Phase 🟢 + 🟡

**Options**:
1. **Build native** — one MCP server per platform (Telegram, Discord, Slack)
2. **Integrate Hermes gateway** — Hermes already has full gateway. Bridge it via MCP as a passthrough.
3. **Hybrid** — Use Hermes gateway as message router, OpenCode as brain.

### P8: Full Skill Lifecycle Management
**Status**: ⬜ Not started  
**Effort**: 1-2 months  
**Depends on**: P1, P3

Extends auto-skill creation with:
- **Skill registry** — catalog of all skills with metadata (version, usage count, success rate)
- **Effectiveness metrics** — track how often each skill is used and with what outcome
- **Auto-verification** — test skills against known scenarios
- **Safe auto-patching** — when improvement confidence is high, patch without human review
- **Skill deprecation** — retire skills that are never used or consistently wrong

### P9: User Profiling System
**Status**: ⬜ Not started  
**Effort**: 2-4 weeks  
**Depends on**: P2, P5

Builds longitudinal user models:
- Communication style preferences (verbosity, formality, technical depth)
- Common task patterns (what the user frequently does)
- Decision history (preferred frameworks, libraries, approaches)
- Behavior adaptation (adjusts to user's changing patterns over time)

---

## Prioritization Rationale

```
Impact
  ↑
  │  P1 ●  P2
  │  (auto-skills) (session search)
  │
  │  P5 ●       P4 ●
  │  (consolidation)  (persona)
  │
  │  P7 ●  P8 ●  P9 ●
  │  (gateway)  (lifecycle)  (profiling)
  │
  └────────────────────────────→ Effort
     Low              High
```

**P1 (auto-skill creation) is the clear starting point**: highest impact, lowest effort, unlocks everything else.
