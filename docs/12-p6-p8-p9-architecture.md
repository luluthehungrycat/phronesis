# P6, P8, P9 — Architecture Overview

## P6: Remote Execution Plugin (`src/remote-execution/`)

**Purpose**: Unified `run-on <target> <command>` interface for executing commands on local, Docker/Podman containers, or SSH hosts.

**Tools**:
- `run-on` — Execute command on a named target target, command, [timeout]
- `list-targets` — Show all configured targets

**Config**: Targets defined in pluginConfig (opencode.json):
```json
{
  "targets": [
    {"label": "local", "type": "local"},
    {"label": "serve", "type": "container", "address": "phronesis-serve", "runtime": "podman"},
    {"label": "server", "type": "ssh", "address": "user@host"}
  ]
}
```

**Execution**: Uses `child_process.execSync` — `docker/podman exec` for containers, `ssh` for remote hosts, direct shell for local.

---

## P8: Skill Lifecycle Plugin (`src/skill-lifecycle/`)

**Purpose**: Production-grade skill management — versioning, usage metrics, auto-patching, deprecation, pruning. Reads/writes alongside skill-creator's `.opencode/skills/` structure.

**File extensions per skill**:
- `.meta.json` — version, deprecation status, created/updated dates
- `.usage.json` — invocation log { timestamp, success, duration }
- `.versions/` — archived SKILL.md snapshots at update time

**Tools**:
- `skill-stats` — Usage/effectiveness metrics for all skills (total invocations, success rate, avg duration, rating)
- `skill-versions` — List archived versions of a skill
- `skill-verify` — Walk through skill steps in dry-run check mode
- `skill-deprecate` — Mark/reinstate a skill as deprecated
- `skill-prune` — Remove deprecated skills older than N days

**Hooks**:
- `experimental.chat.system.transform`: Inject deprecation warnings, suggest best skills by success rate, flag unused skills
- `config`: Ensure lifecycle permission

**Auto-improvement**: When a skill has 5+ ratings and avg > 4.0, flag as "trusted." When correction pattern detected consistently (same deviation in 2+ sessions), suggest update.

---

## P9: User Profiling Plugin (`src/user-profiling/`)

**Purpose**: Build longitudinal user models from session data — communication style, common tasks, preferences, decision patterns.

**Backend**: Uses memory-consolidation's SQLite DB (`phronesis_memory.db`) facts and observations as the profile store.

**Tools**:
- `profile-summary` — Current user profile (verbosity, formality, common tasks, preferred tools/frameworks)
- `profile-preference` — Explicitly record a user preference (key, value, category)
- `profile-insights` — Generate insights from recent session history

**Hooks**:
- `experimental.chat.system.transform`: Inject relevant profile traits into system prompt
- `experimental.chat.messages.transform`: Adjust response style based on detected preference (e.g., be concise if user favors it)
- `tool.execute.after`: Track communication patterns per session (message length, technical terms, task types)

**Profile fields**: verbosity (concise/detailed), formality (formal/casual), technical_depth (low/medium/high), preferred_tools, common_task_types, preferred_frameworks, communication_style notes
