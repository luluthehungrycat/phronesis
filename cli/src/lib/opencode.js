import { spawnSync, spawn } from "node:child_process";
import { existsSync, accessSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { profileDir } from "./paths.js";
import { getActiveProfile, getProfileConfig, getGlobalConfig } from "./config.js";

/**
 * Common locations to check for the opencode binary, beyond PATH.
 */
const OPencode_LOCATIONS = [
  join(homedir(), ".opencode", "bin", "opencode"),
  "/usr/local/bin/opencode",
  "/opt/opencode/bin/opencode",
];

/**
 * Resolve the opencode binary path.
 * Checks PATH first, then known locations.
 * Returns "opencode" (rely on PATH) if nothing explicit found.
 */
export function resolveOpenCodeBinary({ locations = OPencode_LOCATIONS } = {}) {
  // Try explicit locations first
  for (const loc of locations) {
    try {
      accessSync(loc);
      return loc;
    } catch { /* not found */ }
  }
  // Fall back to PATH
  return "opencode";
}

/**
 * Resolve the effective profile name from CLI --profile flag or active config.
 */
export function resolveProfile(profileFlag) {
  return profileFlag || getActiveProfile();
}

/**
 * Build the environment for running opencode commands against a profile.
 *
 * Layer precedence (highest wins):
 *   1. CLI flags (opts.port / opts.url)
 *   2. Profile config (server.port / server.url)
 *   3. Profile directory env vars (OPENCODE_HOME, OPENCODE_TELEGRAM_HOME)
 *   4. process.env
 */
function resolveOpenCodeEnv(profileName, opts = {}) {
  const env = { ...process.env };

  // Profile directories
  const dir = profileDir(profileName);
  if (existsSync(dir)) {
    env.OPENCODE_HOME = dir;
    env.OPENCODE_TELEGRAM_HOME = `${dir}/gateways`;
  }

  // Server config cascade: profile overrides global
  const profileCfg = getProfileConfig(profileName);
  const globalCfg = getGlobalConfig();
  const serverCfg = profileCfg?.server || globalCfg?.server || {};

  // Resolve the target opencode server URL
  let serverUrl = serverCfg.url || "";
  if (!serverUrl && serverCfg.port) {
    serverUrl = `http://localhost:${serverCfg.port}`;
  }
  // CLI overrides
  if (opts.url) serverUrl = opts.url;
  else if (opts.port) serverUrl = `http://localhost:${opts.port}`;

  if (serverUrl) {
    env.OPENCODE_URL = serverUrl;
  }

  return env;
}

// ---------------------------------------------------------------------------
// systemctl / journalctl (local services, no server URL needed)
// ---------------------------------------------------------------------------

/**
 * Run systemctl with the given subcommand and unit, scoped to a profile.
 */
export function systemctl(subcommand, unit, opts = {}) {
  const profile = resolveProfile(opts.profile);
  const env = resolveOpenCodeEnv(profile, opts);

  const result = spawnSync("systemctl", ["--user", subcommand, unit], {
    env,
    stdio: opts.interactive ? "inherit" : "pipe",
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  return result.stdout?.trim() || "";
}

/**
 * Run journalctl with the given args, scoped to a profile.
 */
export function journalctl(args = [], opts = {}) {
  const profile = resolveProfile(opts.profile);
  const env = resolveOpenCodeEnv(profile, opts);

  const result = spawnSync("journalctl", ["--user", ...args], {
    env,
    stdio: opts.interactive ? "inherit" : "pipe",
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  return result.stdout?.trim() || "";
}

// ---------------------------------------------------------------------------
// opencode CLI wrapper
// ---------------------------------------------------------------------------

/**
 * Run opencode with the given arguments, scoped to a profile + server.
 * @returns {string | Promise<string>} — string for non-interactive, Promise for interactive
 */
export function opencode(args, opts = {}) {
  const profile = resolveProfile(opts.profile);
  const env = resolveOpenCodeEnv(profile, opts);
  const bin = resolveOpenCodeBinary();

  // Interactive mode — spawn with TTY inherited
  if (opts.interactive || opts.stdio === "inherit") {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { env, stdio: "inherit" });
      child.on("close", (code) => {
        if (code === 0) resolve("");
        else reject(new Error(`opencode exited with code ${code}`));
      });
      child.on("error", reject);
    });
  }

  // Non-interactive mode — spawnSync (no shell, no injection)
  const result = spawnSync(bin, args, {
    env,
    encoding: "utf8",
    stdio: "pipe",
    timeout: opts.timeout || 120_000,
  });

  if (result.error) {
    if (opts.silent) return "";
    throw result.error;
  }

  if (result.status !== 0) {
    if (opts.silent) return "";
    throw new Error(
      `opencode exited with code ${result.status}: ${result.stderr?.trim() || result.stdout?.trim() || ""}`
    );
  }

  return result.stdout?.trim() || "";
}

/**
 * Run an opencode tool (plugin tool) via `opencode run /<tool> <args>`.
 */
export function opencodeRun(tool, toolArgs = [], opts = {}) {
  const args = ["run", `/${tool}`, ...toolArgs.map(String)];
  return opencode(args, opts);
}

/**
 * Check if the opencode binary is available.
 */
export function opencodeAvailable({ binary } = {}) {
  const bin = binary || resolveOpenCodeBinary();
  const result = spawnSync(bin, ["--version"], {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 5000,
  });
  return result.status === 0;
}
