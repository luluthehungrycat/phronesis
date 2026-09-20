# ──────────────────────────────────────────────────────────
# Phronesis — Makefile
# ──────────────────────────────────────────────────────────

# ── Configuration ─────────────────────────────────────────
SHELL := /bin/bash
COMPOSE_DIR := servers/serve
COMPOSE_FILE := $(COMPOSE_DIR)/docker-compose.yml

# ── Targets ───────────────────────────────────────────────

.PHONY: help publish build-local build-npm up-local up-npm \
        stop down logs rebuild-local rebuild-npm

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Publish ───────────────────────────────────────────────

publish: ## Publish all 7 plugins to GitHub Packages
	node scripts/publish-plugins.mjs

publish-force: ## Publish all 7 plugins even if version exists
	FORCE_PUBLISH=1 node scripts/publish-plugins.mjs

# ── Local mode (file:// paths from source) ────────────────

build-local: ## Build container from local source plugins
	BUILD_MODE=local docker compose -f $(COMPOSE_FILE) build

up-local: ## Start container in local mode (build if needed)
	BUILD_MODE=local docker compose -f $(COMPOSE_FILE) up -d

rebuild-local: ## Force-rebuild and restart in local mode
	BUILD_MODE=local docker compose -f $(COMPOSE_FILE) build --no-cache
	BUILD_MODE=local docker compose -f $(COMPOSE_FILE) up -d

# ── npm mode (@luluthehungrycat packages from GitHub Packages) ────

build-npm: ## Build container using published npm packages
	BUILD_MODE=npm docker compose -f $(COMPOSE_FILE) build

up-npm: ## Start container in npm mode (build if needed)
	BUILD_MODE=npm docker compose -f $(COMPOSE_FILE) up -d

rebuild-npm: publish ## Publish + force-rebuild and restart in npm mode
	BUILD_MODE=npm docker compose -f $(COMPOSE_FILE) build --no-cache
	BUILD_MODE=npm docker compose -f $(COMPOSE_FILE) up -d

# ── Container lifecycle ───────────────────────────────────

stop: ## Stop the container
	BUILD_MODE=local docker compose -f $(COMPOSE_FILE) stop || true
	BUILD_MODE=npm docker compose -f $(COMPOSE_FILE) stop || true

down: ## Stop and remove the container
	BUILD_MODE=local docker compose -f $(COMPOSE_FILE) down --remove-orphans || true
	BUILD_MODE=npm docker compose -f $(COMPOSE_FILE) down --remove-orphans || true

logs: ## Tail container logs
	docker compose -f $(COMPOSE_FILE) logs -f

# ── Quick dev cycle ───────────────────────────────────────

rebuild: rebuild-local ## Alias: rebuild-local
