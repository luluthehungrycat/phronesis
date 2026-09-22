import { readFileSync, existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..");

const REGISTRY_URL =
  "https://raw.githubusercontent.com/luluthehungrycat/phronesis/master/plugins/registry.json";

/**
 * Load the plugin registry from a local file or remote URL.
 * Tries local file first, then remote fetch.
 */
async function loadRegistry() {
  // Try local file first
  const localPath = join(PROJECT_ROOT, "plugins", "registry.json");
  if (existsSync(localPath)) {
    try {
      const raw = readFileSync(localPath, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
    } catch {
      // Fall through to remote
    }
  }

  // Try remote fetch
  try {
    const response = await fetch(REGISTRY_URL);
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) return data;
    }
  } catch {
    // Fall through to error
  }

  return null;
}

/**
 * Format a table row with padded columns.
 */
function padEnd(str, len) {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, "");
  const padding = Math.max(0, len - visible.length);
  return str + " ".repeat(padding);
}

/**
 * Display the plugin list output.
 */
function displayPluginList(plugins, opts = {}) {
  if (opts.json) {
    console.log(JSON.stringify(plugins, null, 2));
    return;
  }

  if (plugins.length === 0) {
    console.log("  (no matching plugins found)");
    return;
  }

  const nameWidth = Math.max(...plugins.map((p) => p.name.length)) + 2;
  const catWidth = Math.max(...plugins.map((p) => (p.category || "").length)) + 2;

  for (const p of plugins) {
    const verified = p.verified ? "\u2713" : " ";
    const category = p.category || "other";
    console.log(
      `  ${padEnd(p.name, nameWidth)} ${padEnd(category, catWidth)} ${p.description}  [${verified}]`
    );
  }
}

export const command = "plugin <action> [query]";
export const describe = "Search, browse, and install Phronesis plugins";

export function builder(yargs) {
  return yargs
    .positional("action", {
      describe: "Action: search, info, list, install",
      choices: ["search", "info", "list", "install"],
    })
    .positional("query", {
      describe: "Search term (for 'search') or plugin name (for 'info')",
      type: "string",
    })
    .option("verified", {
      describe: "Filter to verified plugins only (for 'list')",
      type: "boolean",
    })
    .option("category", {
      describe: "Filter by category (for 'list' and 'search')",
      type: "string",
      choices: ["knowledge-management", "search", "configuration", "memory", "analytics", "automation", "development", "data-ingestion", "communication"],
    })
    .option("dir", {
      describe: "Install directory (for 'install', default: ~/.config/phronesis/plugins/<name>)",
      type: "string",
    })
    .option("json", {
      describe: "Output as JSON",
      type: "boolean",
      default: false,
    });
}

export async function handler(argv) {
  const registry = await loadRegistry();

  if (!registry) {
    console.error(
      "[phronesis] Could not load plugin registry from local file or remote."
    );
    console.error(
      `  Browse plugins manually at: ${REGISTRY_URL}`
    );
    process.exit(1);
  }

  switch (argv.action) {
    // ── list ───────────────────────────────────────────────
    case "list": {
      let plugins = registry;
      if (argv.verified) {
        plugins = plugins.filter((p) => p.verified);
      }
      if (argv.category) {
        plugins = plugins.filter((p) => p.category === argv.category);
      }
      if (argv.json) {
        console.log(JSON.stringify(plugins, null, 2));
      } else {
        console.log(`Available plugins (${plugins.length}):`);
        displayPluginList(plugins);
      }
      break;
    }

    // ── search ─────────────────────────────────────────────
    case "search": {
      if (!argv.query) {
        console.error("Usage: phronesis plugin search <query>");
        process.exit(1);
      }
      const q = argv.query.toLowerCase();
      let matches = registry.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          (p.tools || []).some((t) => t.toLowerCase().includes(q))
      );
      if (argv.category) {
        matches = matches.filter((p) => p.category === argv.category);
      }

      if (argv.json) {
        console.log(JSON.stringify(matches, null, 2));
      } else {
        if (matches.length === 0) {
          console.log(`No results for "${argv.query}".`);
        } else {
          console.log(`Results for "${argv.query}" (${matches.length}):`);
          displayPluginList(matches);
        }
      }
      break;
    }

    // ── info ───────────────────────────────────────────────
    case "info": {
      if (!argv.query) {
        console.error("Usage: phronesis plugin info <name>");
        process.exit(1);
      }
      const plugin = registry.find((p) => p.name === argv.query);

      if (!plugin) {
        console.error(`Plugin "${argv.query}" not found in registry.`);
        process.exit(1);
      }

      if (argv.json) {
        console.log(JSON.stringify(plugin, null, 2));
      } else {
        console.log(`Plugin: ${plugin.name}`);
        console.log(`  Description: ${plugin.description}`);
        console.log(`  Category:   ${plugin.category || "other"}`);
        console.log(`  Path:       ${plugin.path}`);
        console.log(`  Tools:      ${(plugin.tools || []).join(", ")}`);
        console.log(`  Version:    ${plugin.version || "—"}`);
        console.log(`  Author:     ${plugin.author || "—"}`);
        console.log(`  Verified:   ${plugin.verified ? "\u2713" : "x"}`);
        console.log(`  Repo:       ${plugin.repo}`);
      }
      break;
    }

    // ── install ────────────────────────────────────────────
    case "install": {
      if (!argv.query) {
        console.error("Usage: phronesis plugin install <name>");
        process.exit(1);
      }
      const candidate = registry.find((p) => p.name === argv.query);

      if (!candidate) {
        console.error(`Plugin "${argv.query}" not found in registry.`);
        console.error("  Use 'phronesis plugin list' to see available plugins.");
        process.exit(1);
      }

      const installDir = argv.dir || join(homedir(), ".config", "phronesis", "plugins", candidate.name);

      if (existsSync(installDir)) {
        console.error(`[phronesis] Directory already exists: ${installDir}`);
        console.error(`  Use --dir to install to a different location.`);
        process.exit(1);
      }

      console.log(`[phronesis] Installing "${candidate.name}"...`);

      // Clone the repo with sparse checkout for the plugin directory
      const tmpDir = join(homedir(), ".cache", "phronesis", ".tmp-install-" + candidate.name);
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });

      const cloneResult = spawnSync("git", [
        "clone", "--depth", "1", "--filter=blob:none", "--sparse",
        candidate.repo + ".git", tmpDir,
      ], { stdio: "pipe", encoding: "utf8", timeout: 60_000 });

      if (cloneResult.status !== 0) {
        console.error(`[phronesis] Failed to clone repository.`);
        console.error(`  ${cloneResult.stderr.trim()}`);
        process.exit(1);
      }

      // Sparse checkout the specific plugin directory
      const checkoutResult = spawnSync("git", [
        "sparse-checkout", "set", candidate.path,
      ], { cwd: tmpDir, stdio: "pipe", encoding: "utf8", timeout: 30_000 });

      if (checkoutResult.status !== 0) {
        console.error(`[phronesis] Failed to checkout plugin path "${candidate.path}".`);
        console.error(`  ${checkoutResult.stderr.trim()}`);
        rmSync(tmpDir, { recursive: true });
        process.exit(1);
      }

      // Copy the plugin directory to the install target
      const srcPath = join(tmpDir, candidate.path);
      if (!existsSync(srcPath)) {
        console.error(`[phronesis] Plugin path "${candidate.path}" not found in repository.`);
        rmSync(tmpDir, { recursive: true });
        process.exit(1);
      }

      mkdirSync(installDir, { recursive: true });
      cpSync(srcPath, installDir, { recursive: true });
      rmSync(tmpDir, { recursive: true });

      console.log(`[phronesis] Installed to: ${installDir}`);

      // npm install
      console.log(`[phronesis] Installing dependencies...`);
      const npmResult = spawnSync("npm", ["install"], {
        cwd: installDir,
        stdio: "inherit",
        encoding: "utf8",
        timeout: 120_000,
      });

      if (npmResult.status === 0) {
        console.log(`[phronesis] Dependencies installed.`);
      } else {
        console.error(`[phronesis] npm install exited with code ${npmResult.status}.`);
        console.error(`  Run "cd ${installDir} && npm install" manually.`);
      }

      console.log(`\n  Next steps:`);
      console.log(`  1. Register the plugin in your opencode.json:`);
      console.log(`     {`);
      console.log(`       "plugin": ["file://${installDir}"]`);
      console.log(`     }`);
      console.log(`  2. Reload the opencode server to pick up changes\n`);
      break;
    }
  }
}
