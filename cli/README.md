# Phronesis CLI

CLI and runtime for managing OpenCode profiles, gateways, plugins, and sessions.

## Install

```bash
npm install -g phronesis
```

Or via the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/luluthehermeticcrabBot/phronesis/main/install.sh | bash
```

## Quick Start

```bash
# Interactive session (wraps opencode)
phronesis

# First-run setup wizard
phronesis setup

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
| `phronesis sessions list\|search\|rebuild` | Session search (FTS5) |
| `phronesis skills list\|install\|update\|feedback` | Skill management |
| `phronesis send telegram\|webhook\|slack\|discord` | One-shot messages |
| `phronesis create-plugin <name>` | Scaffold a new plugin |
| `phronesis migrate claw\|hermes [--dry-run]` | Migrate from OpenClaw/Hermes |
| `phronesis setup` | First-run wizard |
| `phronesis doctor` | Diagnostics |
| `phronesis version` | Version info |
| `phronesis completion [bash\|zsh\|fish]` | Shell completions |

All session commands accept `--profile <name>` to target a specific profile.

## Profiles

Phronesis uses isolated profiles — each with its own config, gateways, and data:

```bash
phronesis profile create work --from default
phronesis --profile work chat "hello"
```

Profiles live at `~/.config/phronesis/profiles/<name>/`.

## License

MIT
