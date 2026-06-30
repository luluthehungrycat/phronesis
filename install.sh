#!/usr/bin/env bash
# Phronesis Installer
#
# Usage: curl -fsSL https://raw.githubusercontent.com/luluthehermeticcrabBot/phronesis/main/install.sh | bash
#
# Requires: Node.js >= 18, npm, and git (optional: opencode)

set -euo pipefail

# ---- Colors ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { printf "${BLUE}%s${NC}\n" "$*"; }
ok()    { printf "${GREEN}✓ %s${NC}\n" "$*"; }
warn()  { printf "${YELLOW}⚠ %s${NC}\n" "$*"; }
err()   { printf "${RED}✗ %s${NC}\n" "$*"; }

# ---- Prerequisites ----
info "Checking prerequisites..."

# Node.js >= 18
if ! command -v node &>/dev/null; then
  err "Node.js not found. Please install Node.js >= 18 from https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js >= 18 required, found v$(node -v). Please upgrade."
  exit 1
fi
ok "Node.js $(node -v)"

# npm
if ! command -v npm &>/dev/null; then
  err "npm not found. Please install npm."
  exit 1
fi
ok "npm $(npm -v)"

# opencode (optional — warn if missing)
if command -v opencode &>/dev/null; then
  ok "opencode $(opencode --version 2>/dev/null || echo 'found')"
else
  warn "opencode not found. Install it from https://github.com/luluthehermeticcrabBot/opencode"
fi

# ---- Install Phronesis CLI ----
info ""
info "Installing phronesis CLI..."

npm install -g phronesis 2>&1 || {
  err "npm install failed. Trying alternate method..."
  TMP_DIR=$(mktemp -d)
  git clone https://github.com/luluthehermeticcrabBot/phronesis.git "$TMP_DIR"
  cd "$TMP_DIR/cli"
  npm install -g . 2>&1 || {
    err "Installation failed."
    exit 1
  }
  rm -rf "$TMP_DIR"
}

ok "phronesis installed"

# ---- First-run setup ----
info ""
info "Running first-time setup..."
phronesis setup 2>&1 || warn "Setup wizard skipped (run 'phronesis setup' manually)"

# ---- Done ----
info ""
info "=========================================="
info "  Phronesis installed successfully!"
info "=========================================="
info ""
info "  Quick start:"
info "    phronesis              # Interactive session"
info "    phronesis doctor       # System check"
info "    phronesis --help       # All commands"
info ""
info "  Docs:  https://github.com/luluthehermeticcrabBot/phronesis"
info ""
