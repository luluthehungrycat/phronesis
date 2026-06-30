#!/bin/bash
# ───────────────────────────────────────────────────────────
# Phronesis serve-2 entrypoint
# Starts opencode serve with isolated data directory
# ───────────────────────────────────────────────────────────
set -e

export HOME=/data
export NODE_PATH=/usr/local/lib/node_modules

mkdir -p /data/.local/share/opencode
mkdir -p /data/.opencode/skills

# Redirect all .opencode operations (skills, agents, etc.) to persisted volume
# save-skill etc. resolve worktree to "/" (root) and write to /.opencode/skills/
ln -sfn /data/.opencode /.opencode

WORKSPACE="/workspace"

if [ ! -f "$WORKSPACE/opencode.json" ]; then
    echo "ERROR: /workspace/opencode.json not found."
    exit 1
fi

echo "=== Phronesis serve-2 ==="
echo "Data dir: /data"
echo "Workspace: $WORKSPACE"
echo "OpenCode version: $(opencode --version 2>&1)"

HOST_REPOS="/host-repos"
#mkdir -p $HOME/agent/repos

# Symlink phronesis from the image
#ln -sfn /phronesis $HOME/agent/repos/phronesis

# Symlink host repos from the mount (if mounted)
#if [ -d "$HOST_REPOS" ]; then
#    for repo in "$HOST_REPOS"/*/; do
#        repo_name="$(basename "$repo")"
#        # Don't override phronesis (we use the image version)
#        if [ "$repo_name" != "phronesis" ]; then
#            ln -sfn "$repo" "$HOME/agent/repos/$repo_name"
#        fi
#    done
#fi

# Symlink the host workspace path since opencode records it as directory
mkdir -p "$HOME"
ln -sfn "$WORKSPACE" $HOME/.phronesis/workspace

cd "$WORKSPACE"

exec opencode serve \
    --port 4097 \
    --hostname 0.0.0.0 \
    --print-logs
