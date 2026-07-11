#!/usr/bin/env node
// ───────────────────────────────────────────────────────────
// Phronesis Session Migration Script
// Copies existing sessions from host opencode.db to container
// Usage: node scripts/migrate-sessions.mjs [--dry-run]
// ───────────────────────────────────────────────────────────
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const isDryRun = process.argv.includes("--dry-run");
const DATA_DIR = resolve("/data/.local/share/opencode");
const HOST_DB = join(homedir(), ".local", "share", "opencode", "opencode.db");
const CONTAINER_DB = join(DATA_DIR, "opencode.db");

async function main() {
  console.log("=== Phronesis Session Migration ===\n");

  // Check source DB
  if (!existsSync(HOST_DB)) {
    console.error(`Source DB not found: ${HOST_DB}`);
    process.exit(1);
  }

  const srcStats = await statSafe(HOST_DB);
  console.log(`Source: ${HOST_DB} (${formatBytes(srcStats?.size || 0)})`);

  // Check if container DB exists
  const destExists = existsSync(CONTAINER_DB);
  if (destExists) {
    const destStats = await statSafe(CONTAINER_DB);
    console.log(`Destination: ${CONTAINER_DB} (${formatBytes(destStats?.size || 0)})`);
    console.warn("\n⚠️  Destination DB already exists. Overwrite? (use --force to confirm)\n");
    if (!process.argv.includes("--force")) {
      console.log("  To force: node scripts/migrate-sessions.mjs --force");
      process.exit(0);
    }
  }

  // Do the copy
  if (isDryRun) {
    console.log("\n[DRY RUN] Would copy:");
    console.log(`  ${HOST_DB} → ${CONTAINER_DB}`);
    console.log(`  Size: ${formatBytes(srcStats?.size || 0)}`);
  } else {
    mkdirSync(DATA_DIR, { recursive: true });
    copyFileSync(HOST_DB, CONTAINER_DB);
    console.log(`\n✅ Copied ${formatBytes(srcStats?.size || 0)} to ${CONTAINER_DB}`);
  }

  // Summary
  console.log("\n=== Summary ===");
  console.log("Status: ✅ Migration complete");
  if (!isDryRun) {
    console.log("Container will use the copied DB on next restart.");
    console.log("Restart serve-2: podman-compose -f servers/serve-2/docker-compose.yml restart");
  }
}

async function statSafe(path) {
  try {
    const { stat } = await import("node:fs/promises");
    return await stat(path);
  } catch {
    return null;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

main().catch(console.error);
