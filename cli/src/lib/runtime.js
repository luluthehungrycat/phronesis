import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_RUNTIME_ROOT = join(homedir(), ".phronesis");

const DEFAULT_FILES = new Map([
  ["config/opencode.jsonc", `// Phronesis runtime configuration.\n// Add or remove plugins in this isolated configuration.\n{\n  "$schema": "https://opencode.ai/config.json",\n  "plugin": []\n}\n`],
  ["config/tui.jsonc", `// Phronesis TUI settings.\n{}\n`],
  ["profiles/default.json", `// Phronesis profile metadata.\n{\n  "name": "default"\n}\n`],
]);

function ensureDirectories(root) {
  for (const relative of ["config", "data", "profiles", "state"]) {
    mkdirSync(join(root, relative), { recursive: true });
  }
}

function existingManagedFiles(root) {
  return [...DEFAULT_FILES.keys()].filter((relative) => existsSync(join(root, relative)));
}

/**
 * Initialize an isolated Phronesis runtime without silently replacing files.
 *
 * mode:
 * - abort: refuse when any managed file already exists
 * - missing: create only missing managed files
 * - reset: back up managed files, then restore defaults
 */
export function initializeRuntime({ root = DEFAULT_RUNTIME_ROOT, mode = "abort" } = {}) {
  if (!["abort", "missing", "reset"].includes(mode)) {
    throw new Error(`Unknown initialization mode: ${mode}`);
  }

  const existing = existingManagedFiles(root);
  if (existing.length > 0 && mode === "abort") {
    return { status: "aborted", root, existing };
  }

  ensureDirectories(root);
  let backupDir;
  if (existing.length > 0 && mode === "reset") {
    backupDir = join(root, "backups", new Date().toISOString().replace(/[:.]/g, "-"));
    mkdirSync(backupDir, { recursive: true });
    for (const relative of existing) {
      const destination = join(backupDir, relative);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(root, relative), destination);
    }
  }

  const created = [];
  for (const [relative, content] of DEFAULT_FILES) {
    const target = join(root, relative);
    if (mode === "reset" || !existsSync(target)) {
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, content, "utf8");
      created.push(relative);
    }
  }

  const status = existing.length === 0 ? "created" : mode === "reset" ? "reset" : "updated";
  return { status, root, existing, created, backupDir };
}

export function runtimeEnvironment(root = DEFAULT_RUNTIME_ROOT, baseEnv = process.env) {
  return {
    ...baseEnv,
    OPENCODE_CONFIG: join(root, "config", "opencode.jsonc"),
    OPENCODE_CONFIG_DIR: join(root, "config"),
    OPENCODE_TUI_CONFIG: join(root, "config", "tui.jsonc"),
    XDG_DATA_HOME: join(root, "data"),
  };
}

export function listRuntimeFiles(root = DEFAULT_RUNTIME_ROOT) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true }).filter((entry) => typeof entry === "string");
}
