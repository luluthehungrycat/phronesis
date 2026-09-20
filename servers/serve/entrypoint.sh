#!/bin/bash
# ───────────────────────────────────────────────────────────
# Phronesis serve entrypoint
# Starts opencode serve with isolated data directory
# BUILD_MODE=local  → use file:// paths to /phronesis/src/*
# BUILD_MODE=npm    → use @luluthehungrycat npm packages
# ───────────────────────────────────────────────────────────
set -e

export HOME=/data
export NODE_PATH=/usr/local/lib/node_modules

CONFIG_DIR="$HOME/.config/opencode"
CONFIG_FILE="$CONFIG_DIR/opencode.json"
mkdir -p "$CONFIG_DIR"

mkdir -p /data/.local/share/opencode
mkdir -p /data/.opencode/skills

# Redirect all .opencode operations to persisted volume
ln -sfn /data/.opencode /.opencode

WORKSPACE="/workspace"

# ── Generate opencode.json if not present ──────────────────
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Generating opencode.json (BUILD_MODE=${BUILD_MODE:-local})..."

    if [ "${BUILD_MODE:-local}" = "npm" ]; then
        cat > "$CONFIG_FILE" << 'OPCODEJSON'
{
  "plugin": [
    "@luluthehungrycat/opencode-skill-creator",
    "@luluthehungrycat/opencode-session-search",
    "@luluthehungrycat/opencode-persona",
    "@luluthehungrycat/opencode-memory-consolidation",
    "@luluthehungrycat/opencode-remote-execution",
    "@luluthehungrycat/opencode-skill-lifecycle",
    "@luluthehungrycat/opencode-user-profiling",
    "oh-my-opencode-slim",
    "@tarquinen/opencode-dcp@latest"
  ]
}
OPCODEJSON
    else
        cat > "$CONFIG_FILE" << 'OPCODEJSON'
{
  "plugin": [
    "file:///phronesis/src/skill-creator",
    "file:///phronesis/src/session-search",
    "file:///phronesis/src/persona",
    "file:///phronesis/src/memory-consolidation",
    "file:///phronesis/src/remote-execution",
    "file:///phronesis/src/skill-lifecycle",
    "file:///phronesis/src/user-profiling",
    "oh-my-opencode-slim",
    "@tarquinen/opencode-dcp@latest"
  ]
}
OPCODEJSON
    fi
    echo "Wrote $CONFIG_FILE"
fi

echo "=== Phronesis serve ==="
echo "Data dir: /data"
echo "Workspace: $WORKSPACE"
echo "BUILD_MODE: ${BUILD_MODE:-local}"
echo "OpenCode version: $(opencode --version 2>&1)"

# Symlink the host workspace path since opencode records it as directory
mkdir -p "$HOME/.phronesis"
ln -sfn "$WORKSPACE" "$HOME/.phronesis/workspace"

# Link global node_modules so npm plugin names resolve
ln -sfn /usr/local/lib/node_modules "$WORKSPACE/node_modules"

cd "$WORKSPACE"

exec opencode serve \
    --port 4097 \
    --hostname 0.0.0.0 \
    --print-logs
