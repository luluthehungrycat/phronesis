# First Steps — Getting Started with Phronesis

## Development Orientation

The initial plugin prototypes have been implemented and are covered by behavior and OpenCode loader-compatibility tests. Use this page as an orientation for extending the existing system rather than as a list of unfinished prerequisites.

### Step 1: Explore OpenCode Plugin Architecture

Review the current OpenCode v1.18 plugin contract before changing a plugin.

**Tasks**:
- [ ] Read the current OpenCode plugin documentation or inspect the pinned `@opencode-ai/plugin` dependency
- [ ] Confirm the default export shape (`{ id, server }`) and current hook signatures
- [ ] Understand the `tool(...)` registration mechanism and permission configuration
- [ ] Compare the existing seven Phronesis plugins before adding a new capability

**Why**: Phronesis runs on OpenCode's supported loader contract; matching the actual runtime prevents compatibility regressions.

### Step 2: Inspect Session Database Schema

Find and analyze the SQLite database that stores session data.

**Tasks**:
- [ ] Locate the sessions.db file (`~/.local/share/opencode/` or similar)
- [ ] Dump the schema: `sqlite3 sessions.db .schema`
- [ ] Check for existing indexes, triggers, or virtual tables
- [ ] Verify that message content is stored with enough fidelity for FTS5 search
- [ ] Check how sessions are segmented (are individual tool calls stored separately?)

**Why**: FTS5 session search (P2) depends entirely on the quality and structure of this data. If it's incomplete or opaque, we may need to augment what gets stored.

### Step 3: Extend `skill-creator` (P1)

This is the highest-priority plugin. Build a minimal proof of concept.

**Tasks**:
- [ ] Review the existing complexity tracking and proposal flow
- [ ] Add approval, quarantine, and security scanning before any new write behavior
- [ ] Extend tests for the changed lifecycle

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

### Step 4: Extend `session-search` (P2)

**Tasks**:
- [ ] Review the existing sidecar FTS5 index and rebuild path
- [ ] Add citations, richer filters, and retention controls
- [ ] Test changes against representative session fixtures

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
  "plugin": [
    // "...",
    "/home/user/phronesis/src/skill-creator"
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
- Hermes Agent source (for reference): `https://github.com/NousResearch/hermes-agent` (patterns to emulate, not copy)
- FTS5 documentation: SQLite FTS5 extension docs
