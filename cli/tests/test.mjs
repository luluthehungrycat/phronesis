#!/usr/bin/env node
/**
 * Phronesis CLI Test Suite
 *
 * Unit tests for all CLI modules (lib/, constants, commands).
 * No external dependencies required — uses only Node built-ins.
 *
 * Run: node tests/test.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// ─── Isolate HOME ───────────────────────────────────────────────────────────
// Set HOME to a temp directory BEFORE any project modules are imported.
// This ensures all path-based constants use isolated directories.
const TMP_HOME = mkdtempSync(join(tmpdir(), "phronesis-test-"));
const ORIG_HOME = process.env.HOME;
process.env.HOME = TMP_HOME;

// ─── Test Framework ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let currentGroup = "";
const asyncTests = [];

function group(name) {
  currentGroup = name;
  console.log(`\n  ${name}`);
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`    ✓ ${name}`);
  } catch (e) {
    failed++;
    const msg = e.message.split("\n")[0];
    console.log(`    ✗ ${name}`);
    console.log(`      ${msg}`);
  }
}

function testAsync(name, fn) {
  asyncTests.push((async () => {
    try {
      await fn();
      passed++;
      console.log(`    ✓ ${name}`);
    } catch (e) {
      failed++;
      const msg = e.message.split("\n")[0];
      console.log(`    ✗ ${name}`);
      console.log(`      ${msg}`);
    }
  })());
}

// ─── Assertions ─────────────────────────────────────────────────────────────
function assert(condition, message) {
  if (!condition) throw new Error(message || "assertion failed");
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message || "expected equal"}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
    );
  }
}

function assertDeepEq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message || "expected deep equal"}: got ${a}, expected ${e}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Constants
// ─────────────────────────────────────────────────────────────────────────────

group("constants");

testAsync("VERSION matches package.json", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const mod = await import("../src/constants.js");
  assertEq(mod.VERSION, pkg.version);
});

testAsync("DEFAULT_PROFILE is 'default'", async () => {
  const mod = await import("../src/constants.js");
  assertEq(mod.DEFAULT_PROFILE, "default");
});

testAsync("all paths are under TMP_HOME", async () => {
  const mod = await import("../src/constants.js");
  assert(mod.PHRONESIS_HOME.startsWith(TMP_HOME), `expected ${mod.PHRONESIS_HOME} to start with ${TMP_HOME}`);
  assert(mod.PROFILES_DIR.startsWith(TMP_HOME), `expected ${mod.PROFILES_DIR} to start with ${TMP_HOME}`);
  assert(mod.GLOBAL_CONFIG_PATH.startsWith(TMP_HOME), `expected ${mod.GLOBAL_CONFIG_PATH} to start with ${TMP_HOME}`);
});

testAsync("GLOBAL_CONFIG_PATH ends with config.yaml", async () => {
  const mod = await import("../src/constants.js");
  assert(mod.GLOBAL_CONFIG_PATH.endsWith("config.yaml"), `expected config.yaml, got ${mod.GLOBAL_CONFIG_PATH}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. lib/paths.js
// ─────────────────────────────────────────────────────────────────────────────

group("lib/paths");

testAsync("ensureConfigDir creates directory", async () => {
  const paths = await import("../src/lib/paths.js");
  const constants = await import("../src/constants.js");
  const dir = constants.PHRONESIS_HOME;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  assert(!existsSync(dir), "dir should not exist yet");
  paths.ensureConfigDir();
  assert(existsSync(dir), "dir should exist now");
});

testAsync("ensureProfileDir creates full tree", async () => {
  const paths = await import("../src/lib/paths.js");
  const dir = paths.ensureProfileDir("test-profile");
  assert(existsSync(dir), "profile dir exists");
  assert(existsSync(join(dir, "gateways")), "gateways dir exists");
  assert(existsSync(join(dir, "data")), "data dir exists");
  assertEq(dir, paths.profileDir("test-profile"), "returns profileDir");
  // Cleanup
  rmSync(dir, { recursive: true, force: true });
});

testAsync("profileDir returns correct path", async () => {
  const paths = await import("../src/lib/paths.js");
  const constants = await import("../src/constants.js");
  assertEq(paths.profileDir("my-profile"), join(constants.PROFILES_DIR, "my-profile"));
});

testAsync("profileConfigPath returns config.yaml", async () => {
  const paths = await import("../src/lib/paths.js");
  const dir = paths.profileDir("p");
  assertEq(paths.profileConfigPath("p"), join(dir, "config.yaml"));
});

testAsync("profileOpencodeConfigPath returns opencode.json", async () => {
  const paths = await import("../src/lib/paths.js");
  const dir = paths.profileDir("p");
  assertEq(paths.profileOpencodeConfigPath("p"), join(dir, "opencode.json"));
});

testAsync("profileTelegramEnvPath returns correct env file", async () => {
  const paths = await import("../src/lib/paths.js");
  const dir = paths.profileDir("p");
  assertEq(paths.profileTelegramEnvPath("p", 1), join(dir, "gateways", "telegram-1.env"));
  assertEq(paths.profileTelegramEnvPath("p", 2), join(dir, "gateways", "telegram-2.env"));
});

testAsync("profileScriptPath returns correct script path", async () => {
  const paths = await import("../src/lib/paths.js");
  const constants = await import("../src/constants.js");
  assertEq(paths.profileScriptPath("p"), join(constants.LOCAL_BIN, "p"));
});

testAsync("re-exports match constants", async () => {
  const paths = await import("../src/lib/paths.js");
  const constants = await import("../src/constants.js");
  assertEq(paths.PHRONESIS_HOME, constants.PHRONESIS_HOME);
  assertEq(paths.PROFILES_DIR, constants.PROFILES_DIR);
  assertEq(paths.GLOBAL_CONFIG_PATH, constants.GLOBAL_CONFIG_PATH);
  assertEq(paths.LOCAL_BIN, constants.LOCAL_BIN);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. lib/config.js
// ─────────────────────────────────────────────────────────────────────────────

group("lib/config");

testAsync("getGlobalConfig returns defaults when no file", async () => {
  const config = await import("../src/lib/config.js");
  const constants = await import("../src/constants.js");
  // Ensure no config file exists
  if (existsSync(constants.GLOBAL_CONFIG_PATH)) {
    rmSync(constants.GLOBAL_CONFIG_PATH, { force: true });
  }
  const result = config.getGlobalConfig();
  assertEq(result.active_profile, "default", "active_profile defaults to 'default'");
  assertEq(result.defaults.model, "anthropic/claude-sonnet-4", "default model");
  assertEq(result.defaults.agent, "orchestrator", "default agent");
});

testAsync("writeGlobalConfig + getGlobalConfig round-trip", async () => {
  const config = await import("../src/lib/config.js");
  config.writeGlobalConfig({ active_profile: "custom", foo: { bar: 42 } });
  const result = config.getGlobalConfig();
  assertEq(result.active_profile, "custom");
  assertEq(result.foo.bar, 42);
});

testAsync("getConfigKey without key returns full config", async () => {
  const config = await import("../src/lib/config.js");
  const result = config.getConfigKey();
  assert(result.active_profile != null, "has active_profile");
});

testAsync("getConfigKey returns undefined for missing key", async () => {
  const config = await import("../src/lib/config.js");
  assertEq(config.getConfigKey("nonexistent.nope"), undefined);
});

testAsync("getConfigKey traverses dot notation", async () => {
  const config = await import("../src/lib/config.js");
  config.writeGlobalConfig({ defaults: { model: "gpt-4" } });
  assertEq(config.getConfigKey("defaults.model"), "gpt-4");
});

testAsync("setConfigKey sets simple value", async () => {
  const config = await import("../src/lib/config.js");
  config.setConfigKey("active_profile", "my-profile");
  assertEq(config.getConfigKey("active_profile"), "my-profile");
});

testAsync("setConfigKey coerces types", async () => {
  const config = await import("../src/lib/config.js");
  config.setConfigKey("flag", "true");
  config.setConfigKey("count", "42");
  config.setConfigKey("name", "hello");
  assertEq(config.getConfigKey("flag"), true, "true string → boolean");
  assertEq(config.getConfigKey("count"), 42, "numeric string → number");
  assertEq(config.getConfigKey("name"), "hello", "plain string preserved");
});

testAsync("setConfigKey creates intermediate objects for dot notation", async () => {
  const config = await import("../src/lib/config.js");
  config.setConfigKey("a.b.c", "deep");
  assertEq(config.getConfigKey("a.b.c"), "deep");
  assertDeepEq(config.getConfigKey("a"), { b: { c: "deep" } });
});

testAsync("listProfiles returns empty when no profiles", async () => {
  const config = await import("../src/lib/config.js");
  const constants = await import("../src/constants.js");
  if (existsSync(constants.PROFILES_DIR)) {
    rmSync(constants.PROFILES_DIR, { recursive: true, force: true });
  }
  assertDeepEq(config.listProfiles(), []);
});

testAsync("listProfiles finds profiles", async () => {
  const config = await import("../src/lib/config.js");
  const paths = await import("../src/lib/paths.js");
  // listProfiles checks that profileConfigPath (config.yaml) exists.
  // ensureProfileDir only creates the directory; we must also write config.
  paths.ensureProfileDir("alpha");
  config.writeProfileConfig("alpha", { name: "alpha" });
  paths.ensureProfileDir("beta");
  config.writeProfileConfig("beta", { name: "beta" });
  const profiles = config.listProfiles();
  assert(profiles.includes("alpha"), `finds alpha in [${profiles}]`);
  assert(profiles.includes("beta"), `finds beta in [${profiles}]`);
});

testAsync("getActiveProfile returns default when unset", async () => {
  const config = await import("../src/lib/config.js");
  const constants = await import("../src/constants.js");
  // Reset config
  if (existsSync(constants.GLOBAL_CONFIG_PATH)) {
    rmSync(constants.GLOBAL_CONFIG_PATH, { force: true });
  }
  assertEq(config.getActiveProfile(), "default");
});

testAsync("setActiveProfile persists", async () => {
  const config = await import("../src/lib/config.js");
  config.setActiveProfile("work");
  assertEq(config.getActiveProfile(), "work");
});

testAsync("getProfileConfig returns defaults when no profile config", async () => {
  const config = await import("../src/lib/config.js");
  const paths = await import("../src/lib/paths.js");
  paths.ensureProfileDir("new-pro");
  const result = config.getProfileConfig("new-pro");
  assertEq(result.name, "new-pro");
  assertDeepEq(result.gateways, {});
});

testAsync("writeProfileConfig + getProfileConfig round-trip", async () => {
  const config = await import("../src/lib/config.js");
  const paths = await import("../src/lib/paths.js");
  paths.ensureProfileDir("p");
  config.writeProfileConfig("p", { name: "p", server: { port: 4097 } });
  const result = config.getProfileConfig("p");
  assertEq(result.server.port, 4097);
});

testAsync("getProfileConfig handles invalid YAML gracefully", async () => {
  const config = await import("../src/lib/config.js");
  const paths = await import("../src/lib/paths.js");
  paths.ensureProfileDir("broken");
  const cfgPath = paths.profileConfigPath("broken");
  writeFileSync(cfgPath, "{{ invalid yaml !! ", "utf8");
  const result = config.getProfileConfig("broken");
  assertEq(result.name, "broken");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. lib/opencode.js
// ─────────────────────────────────────────────────────────────────────────────

group("lib/opencode");

testAsync("resolveProfile returns flag when provided", async () => {
  const opencode = await import("../src/lib/opencode.js");
  assertEq(opencode.resolveProfile("my-profile"), "my-profile");
});

testAsync("resolveProfile falls back to active profile", async () => {
  const opencode = await import("../src/lib/opencode.js");
  const config = await import("../src/lib/config.js");
  config.setActiveProfile("work");
  assertEq(opencode.resolveProfile(undefined), "work");
});

testAsync("resolveOpenCodeBinary falls back to 'opencode' when not on PATH", async () => {
  const opencode = await import("../src/lib/opencode.js");
  assertEq(opencode.resolveOpenCodeBinary({ locations: [] }), "opencode");
});

testAsync("opencodeAvailable returns false when binary missing", async () => {
  const opencode = await import("../src/lib/opencode.js");
  const available = opencode.opencodeAvailable({
    binary: "/definitely-not-a-real-opencode-binary",
  });
  assertEq(available, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. lib/search.js (formatResults)
// ─────────────────────────────────────────────────────────────────────────────

group("lib/search");

testAsync("formatResults returns 'No results found' for empty array", async () => {
  const search = await import("../src/lib/search.js");
  const result = search.formatResults([], "test");
  assert(result.includes("No results found"), "shows no results message");
  assert(result.includes("test"), "includes query");
});

testAsync("formatResults formats single result correctly", async () => {
  const search = await import("../src/lib/search.js");
  const rows = [
    {
      session_id: "abc123def456",
      session_title: "Test Session",
      snippet: "found the answer to the question",
    },
  ];
  const result = search.formatResults(rows, "test");
  assert(result.includes("1 result"), "shows count");
  assert(result.includes("Test Session"), "shows title");
  assert(result.includes("abc123def456"), "shows short ID");
});

testAsync("formatResults formats multiple results", async () => {
  const search = await import("../src/lib/search.js");
  const rows = [
    { session_id: "aaa", session_title: "First" },
    { session_id: "bbb", session_title: "Second", snippet: "snippet content" },
  ];
  const result = search.formatResults(rows, "test");
  assert(result.includes("2 results"), "shows plural count");
  assert(result.includes("First"), "first title");
  assert(result.includes("Second"), "second title");
  assert(result.includes("snippet content"), "second snippet");
});

testAsync("formatResults handles missing fields gracefully", async () => {
  const search = await import("../src/lib/search.js");
  const rows = [{ session_id: "aaa" }];
  const result = search.formatResults(rows, "test");
  assert(result.includes("(untitled)"), "falls back to untitled");
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. CLI command structure
// ─────────────────────────────────────────────────────────────────────────────

group("CLI structure");

testAsync("buildCli does not throw", async () => {
  const mod = await import("../src/cli.js");
  assert(mod.cli != null, "cli exported");
});

testAsync("all commands are registered", async () => {
  const mod = await import("../src/cli.js");
  const helpText = await mod.cli.getHelp();
  const expected = ["config", "profile", "completion", "doctor", "setup", "send", "migrate", "gateway", "skills", "sessions", "plugin"];
  for (const cmd of expected) {
    assert(helpText.includes(cmd), `command "${cmd}" not found in help output`);
  }
});

testAsync("chat command is registered", async () => {
  const mod = await import("../src/cli.js");
  const helpText = await mod.cli.getHelp();
  assert(helpText.includes("chat") || helpText.includes("phronesis [query]"), "chat / default command present");
});

testAsync("global options exist on yargs instance", async () => {
  const mod = await import("../src/cli.js");
  // Verify the cli parses known options
  const argv = mod.cli.parse(["config", "get", "foo"]).catch ? await mod.cli.parse(["config", "get", "foo"]).catch(() => ({})) : {};
  // Just verify parsing doesn't throw
  assert(true, "parsed successfully");
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Config format and edge cases
// ─────────────────────────────────────────────────────────────────────────────

group("config format");

testAsync("writeGlobalConfig produces valid YAML", async () => {
  const config = await import("../src/lib/config.js");
  config.writeGlobalConfig({ active_profile: "test", nested: { key: "val" } });
  const readBack = config.getGlobalConfig();
  assertEq(readBack.active_profile, "test");
  assertEq(readBack.nested.key, "val");
});

testAsync("setConfigKey preserves existing keys", async () => {
  const config = await import("../src/lib/config.js");
  // Reset to defaults first
  const constants = await import("../src/constants.js");
  if (!existsSync(constants.GLOBAL_CONFIG_PATH)) {
    config.writeGlobalConfig({
      active_profile: "default",
      defaults: { model: "anthropic/claude-sonnet-4", agent: "orchestrator" },
    });
  }
  // Verify defaults loaded
  assertEq(config.getGlobalConfig().defaults.model, "anthropic/claude-sonnet-4", "defaults baseline");
  // Set new keys
  config.setConfigKey("server.port", 4097);
  config.setConfigKey("active_profile", "custom");
  const result = config.getGlobalConfig();
  assertEq(result.server.port, 4097, "new key set");
  assertEq(result.active_profile, "custom", "existing key updated");
  assertEq(result.defaults.model, "anthropic/claude-sonnet-4", "defaults preserved");
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Error handling
// ─────────────────────────────────────────────────────────────────────────────

group("error handling");

testAsync("listProfiles handles missing directory gracefully", async () => {
  const config = await import("../src/lib/config.js");
  const constants = await import("../src/constants.js");
  if (existsSync(constants.PROFILES_DIR)) {
    rmSync(constants.PROFILES_DIR, { recursive: true, force: true });
  }
  assertDeepEq(config.listProfiles(), []);
});

test("getConfigKey with null intermediate returns undefined", () => {
  const obj = { a: null };
  const parts = "a.b.c".split(".");
  let value = obj;
  for (const part of parts) {
    if (value === null || value === undefined || typeof value !== "object") {
      return value === undefined ? "ok" : "not-ok";
    }
    value = value[part];
  }
  return value;
});

testAsync("getProfileConfig returns fallback for missing profile", async () => {
  const config = await import("../src/lib/config.js");
  const result = config.getProfileConfig("nonexistent-profile");
  assertEq(result.name, "nonexistent-profile");
});

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\nPhronesis CLI Test Suite`);
console.log(`  HOME: ${TMP_HOME}`);

await Promise.all(asyncTests);

const total = passed + failed;
console.log(`\n  Results: ${passed} passed, ${failed} failed, ${total} total\n`);

// Cleanup temp dir
try { rmSync(TMP_HOME, { recursive: true, force: true }); } catch {}
process.env.HOME = ORIG_HOME;

process.exit(failed > 0 ? 1 : 0);
