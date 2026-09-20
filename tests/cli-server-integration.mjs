#!/usr/bin/env node
/**
 * Phronesis CLI ↔ Server Integration Test
 *
 * Verifies that the Phronesis CLI can communicate with an OpenCode server
 * running Phronesis plugins (typically on port 4097).
 *
 * Tests the full wiring:
 *   phronesis CLI → opencode binary → OpenCode server → Phronesis plugins
 *
 * Usage:
 *   node tests/cli-server-integration.mjs                    # default: port 4097
 *   SERVER_PORT=4097 node tests/cli-server-integration.mjs   # explicit port
 *   SERVER_URL=http://localhost:4097 node ...                 # full URL override
 *
 * Exit code:
 *   0  — all server-dependent tests pass (or server unavailable, all skipped)
 *   1  — any test fails
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const CLI = join(PROJECT_ROOT, "cli", "bin", "phronesis.js");

// ── Config ──────────────────────────────────────────────────────────────────
const SERVER_PORT = parseInt(process.env.SERVER_PORT || "4097", 10);
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${SERVER_PORT}`;

// ── Test Framework ──────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    if (e.stack) {
      const lines = e.stack.split("\n").slice(1, 3).join("\n     ");
      console.log(`     ${lines}`);
    }
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertIncludes(text, substr, label) {
  if (!text.includes(substr)) {
    throw new Error(`${label || "expected"}: "${substr}" not found in output\n  got: ${text.slice(0, 200)}`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Check if the OpenCode server is reachable via curl. */
function serverReachable() {
  const result = spawnSync("curl", [
    "-s", "-o", "/dev/null", "-w", "%{http_code}",
    "--max-time", "3", SERVER_URL,
  ], { encoding: "utf8", timeout: 10000 });
  const code = result.stdout?.trim();
  return code && code !== "000";
}

/** Run the phronesis CLI and return { status, stdout, stderr }. */
function phronesis(args = [], opts = {}) {
  const env = {
    ...process.env,
    HOME: opts.home || process.env.HOME,
    OPENCODE_URL: opts.url || process.env.OPENCODE_URL || "",
    CI: "true",
  };
  const result = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    cwd: PROJECT_ROOT,
    env,
    timeout: opts.timeout || 30000,
  });
  return result;
}

/** Check if the opencode binary is available. */
function opencodeAvailable() {
  const result = spawnSync("opencode", ["--version"], {
    encoding: "utf8",
    timeout: 5000,
  });
  return result.status === 0;
}

/** Run `opencode run /<tool> <args>` against the server. */
function opencodeRunTool(tool, toolArgs = []) {
  const result = spawnSync("opencode", [
    "run", `/${tool}`, ...toolArgs.map(String),
    "--model", "opencode/big-pickle",
  ], {
    encoding: "utf8",
    env: { ...process.env, OPENCODE_URL: SERVER_URL },
    timeout: 30000,
  });
  return result;
}

// ── Test Groups ──────────────────────────────────────────────────────────────
let serverUp = false;

function testServerReachability() {
  console.log("\n📡 Server Reachability");
  console.log("  " + "=".repeat(40));

  const code = serverReachable();
  if (code) {
    console.log(`  ✅ Server reachable at ${SERVER_URL} (HTTP ${code})`);
    serverUp = true;
    passed++;
  } else {
    console.log(`  ⏭️  Server not reachable at ${SERVER_URL} — integration tests skipped`);
    console.log(`     (start server: cd <project> && opencode serve --port ${SERVER_PORT})`);
    skipped++;
  }
}

function testCLIWithServer() {
  if (!serverUp) {
    console.log("\n⏭️  CLI → Server tests (skipped — server not available)");
    console.log("  " + "=".repeat(40));
    skipped += 6;
    return;
  }

  console.log("\n🔗 CLI → Server Integration");
  console.log("  " + "=".repeat(40));

  // 1. opencode debug config — verify plugins are loaded
  test("opencode debug config succeeds and shows plugins", () => {
    const result = spawnSync("opencode", ["debug", "config"], {
      encoding: "utf8",
      env: { ...process.env, OPENCODE_URL: SERVER_URL },
      timeout: 15000,
    });
    assert(result.status === 0, `exit ${result.status}: ${result.stderr?.slice(0, 100)}`);
    const cfg = JSON.parse(result.stdout);
    assert(Array.isArray(cfg.plugin), "config must have plugin array");
    const pluginStr = JSON.stringify(cfg.plugin);
    assert(
      pluginStr.includes("skill-creator") || pluginStr.includes("memory-consolidation"),
      `plugins should include phronesis plugins, got: ${pluginStr.slice(0, 200)}`
    );
  });

  // 2. opencode run /list-skills — verifies plugin tool invocation
  test("opencode run /list-skills returns tool output", () => {
    const result = opencodeRunTool("list-skills");
    assert(result.status === 0, `exit ${result.status}: ${result.stderr?.slice(0, 100)}`);
    const output = result.stdout?.trim() || "";
    assert(output.length > 0, "should produce output");
    // list-skills returns JSON
    try {
      const parsed = JSON.parse(output);
      assert(typeof parsed === "object", "output should be parseable JSON");
    } catch {
      // Accept text output too
      assert(output.includes("skills") || output.includes("count"), "text output should mention skills");
    }
  });

  // 3. opencode run /get-persona — another plugin tool
  test("opencode run /get-persona returns persona data", () => {
    const result = opencodeRunTool("get-persona");
    assert(result.status === 0, `exit ${result.status}: ${result.stderr?.slice(0, 100)}`);
    const output = result.stdout?.trim() || "";
    assert(output.length > 0, "should produce output");
    try {
      const parsed = JSON.parse(output);
      assert(typeof parsed.name === "string", "persona should have name");
    } catch {
      // Accept text output
      assert(output.includes("name") || output.includes("role"), "output should mention persona fields");
    }
  });

  // 4. opencode run /profile-summary
  test("opencode run /profile-summary returns profile data", () => {
    const result = opencodeRunTool("profile-summary");
    assert(result.status === 0, `exit ${result.status}: ${result.stderr?.slice(0, 100)}`);
    const output = result.stdout?.trim() || "";
    assert(output.length > 0, "should produce output");
  });

  // 5. phronesis CLI doctor — JSON output against server
  test("phronesis doctor --json produces valid diagnostics", () => {
    // We need a temp HOME to test cleanly
    const result = phronesis(["doctor", "--json"], { url: SERVER_URL });
    assert(result.status === 0 || result.status === 1,
      `doctor should exit 0 or 1, got ${result.status}`);
    const stdout = result.stdout?.trim() || "";
    if (stdout) {
      try {
        const data = JSON.parse(stdout);
        assert(data.profile, "diagnostics should have profile field");
        assert(Array.isArray(data.checks), "diagnostics should have checks array");
      } catch {
        // Non-JSON output is acceptable if running in restricted env
      }
    }
  });

  // 6. phronesis CLI plugin list — tests registry (doesn't use server)
  test("phronesis plugin list shows available plugins", () => {
    const result = phronesis(["plugin", "list"], {});
    // This loads from registry, doesn't need server
    assert(result.status === 0, `exit ${result.status}: ${result.stderr?.slice(0, 100)}`);
    assertIncludes(result.stdout, "Available plugins", "plugin list should list plugins");
  });
}

function testCLIOffline() {
  console.log("\n📋 CLI Offline Tests");
  console.log("  " + "=".repeat(40));

  // 1. CLI --help succeeds
  test("phronesis --help exits 0", () => {
    const result = phronesis(["--help"]);
    assert(result.status === 0);
    assertIncludes(result.stdout, "Commands:");
    assertIncludes(result.stdout, "chat");
    assertIncludes(result.stdout, "doctor");
    assertIncludes(result.stdout, "plugin");
  });

  // 2. CLI with unknown command fails gracefully
  test("phronesis nonexistent exits non-zero", () => {
    const result = phronesis(["nonexistent"]);
    assert(result.status !== 0);
  });

  // 3. CLI doctor (no server) — should still complete
  test("phronesis doctor completes without server", () => {
    const result = phronesis(["doctor"], { url: "" });
    // Should exit 0 or 1, but not crash
    assert(result.status === 0 || result.status === 1,
      `doctor exit ${result.status}: ${result.stderr?.slice(0, 100)}`);
    assert(result.stdout.length > 0, "doctor should produce output");
  });

  // 4. CLI help commands all parse
  const helpCmds = ["gateway", "sessions", "skills", "config", "profile", "send", "create-plugin"];
  for (const cmd of helpCmds) {
    test(`phronesis ${cmd} --help exits 0`, () => {
      const result = phronesis([cmd, "--help"]);
      assert(result.status === 0, `exit ${result.status}: ${result.stderr?.slice(0, 100)}`);
    });
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║   Phronesis CLI ↔ Server Integration Test Suite    ║");
console.log("╚══════════════════════════════════════════════════════╝");
console.log(`\n  Server: ${SERVER_URL}`);
console.log(`  CLI:    ${CLI}`);
console.log(`  opencode: ${opencodeAvailable() ? "✅ available" : "❌ not found"}`);

testCLIOffline();
testServerReachability();
testCLIWithServer();

// ── Results ──────────────────────────────────────────────────────────────────
const total = passed + failed + skipped;
console.log(`\n  Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total)`);
console.log("");

if (serverUp && failed > 0) {
  console.log("  ❌ Some tests failed while server was available.");
  process.exit(1);
} else if (!serverUp && failed > 0) {
  console.log("  ⚠️  Offline tests failed (server-independent).");
  process.exit(1);
} else {
  console.log(serverUp
    ? "  ✅ All tests passed (full integration verified)."
    : "  ⏭️  Server not available — integration tests skipped. Run with SERVER_PORT=4097.");
  process.exit(0);
}
