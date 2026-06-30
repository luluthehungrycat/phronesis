# ───────────────────────────────────────────────────────────
# Phronesis — Containerized OpenCode server with plugins
#
# Base: ghcr.io/anomalyco/opencode (Alpine Linux + opencode binary)
# Build:  podman build -t phronesis:latest .
# Run:    podman run --rm -p 4097:4097 -v phronesis-data:/data phronesis:latest
# ───────────────────────────────────────────────────────────
FROM ghcr.io/anomalyco/opencode:latest

# ── Install runtime dependencies ──────────────────────────
# bash        — for entrypoint script
# nodejs npm  — for Phronesis plugin runtime (opencode plugins load via Node.js)
# git curl jq — utilities used by plugins
# sqlite      — for session-search plugin and diagnostics (package: sqlite on Alpine)
# python3 make g++ — build tools for native Node modules (better-sqlite3)
RUN apk add --no-cache \
    bash \
    nodejs \
    npm \
    git \
    gh \
    curl \
    jq \
    sqlite \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# ── Install Phronesis CLI globally ───────────────────────
# Install deps first, then the package itself, so changes to JS source don't
# trigger a full npm rebuild.
COPY cli/package.json cli/package-lock.json* /phronesis/cli/
RUN cd /phronesis/cli && npm install 2>&1 | tail -5

COPY cli/ /phronesis/cli/
RUN cd /phronesis/cli && npm install -g . 2>&1 | tail -5

# ── Copy plugin sources ──────────────────────────────────
# Separate shared/ from the rest since shared has no package.json
COPY src/shared/ /phronesis/src/shared/

# Copy the directories that contain package.json
COPY src/skill-creator/     /phronesis/src/skill-creator/
COPY src/session-search/    /phronesis/src/session-search/
COPY src/persona/           /phronesis/src/persona/
COPY src/memory-consolidation/ /phronesis/src/memory-consolidation/
COPY src/remote-execution/  /phronesis/src/remote-execution/
COPY src/skill-lifecycle/   /phronesis/src/skill-lifecycle/
COPY src/user-profiling/    /phronesis/src/user-profiling/

# ── Install plugin dependencies ──────────────────────────
# Each plugin has its own package.json. Native modules (better-sqlite3 in
# memory-consolidation) are compiled on the target architecture here.
RUN for dir in                                        \
    /phronesis/src/skill-creator                      \
    /phronesis/src/session-search                     \
    /phronesis/src/persona                            \
    /phronesis/src/memory-consolidation                \
    /phronesis/src/remote-execution                   \
    /phronesis/src/skill-lifecycle                    \
    /phronesis/src/user-profiling;                    \
do                                                     \
    if [ -f "$dir/package.json" ]; then                \
        echo "  → $dir" &&                             \
        cd "$dir" && npm install 2>&1 | tail -3;       \
    fi;                                                 \
done

# Rebuild native modules for the target platform (better-sqlite3)
RUN cd /phronesis/src/memory-consolidation \
    && npm rebuild better-sqlite3 2>&1 | tail -5

# ── Entrypoint ──────────────────────────────────────────
COPY servers/serve-2/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Persist session data, plugin databases, and skills across restarts
VOLUME ["/data"]

# OpenCode server port
EXPOSE 4097

HEALTHCHECK CMD curl --fail http://localhost:4097/ || exit 1

# Override base image entrypoint (which is "opencode") with our startup script
ENTRYPOINT ["/entrypoint.sh"]
