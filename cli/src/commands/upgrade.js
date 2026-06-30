import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PKG_OWNER = "luluthehungrycat";
const PKG_REPO = "phronesis";
const GITHUB_API = `https://api.github.com/repos/${PKG_OWNER}/${PKG_REPO}/releases/latest`;
const NPM_REGISTRY = "https://registry.npmjs.org/phronesis/latest";

/** Resolve path to the CLI package.json (two levels up from src/commands/). */
function resolvePackageJson() {
  return join(__dirname, "..", "..", "package.json");
}

/** Strip leading "v" from a semver string. */
function stripV(s) {
  return s != null ? s.replace(/^v/i, "") : s;
}

export const command = "upgrade";
export const describe = "Check for and install phronesis upgrades";

export function builder(yargs) {
  return yargs
    .option("dry-run", {
      type: "boolean",
      describe: "Check only, don't install",
      default: false,
    })
    .option("json", {
      type: "boolean",
      describe: "Output as JSON",
      default: false,
    })
    .option("source", {
      type: "string",
      describe: "Version source: github (default) or npm",
      default: "github",
      choices: ["github", "npm"],
    });
}

export async function handler(argv) {
  try {
    // Read current version from package.json
    let currentVersion;
    try {
      const pkg = JSON.parse(readFileSync(resolvePackageJson(), "utf8"));
      currentVersion = pkg.version;
    } catch {
      if (argv.json) {
        console.log(JSON.stringify({ error: "Could not read package.json" }));
      } else {
        console.error("[phronesis] Could not determine current version.");
      }
      process.exit(1);
    }

    // Fetch latest version from chosen source
    let latestVersion;
    const sourceErrors = [];

    if (argv.source === "github") {
      try {
        const response = await fetch(GITHUB_API, {
          headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "phronesis-cli" },
        });
        if (!response.ok) {
          throw new Error(`GitHub API returned HTTP ${response.status}`);
        }
        const data = await response.json();
        latestVersion = stripV(data.tag_name);
      } catch (fetchErr) {
        sourceErrors.push(`GitHub: ${fetchErr.message}`);
      }
    }

    // Fall back to npm registry if GitHub failed or was requested directly
    if (!latestVersion) {
      try {
        const response = await fetch(NPM_REGISTRY);
        if (!response.ok) {
          throw new Error(`npm registry returned HTTP ${response.status}`);
        }
        const data = await response.json();
        latestVersion = data.version;
      } catch (npmErr) {
        sourceErrors.push(`npm: ${npmErr.message}`);
      }
    }

    if (!latestVersion) {
      if (argv.json) {
        console.log(
          JSON.stringify({
            error: `Failed to check for updates: ${sourceErrors.join("; ")}`,
            current: currentVersion,
          })
        );
      } else {
        console.error("[phronesis] Failed to check for updates.");
        for (const err of sourceErrors) {
          console.error(`  ${err}`);
        }
        console.error("[phronesis] Check your internet connection.");
      }
      process.exit(1);
    }

    // Normalise versions (strip leading "v") for comparison
    const currentNorm = stripV(currentVersion);
    const latestNorm = stripV(latestVersion);

    if (currentNorm === latestNorm) {
      // Up to date (strings may differ only by v-prefix)
      if (argv.json) {
        console.log(JSON.stringify({ current: currentVersion, latest: latestVersion, outdated: false, source: argv.source }));
      } else {
        console.log(`[phronesis] Already up to date (v${currentVersion})`);
      }
      return;
    }

    // Outdated
    if (argv.json) {
      console.log(JSON.stringify({ current: currentVersion, latest: latestVersion, outdated: true, source: argv.source }));
      return;
    }

    console.log(`[phronesis] Update available: v${currentVersion} → v${latestVersion}`);

    if (argv.dryRun) {
      console.log(`[phronesis] Run 'npm install -g phronesis' to upgrade.`);
      console.log(`[phronesis] Or download from: https://github.com/${PKG_OWNER}/${PKG_REPO}/releases/tag/v${latestVersion}`);
      return;
    }

    // Perform upgrade via npm
    try {
      console.log(`[phronesis] Installing v${latestVersion}...`);
      execSync("npm install -g phronesis", {
        stdio: "inherit",
        encoding: "utf8",
        timeout: 120_000,
      });
      console.log(`[phronesis] Upgraded to v${latestVersion}`);
    } catch (installErr) {
      const msg = installErr.message || "";
      if (msg.includes("EACCES")) {
        console.error("[phronesis] Permission denied. Try: sudo npm install -g phronesis");
      } else if (msg.includes("ENOENT")) {
        console.error("[phronesis] npm not found. Is Node.js installed?");
      } else if (msg.includes("404") || msg.includes("E404")) {
        console.error("[phronesis] Package not found on npm. Use --source=github to check GitHub releases.");
        console.error(`[phronesis] Download: https://github.com/${PKG_OWNER}/${PKG_REPO}/releases/tag/v${latestVersion}`);
      } else {
        console.error(`[phronesis] Install failed: ${installErr.message}`);
        console.error(`[phronesis] Alternative: https://github.com/${PKG_OWNER}/${PKG_REPO}/releases/tag/v${latestVersion}`);
      }
      process.exit(1);
    }
  } catch (err) {
    console.error(`[phronesis] Upgrade error: ${err.message}`);
    process.exit(1);
  }
}
