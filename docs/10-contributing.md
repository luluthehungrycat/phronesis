# Contributing to Phronesis

## Getting Started

### Prerequisites
- Node.js 22+ (ESM native)
- OpenCode v1.15+ (binary at `~/.opencode/bin/opencode`)
- Podman or Docker (for running tests in container)
- npm (for plugin dependencies)

### Clone & Setup

```bash
git clone ~/agent/repos/phronesis
cd phronesis

# Install dependencies for all plugins
cd src/skill-creator && npm install && cd ../..
cd src/session-search && npm install && cd ../..
cd src/persona && npm install && cd ../..
cd src/memory-consolidation && npm install && cd ../..
```

### Register a Plugin Locally

Add to `opencode.json`:

```json
{
  "plugins": [
    "file:///home/user/phronesis/src/skill-creator",
    "file:///home/user/phronesis/src/session-search",
    "file:///home/user/phronesis/src/persona",
    "file:///home/user/phronesis/src/memory-consolidation"
  ]
}
```

Each plugin also needs a permission entry for its tools. Example:

```json
{
  "permissions": {
    "save-skill": "allow",
    "list-skills": "allow",
    "search-sessions": "allow",
    "get-persona": "allow"
  }
}
```

---

## Plugin Development Guide

### Project Structure

Each plugin follows the same structure:

```
src/<plugin-name>/
├── package.json           # ESM module, @opencode-ai/plugin dependency
├── index.js               # Plugin entry — default export matching Plugin type
└── node_modules/          # Dependencies (gitignored)
```

### Minimal Plugin Template

```javascript
// src/<name>/index.js
import { tool } from "@opencode-ai/plugin";

export default () => ({
  config: [
    {
      handler: async (input, context) => {
        // Register permissions, slash commands
        return { output: input };
      },
    },
  ],
  tool: {
    "my-tool": tool({
      description: "Does something useful",
      args: {
        query: tool.schema.string().describe("Search query"),
      },
      async execute(args, ctx) {
        // args.query is validated string
        return `Result for: ${args.query}`;
      },
    }),
  },
  "experimental.chat.system.transform": [
    {
      handler: async (input, context) => {
        // Modify system prompt
        return { output: { parts: [...input.output.parts, { text: "\nExtra context" }] } };
      },
    },
  ],
});
```

### Key Patterns

#### 1. Per-Session State
Use a `Map<sessionID, State>` for tracking state across tool calls:

```javascript
const sessionState = new Map();

export default () => ({
  "tool.execute.after": [
    {
      handler: async (input, context) => {
        const { sessionID } = input;
        if (!sessionState.has(sessionID)) {
          sessionState.set(sessionID, { toolCalls: [] });
        }
        const state = sessionState.get(sessionID);
        state.toolCalls.push(input.tool);
        return { output: input.output };
      },
    },
  ],
});
```

#### 2. Error-Resilient Hooks
Always wrap hook handlers to prevent plugin errors from breaking the agent:

```javascript
handler: async (input, context) => {
  try {
    // ... your logic
  } catch (err) {
    console.error(`[plugin-name] Error:`, err);
    return { output: input.output }; // pass through on error
  }
}
```

#### 3. Sidecar SQLite Databases
For plugins needing persistent storage, use a separate SQLite DB rather than modifying `opencode.db`:

```javascript
import Database from "better-sqlite3";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const DB_PATH = join(homedir(), ".local", "share", "opencode", "phronesis_plugin.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
```

#### 4. Tool Registration Without Zod
If you don't need Zod validation, tools can be plain objects:

```javascript
tool: {
  "hello": {
    description: "Say hello",
    execute: async (args, ctx) => "Hello!"
  }
}
```

#### 5. Synthetic Message Parts
To inject content the agent sees as a conversation turn:

```javascript
output.parts.push({
  id: `prt_plugin-${Date.now()}`,
  sessionID: input.sessionID,
  messageID: output.message.id,
  type: "text",
  text: "Reminder: you have an unconsolidated memory.",
  synthetic: true
});
```

### Hooks Reference

| Hook | When | What You Get | What You Return |
|------|------|-------------|-----------------|
| `tool` | Plugin load | — | Object of tool definitions |
| `config` | Config loaded | Full config | Modified config |
| `chat.message` | New message | Message + context | Modified message list |
| `chat.params` | Before LLM | LLM params | Modified params |
| `tool.execute.before` | Before tool runs | Input args | Modified args |
| `tool.execute.after` | After tool completes | Output result | Modified result |
| `experimental.chat.system.transform` | Before LLM system prompt | System prompt parts | Modified parts |
| `experimental.chat.messages.transform` | Before LLM message list | Message list | Modified list |
| `experimental.session.compacting` | During context compaction | Compaction context | Modified prompt |
| `command.execute.before` | Before shell command | Command | Modified command |

---

## Testing

### Running Tests Locally

```bash
# Build and run the test container
cd tests/container
podman-compose build
podman-compose run --rm tests
```

Or with Docker:

```bash
docker compose -f tests/container/docker-compose.yml build
docker compose -f tests/container/docker-compose.yml run --rm tests
```

### Test Architecture

Tests run inside a Podman/Docker container:
- **Base**: `node:22-bookworm-slim`
- **OpenCode**: Downloaded from GitHub releases (not npm — `@opencode-ai/cli` is not published to npm)
- **Plugins**: Source code copied from `src/`, dependencies installed at build time
- **Database**: Isolated SQLite database created in the container

### Test Structure (`tests/container/test.mjs`)

| Section | Tests | Description |
|---------|-------|-------------|
| 1. Module Parsing | 10 | Plugin imports, hook shapes, tool registration |
| 2. FTS5 Search | 2 | Index build, search, empty results |
| 3. Skill File System | 10 | SKILL.md CRUD, dedup, feedback |
| 4. System Transform | 3 | System prompt injection |
| 5. OpenCode Binary | 3 | Binary presence, config, server |
| 6. Persona Plugin | 9 | Persona CRUD, import/export, transforms |
| 7. Memory Consolidation | 11 | Fact CRUD, observations, stats, transforms |

### Adding Tests

1. Add a new section or extend an existing one in `test.mjs`
2. If adding a new plugin, update the Dockerfile to install its dependencies
3. Run `podman-compose build && podman-compose run --rm tests`
4. Verify all tests pass before committing

### Test Patterns

```javascript
// Plugin module import test
assert.doesNotThrow(async () => {
  const mod = await import(pathToPlugin);
  assert.equal(typeof mod.default, "function");
  const hooks = await mod.default();
  assert.ok(hooks.tool["my-tool"]);
});

// Tool registration test
assert.ok(hooks.tool["my-tool"].description);
assert.ok(typeof hooks.tool["my-tool"].execute, "function");

// File system test
const skillsDir = join(tmpDir, ".opencode", "skills");
assert.ok(existsSync(join(skillsDir, "test-skill", "SKILL.md")));
```

---

## Coding Standards

### JavaScript
- **Format**: Standard JavaScript with JSDoc comments for function signatures
- **Modules**: ESM (`import`/`export`) — all plugins are `"type": "module"`
- **Error handling**: Every hook handler wrapped in try/catch
- **State management**: `Map<sessionID, State>` for per-session tracking
- **Async**: Use `async/await` throughout

### Dependencies
- Keep dependencies minimal — prefer Node.js built-ins
- `@opencode-ai/plugin` for tool registration utilities
- `better-sqlite3` for SQLite access (when needed)
- No framework-level dependencies

### Documentation
- Every plugin must have JSDoc for its main entry point and tools
- Plugins should list their hooks and tools in the docs index
- Follow the pattern established by existing plugins (skimmable, practical)

### Git
- **Atomic commits** — one logical change per commit
- **Conventional prefixes**: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`
- **Commit body** explains the "why", not the "what"
- No `node_modules/` or build artifacts in commits

---

## PR Process

1. Branch from `master`
2. Implement your change with tests
3. Run the full test suite
4. Commit with descriptive message
5. Open a PR describing:
   - What changed and why
   - How to test
   - Any breaking changes or considerations

---

## Project Values

1. **Lean over comprehensive** — Each plugin should do one thing well
2. **Day-one testable** — No feature is complete without a test
3. **Fail gracefully** — Plugins never break the agent
4. **Composable** — Plugins work independently and together
5. **Self-documenting** — Code structure and comments explain intent
