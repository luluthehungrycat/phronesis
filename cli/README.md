# Phronesis CLI

CLI and runtime for managing OpenCode profiles, gateways, plugins, and sessions.

## Install

```bash
npm install -g phronesis
```

Or via the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/luluthehungrycat/phronesis/master/install.sh | bash
```

## Quick Start

```bash
# Interactive session (wraps opencode)
phronesis

# First-run setup wizard (legacy profile/gateway setup)
phronesis setup

# Initialize the isolated OpenCode runtime
phronesis init

# Check the system
phronesis doctor
```

## Commands

| Command | Description |
|---|---|
| `phronesis` | Interactive OpenCode session |
| `phronesis chat <query>` | One-shot query |
| `phronesis continue` | Continue last session |
| `phronesis fork` | Fork last session |
| `phronesis config get\|set\|path\|edit` | Configuration management |
| `phronesis profile list\|use\|create\|delete\|current\|path` | Profile management |
| `phronesis gateway status\|start\|stop\|restart\|logs\|install\|uninstall` | Gateway service management |
| `phronesis plugin search\|info\|list\|install` | Plugin registry and installation |
| `phronesis dashboard` | Launch the dashboard |
| `phronesis sessions list\|search\|rebuild` | Session search (FTS5) |
| `phronesis skills list\|install\|update\|feedback` | Skill management |
| `phronesis send telegram\|webhook\|slack\|discord` | One-shot messages |
| `phronesis create-plugin <name>` | Scaffold a new plugin |
| `phronesis migrate claw\|hermes [--dry-run]` | Migrate from OpenClaw/Hermes |
| `phronesis setup` | First-run wizard |
| `phronesis init [--mode=missing\|reset\|abort]` | Initialize isolated OpenCode config/data paths; existing managed files are never silently replaced |
| `phronesis doctor` | Diagnostics |
| `phronesis version` | Version info |
| `phronesis completion [bash\|zsh\|fish]` | Shell completions |
| `phronesis upgrade` | Check for and install CLI upgrades |

All session commands accept `--profile <name>` to target a specific profile.

## Profiles

Phronesis uses isolated profiles — each with its own config, gateways, and data:

```bash
phronesis profile create work --from default
phronesis --profile work chat "hello"
```

Profiles live at `~/.config/phronesis/profiles/<name>/`.

## Isolated OpenCode runtime

`phronesis init` prepares a separate runtime under `~/.phronesis/`. Phronesis-launched
OpenCode processes receive `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`,
`OPENCODE_TUI_CONFIG`, and an isolated `XDG_DATA_HOME`, so normal `opencode`
continues to use its own configuration and data paths.

If managed files already exist, initialization stops and asks whether to:

- initialize only missing files (`--mode=missing`);
- reset managed files to Phronesis defaults after creating a backup (`--mode=reset`);
- abort without changing anything (`--mode=abort`).

Provider configuration inheritance and automatic registration of the core Phronesis
plugins are subsequent steps; this first slice establishes the non-destructive
runtime boundary.

## License

MIT
