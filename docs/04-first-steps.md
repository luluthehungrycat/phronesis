# First Steps — Getting Started with Phronesis

## Immediate Next Actions

### Step 1: Explore OpenCode Plugin Architecture

Before writing any code, understand the plugin system that will host all Phronesis capabilities.

**Tasks**:
- [ ] Read the OpenCode plugin development docs (if they exist) or examine existing plugins like `opencode-supermemory` or `opencode-scheduler`
- [ ] Identify the exact hook signatures: what data is passed to `didExecuteTask`, `didCompleteToolCall`, etc.
- [ ] Understand the tool registration mechanism (how plugins expose tools to agents)
- [ ] Look at how `opencode-skillful` discovers and injects SKILL.md files

**Why**: The entire Phronesis architecture depends on hooking into the right points. Getting this right from the start prevents rewrites.

### Step 2: Inspect Session Database Schema

Find and analyze the SQLite database that stores session data.

**Tasks**:
- [ ] Locate the sessions.db file (`~/.local/share/opencode/` or similar)
- [ ] Dump the schema: `sqlite3 sessions.db .schema`
- [ ] Check for existing indexes, triggers, or virtual tables
- [ ] Verify that message content is stored with enough fidelity for FTS5 search
- [ ] Check how sessions are segmented (are individual tool calls stored separately?)

**Why**: FTS5 session search (P2) depends entirely on the quality and structure of this data. If it's incomplete or opaque, we may need to augment what gets stored.

### Step 3: Prototype `opencode-skill-creator` (P1)

This is the highest-priority plugin. Build a minimal proof of concept.

**Tasks**:
- [ ] Scaffold a new OpenCode plugin (package.json, plugin entry point)
- [ ] Register `didExecuteTask` hook
- [ ] Collect basic metrics: tool call count, files modified, errors encountered
- [ ] When threshold is exceeded, call LLM to generate a SKILL.md draft
- [ ] Write the draft to `.opencode/skills/<auto-name>/SKILL.md`
- [ ] Notify user with a summary and offer to review

**Minimal viable version**:
- Hard-coded threshold (≥5 tool calls)
- Fixed skill name based on task summary
- No deduplication (writes a new skill every time)
- User must manually review and edit

**Enhanced version**:
- Configurable thresholds via plugin config
- Deduplication: check if similar skill exists before creating
- User feedback loop: "Was this skill useful?" rating
- Auto-inject relevant skills at session start

### Step 4: Prototype `opencode-session-search` (P2)

**Tasks**:
- [ ] Connect to sessions.db and examine message storage format
- [ ] Create an FTS5 virtual table indexing message content
- [ ] Implement a simple search tool: `/search-sessions` with query parameter
- [ ] Add LLM summarization of top results
- [ ] Test with real session data

### Step 5: Connect the Loop

Once P1 and P2 work independently:
- Use session search (P2) to find relevant past solutions
- Feed relevant context into new sessions automatically
- When a solution is repeated, prompt to formalize as a skill

---

## Project Infrastructure Setup

### Repository

```bash
# Already done:
mkdir -p ~/agent/repos/phronesis
cd ~/agent/repos/phronesis
git init

# Next:
git add .
git commit -m "Initial project scaffold with roadmap and architecture docs"
```

### Development Environment

The workspace already has OpenCode installed with plugins. The Phronesis plugins can be developed:
1. **Locally** in `src/` for initial prototyping
2. **As npm packages** once stable (published to npm as `opencode-*`)

For local development, symlink or point OpenCode config at the local plugin path:

```json
// In opencode.jsonc
{
  "plugins": [
    // "...",
    "/home/moritz/agent/repos/phronesis/src/skill-creator"
  ]
}
```

---

## Success Criteria for First Week

1. ✅ `opencode-skill-creator` prototype can detect a complex task and save a draft SKILL.md
2. ✅ `opencode-session-search` can find past sessions by natural language query
3. ✅ One complete loop demonstrated: complex task → skill saved → skill reused in later session

---

## Resources

- OpenCode plugin hooks: examine `node_modules/opencode/` types or plugin examples
- Existing plugins in this workspace: `~/.config/opencode/plugins/`
- Hermes Agent source (for reference): `github.com/HermesAgent/hermes` (patterns to emulate, not copy)
- FTS5 documentation: SQLite FTS5 extension docs
