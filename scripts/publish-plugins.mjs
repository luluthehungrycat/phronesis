#!/usr/bin/env node
// ───────────────────────────────────────────────────────────
// Publish all Phronesis plugins to npmjs.org
// ───────────────────────────────────────────────────────────
// Prerequisites:
//   npm login  (one-time, authenticates you to npmjs.org)
// Usage:
//   node scripts/publish-plugins.mjs
// ───────────────────────────────────────────────────────────

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PLUGINS = [
  "skill-creator",
  "session-search",
  "persona",
  "memory-consolidation",
  "remote-execution",
  "skill-lifecycle",
  "user-profiling",
];

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

function run(cmd, opts = {}) {
  log("run", cmd);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function isAlreadyPublished(packageName, version) {
  try {
    const view = execSync(`npm view ${packageName} version 2>/dev/null`, {
      stdio: "pipe",
      encoding: "utf8",
    }).toString().trim();
    return view === version;
  } catch {
    return false;
  }
}

function publishPlugin(pluginDir) {
  const pkgPath = resolve(pluginDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  log("publish", `Publishing ${pkg.name} v${pkg.version}...`);

  if (isAlreadyPublished(pkg.name, pkg.version)) {
    log("skip", `${pkg.name}@${pkg.version} already published`);
    return false;
  }

  try {
    run(`npm publish --access public`, { cwd: pluginDir });
    log("done", `Published ${pkg.name}@${pkg.version}`);
    return true;
  } catch (err) {
    console.error(`Failed to publish ${pkg.name}: ${err.message}`);
    process.exit(1);
  }
}

async function main() {
  console.log("═".repeat(50));
  console.log("  Phronesis Plugin Publisher → npmjs.org");
  console.log("═".repeat(50));
  console.log("");

  // Quick check: is npm logged in?
  try {
    execSync("npm whoami", { stdio: "pipe", encoding: "utf8" });
  } catch {
    console.error("ERROR: Not logged in to npm. Run 'npm login' first.");
    process.exit(1);
  }

  let published = 0;
  let skipped = 0;

  for (const name of PLUGINS) {
    const pluginDir = resolve(ROOT, "src", name);
    if (!existsSync(resolve(pluginDir, "package.json"))) {
      log("skip", `${name}: no package.json found`);
      continue;
    }

    const didPublish = publishPlugin(pluginDir);
    if (didPublish) published++;
    else skipped++;
  }

  console.log("");
  console.log("─".repeat(50));
  console.log(`  Published: ${published}   Skipped: ${skipped}`);
  console.log("─".repeat(50));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
