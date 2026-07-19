import { writeFileSync, chmodSync, existsSync, unlinkSync } from "node:fs";
import {
  getActiveProfile,
  setActiveProfile,
  getProfileConfig,
  writeProfileConfig,
  listProfiles,
  getGlobalConfig,
} from "../lib/config.js";
import {
  ensureProfileDir,
  profileDir,
  profileScriptPath,
  LOCAL_BIN,
} from "../lib/paths.js";

const PROFILE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function isValidProfileName(name) {
  return typeof name === "string" && PROFILE_NAME_RE.test(name);
}

/**
 * Create a profile shorthand script at ~/.local/bin/<name>.
 * This proxies all arguments to `phronesis --profile <name>`.
 */
function createProfileScript(name) {
  const scriptPath = profileScriptPath(name);
  const content = `#!/usr/bin/env bash
# Phronesis profile shorthand for "${name}"
exec phronesis "$@" --profile "${name}"
`;

  try {
    writeFileSync(scriptPath, content, "utf8");
    chmodSync(scriptPath, 0o755);
    return scriptPath;
  } catch (err) {
    console.warn(`[phronesis] warning: could not create shorthand script: ${err.message}`);
    return null;
  }
}

/**
 * Remove a profile shorthand script.
 */
function removeProfileScript(name) {
  const scriptPath = profileScriptPath(name);
  if (existsSync(scriptPath)) {
    try {
      unlinkSync(scriptPath);
    } catch {
      // ignore
    }
  }
}

export const command = "profile <action> [name]";
export const describe = "Manage Phronesis profiles";

export function builder(yargs) {
  return yargs
    .positional("action", {
      describe: "Action: list, current, use, create, delete, path",
      choices: ["list", "current", "use", "create", "delete", "path"],
    })
    .positional("name", {
      describe: "Profile name",
      type: "string",
    })
    .option("from", {
      describe: "Clone config from an existing profile (for 'create')",
      type: "string",
    })
    .option("json", {
      describe: "Output as JSON",
      type: "boolean",
      default: false,
    });
}

export function handler(argv) {
  if (argv.name && !isValidProfileName(argv.name)) {
    console.error(`Invalid profile name "${argv.name}". Use only alphanumeric, hyphens, and underscores (1-64 chars).`);
    process.exit(1);
  }

  switch (argv.action) {
    case "list": {
      const profiles = listProfiles();
      const active = getActiveProfile();

      if (argv.json) {
        console.log(JSON.stringify({ profiles, active }));
        return;
      }

      if (profiles.length === 0) {
        console.log("No profiles found. Use 'phronesis profile create <name>'");
        return;
      }

      console.log("Profiles:");
      for (const p of profiles) {
        const marker = p === active ? " *" : "  ";
        console.log(`${marker} ${p}`);
      }
      break;
    }

    case "current": {
      const active = getActiveProfile();
      if (argv.json) {
        console.log(JSON.stringify({ profile: active }));
        return;
      }
      console.log(active);
      break;
    }

    case "use": {
      if (!argv.name) {
        console.error("Usage: phronesis profile use <name>");
        process.exit(1);
      }

      const profiles = listProfiles();
      if (!profiles.includes(argv.name)) {
        console.error(`Profile "${argv.name}" not found. Create it first.`);
        process.exit(1);
      }

      setActiveProfile(argv.name);
      console.log(`Switched to profile "${argv.name}"`);

      // Source-able output for shell rc
      const dir = profileDir(argv.name);
      console.log(`\nTo persist in your current shell, add to ~/.bashrc:`);
      console.log(`  export OPENCODE_HOME="${dir}"`);
      console.log(`  export OPENCODE_TELEGRAM_HOME="${dir}/gateways"`);
      break;
    }

    case "create": {
      if (!argv.name) {
        console.error("Usage: phronesis profile create <name> [--from <name>]");
        process.exit(1);
      }

      const profiles = listProfiles();
      if (profiles.includes(argv.name)) {
        console.error(`Profile "${argv.name}" already exists.`);
        process.exit(1);
      }

      // Create directory structure
      ensureProfileDir(argv.name);

      // Bootstrap config
      let config = {
        name: argv.name,
        description: "",
        created: new Date().toISOString().slice(0, 10),
        gateways: {},
        plugins: {},
      };

      // Optionally clone from another profile
      if (argv.from) {
        if (!isValidProfileName(argv.from)) {
          console.error(`Invalid source profile name "${argv.from}".`);
          process.exit(1);
        }
        if (!profiles.includes(argv.from)) {
          console.error(`Source profile "${argv.from}" not found.`);
          process.exit(1);
        }
        const sourceConfig = getProfileConfig(argv.from);
        config = {
          ...sourceConfig,
          name: argv.name,
          created: new Date().toISOString().slice(0, 10),
        };
      }

      writeProfileConfig(argv.name, config);

      // Create shorthand script
      const scriptPath = createProfileScript(argv.name);

      console.log(`Created profile "${argv.name}"`);

      if (scriptPath) {
        console.log(`Shorthand script: ${scriptPath}`);
        console.log(`(ensure ${LOCAL_BIN} is in your PATH to use "${argv.name}" as a command)`);
      }

      break;
    }

    case "delete": {
      if (!argv.name) {
        console.error("Usage: phronesis profile delete <name>");
        process.exit(1);
      }

      if (argv.name === "default") {
        console.error("Cannot delete the 'default' profile.");
        process.exit(1);
      }

      const profiles = listProfiles();
      if (!profiles.includes(argv.name)) {
        console.error(`Profile "${argv.name}" not found.`);
        process.exit(1);
      }

      // Prevent deleting active profile
      if (argv.name === getActiveProfile()) {
        console.error(`Cannot delete the active profile. Switch to another profile first.`);
        process.exit(1);
      }

      // Remove shorthand script
      removeProfileScript(argv.name);

      // Note: we don't remove the directory — user may want to recover data
      console.log(`Profile "${argv.name}" deregistered.`);
      console.log(`Config directory kept at: ${profileDir(argv.name)}`);
      console.log(`Use 'rm -rf <dir>' to remove entirely.`);
      break;
    }

    case "path": {
      const name = argv.name || getActiveProfile();
      const dir = profileDir(name);
      console.log(dir);
      break;
    }

    default:
      console.error("Unknown action. Use: list, current, use, create, delete, path");
      process.exit(1);
  }
}
