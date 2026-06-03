# ───────────────────────────────────────────────────────
# Phronesis Plugin Test Container
# Build:  podman build -t phronesis-test -f tests/container/Dockerfile .
# Run:    podman run --rm phronesis-test
# ───────────────────────────────────────────────────────
FROM docker.io/node:22-bookworm-slim AS build

# Build tools for compiling native modules (better-sqlite3, etc.)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    curl \
    jq \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCode CLI (prebuilt binary from GitHub releases)
RUN OPENCODE_VERSION=$(curl -sL https://api.github.com/repos/anomalyco/opencode/releases/latest | \
    grep '"tag_name"' | sed 's/.*"v\([^"]*\)".*/\1/') && \
    echo "OpenCode version: $OPENCODE_VERSION" && \
    curl -fsSL "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-x64.tar.gz" \
    -o /tmp/opencode.tar.gz && \
    tar xzf /tmp/opencode.tar.gz -C /usr/local/bin/ opencode && \
    rm /tmp/opencode.tar.gz && \
    opencode --version

WORKDIR /test

# Copy project sources & config
COPY . .
COPY .dockerignore .dockerignore

# Install plugin dependencies (native compilation happens here)
RUN cd src/skill-creator && npm install 2>&1 | tail -5 && cd ../..
RUN cd src/session-search && npm install 2>&1 | tail -5 && cd ../..
RUN cd src/persona && npm install 2>&1 | tail -5 && cd ../..

# Prepare default skills directory
RUN mkdir -p .opencode/skills /test-data

# ---- Stage 2: Runtime ----
FROM docker.io/node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    curl \
    jq \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Copy OpenCode binary from build stage
COPY --from=build /usr/local/bin/opencode /usr/local/bin/opencode

# Copy project
COPY --from=build /test /test

# Keep project structure intact so relative paths in test.mjs resolve
RUN mkdir -p /test/tests/container
COPY tests/container/test.mjs /test/tests/container/test.mjs
COPY tests/container/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /test
ENTRYPOINT ["/entrypoint.sh"]
