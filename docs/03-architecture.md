# Technical Architecture

## Plugin Architecture Pattern

All Phronesis plugins follow a consistent pattern leveraging OpenCode's existing infrastructure:

```
┌─────────────────────────────────────────┐
│            OpenCode Agent                 │
│  ┌──────────────────────────────────┐   │
│  │         Plugin Pipeline           │   │
│  │  willExecuteTask → didExecuteTask │   │
│  │  willCompleteTool → didComplete   │   │
│  └──────────┬───────────────────────┘   │
│             │ hooks                     │
│  ┌──────────▼───────────────────────┐   │
│  │        Phronesis Plugin          │   │
│  │  ┌─────────┐  ┌──────────────┐  │   │
│  │  │ Analyzer│  │ Skill Writer │  │   │
│  │  └─────────┘  └──────────────┘  │   │
│  │  ┌─────────┐  ┌──────────────┐  │   │
│  │  │ Context  │  │ Notifier    │  │   │
│  │  │ Loader   │  │             │  │   │
│  │  └─────────┘  └──────────────┘  │   │
│  └──────────▲───────────────────────┘   │
│             │                           │
│  ┌──────────▼───────────────────────┐   │
│  │         MCP Servers              │   │
│  │  (browser, firecrawl, etc.)     │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## Skill Creation Architecture (P1)

### Data Flow

```
1. Hook: didExecuteTask fires with result
         │
         ▼
2. Complexity Analysis
   ┌─────────────────────────────────────┐
   │ Thresholds:                         │
   │ • ≥5 tool calls                     │
   │ • ≥2 files modified                 │
   │ • Error recovery occurred           │
   │ • Task took >30 seconds             │
   │ • User said "remember this"         │
   └────────────┬────────────────────────┘
                │ if above threshold
                ▼
3. Context Collection
   ┌─────────────────────────────────────┐
   │ Gather:                              │
   │ • Task description & goal            │
   │ • Tool call sequence with inputs     │
   │ • File changes (diffs)               │
   │ • Error messages & recovery steps    │
   │ • Final result                       │
   └────────────┬────────────────────────┘
                │
                ▼
4. LLM Distillation
   ┌─────────────────────────────────────┐
   │ Prompt: "Distill this task into a   │
   │ reusable skill. Output SKILL.md     │
   │ format with: name, description,     │
   │ trigger conditions, steps, tools    │
   │ used, examples."                     │
   └────────────┬────────────────────────┘
                │
                ▼
5. Skill Generation
   ┌─────────────────────────────────────┐
   │ Generate:                            │
   │ .opencode/skills/<name>/SKILL.md    │
   │ .opencode/skills/<name>/*.md        │
   │ (reference files, examples)         │
   └────────────┬────────────────────────┘
                │
                ▼
6. Notification
   ┌─────────────────────────────────────┐
   │ "I noticed this task involved a     │
   │ complex workflow. I've drafted a    │
   │ reusable skill. Review it?"         │
   │ [Show] [Edit] [Dismiss]            │
   └─────────────────────────────────────┘
```

### SKILL.md Template (Generated)

```markdown
---
name: fix-package-conflicts
description: Resolve npm/yarn dependency version conflicts
trigger: when npm install fails with "conflicting peer dependency" or ERESOLVE
---

# fix-package-conflicts

## When to Use
When dependency resolution fails due to version conflicts.

## Steps

### 1. Identify the conflict
Run `npm ls <package-name>` to see the dependency tree.

### 2. Choose resolution strategy
- **Overrides** (npm): Add `"overrides"` to package.json
- **Resolutions** (yarn): Add `"resolutions"` to package.json
- **Dedupe**: Run `npm dedupe`

### 3. Verify
Run `npm install` again and verify no errors.

## Tools Used
- bash (npm commands)
- edit (package.json modifications)
- read (package.json inspection)

## Example
[Example of resolving react-dom version conflict]
```

## Session Search Architecture (P2)

### Data Sources

```
OpenCode Session DB (~/.local/share/opencode/)
┌──────────────────┐
│ sessions.db       │ ← SQLite database
│  ├─ sessions      │   session_id, created_at, updated_at
│  ├─ messages      │   session_id, role, content, timestamp
│  └─ tool_calls    │   session_id, tool, input, output
└────────┬─────────┘
         │ FTS5 virtual tables
         ▼
┌──────────────────┐
│ sessions_fts      │ ← Full-text search index
│  ├─ content       │   concatenated session content
│  └─ metadata      │   session_id, timestamp, tool_count
└────────┬─────────┘
         │ search query
         ▼
┌──────────────────┐
│ Search Tool       │
│  query(str)       │ → ranked session IDs
│  limit(int)       │ → LLM-summarized snippets
│  time_range(str)  │ → relevance scores
└──────────────────┘
```

### Tool Interface

```
/search-sessions
  query: "how did I fix the auth token issue?"
  limit: 5
  time_range: "last 30 days"

→ Returns:
  [
    {
      session_id: "abc123",
      date: "2026-05-28",
      relevance: 0.92,
      summary: "Fixed JWT token expiration by adding refresh_token flow in auth middleware",
      snippets: ["...set refresh token cookie...", "...verify on 401 response..."]
    },
    ...
  ]
```

## Skill Improvement Pipeline (P3)

```
       ┌──────────────┐
       │ Skill Loaded │
       └──────┬───────┘
              │
       ┌──────▼───────┐
       │ Session Runs │
       └──────┬───────┘
              │
       ┌──────▼────────────────┐
       │ Deviation Detection    │
       │ Did actual steps match │
       │ skill-prescribed steps?│
       └──────┬────────────────┘
              │ if mismatch > threshold
              ▼
       ┌──────────────────────┐
       │ LLM Diff Analysis     │
       │ "Skill says use X,    │
       │  but user did Y.      │
       │  Is Y better?"        │
       └──────┬───────────────┘
              │ if improvement detected
              ▼
       ┌──────────────────────┐
       │ Updated SKILL.md     │
       │ Draft                 │
       └──────┬───────────────┘
              │
       ┌──────▼───────────────┐
       │ User Review          │
       │ [Approve] [Edit]     │
       │ [Reject]             │
       └──────────────────────┘
```

## Integration Points

### Plugin Hooks Used
| Hook | P1 | P2 | P3 | P4 | P5 |
|------|:--:|:--:|:--:|:--:|:--:|
| `willExecuteTask` | ✅ |    |    | ✅ |    |
| `didExecuteTask` | ✅ |    | ✅ |    |    |
| `didCompleteToolCall` | ✅ |    | ✅ |    |    |
| `willResolveTask` |    |    | ✅ |    |    |
| `didResolveTask` |    |    | ✅ |    |    |
| `willStartSession` |    | ✅ |    | ✅ |    |
| session lifecycle |    | ✅ |    |    | ✅ |

### MCP Integration
- Phronesis plugins use MCP servers for external services (Supermemory API, vector DBs)
- No MCP server needs to be built for the first 3 plugins — they operate on local files + SQLite
- The gateway (P7) would use MCP servers for each platform bridge

## Tech Stack Decisions

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Plugin runtime | OpenCode native (JS/TS) | Full access to hooks, context, tools |
| Skill storage | `.opencode/skills/` filesystem | Works with existing discovery mechanism |
| Session DB | SQLite + FTS5 | Already present, zero external deps |
| Memory backend | supermemory API (existing) then `opencode-mem` local | Progressive: API first, local later |
| LLM distillation | OpenCode agent's own model | No extra dependency, context-aware |
