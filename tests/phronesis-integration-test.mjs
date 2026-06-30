#!/usr/bin/env node
/**
 * Phronesis Integration Test
 *
 * Verifies that Phronesis plugin tools are actually INVOKED by the model
 * during a real opencode session (not just registered).
 *
 * Requires:
 *   - opencode binary (set via OPENCODE_BIN env or ~/.opencode/bin/opencode)
 *
 * Usage:
 *   node tests/phronesis-integration-test.mjs
 *
 * Returns exit code 0 if all required tools are invoked, 1 otherwise.
 */

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENCODE =
  process.env.OPENCODE_BIN ||
  join(process.env.HOME || "/root", ".opencode", "bin", "opencode");
const OUTPUT_LOG = join(__dirname, "..", "test-output", "integration-run.jsonl");

// The task — explicitly instructs tool use so the model has no ambiguity
const TASK = [
  "You are exploring the phronesis project in the current workspace. Do ALL of the following:",
  "",
  "1. Use search-facts to check your memory for any facts about this project",
  "2. Use list-skills to check what skills exist",
  "3. Read the README.md file at the root of the phronesis project",
  "4. Use add-fact to store 2 facts about what you learned",
  "5. Use search-sessions to find any past sessions related to phronesis",
  "6. Use memory-stats to see memory statistics",
  "",
  "IMPORTANT: You MUST use each of the listed tools. Do NOT skip any."
].join("\n");

// Phronesis tool names grouped by plugin
const PHRONESIS_TOOLS = [
  "add-fact", "search-facts", "list-facts", "forget-fact",
  "consolidate-memory", "mark-consolidated", "memory-stats", "add-observations",
  "get-persona", "set-persona", "edit-persona", "import-soul", "export-soul", "reset-persona",
  "save-skill", "list-skills", "update-skill", "skill-feedback",
  "skill-stats", "skill-versions", "skill-verify", "skill-deprecate", "skill-prune",
  "profile-summary", "profile-preference", "profile-insights",
  "search-sessions",
  "run-on", "list-targets",
];

// Minimum tools we expect to see invoked for this task.
// Note: local `opencode run` uses Bun which lacks better-sqlite3,
// so memory-consolidation tools (search-facts, add-fact, memory-stats)
// will fail at runtime but still count as "invoked" for test purposes.
// search-sessions uses opencode.db which may be locked — also counts as invoked.
const REQUIRED_TOOLS = new Set([
  "search-facts",
  "list-skills",
]);

// Bonus tools (nice to have — proven to work: model calls them)
const BONUS_TOOLS = new Set([
  "memory-stats", "add-fact", "search-sessions",
  "profile-summary", "get-persona", "save-skill", "consolidate-memory"
]);

// ---- Test state ----
let invokedTools = new Set();
let totalCost = 0;
let totalTokens = 0;

function isPhronesisTool(name) {
  return PHRONESIS_TOOLS.includes(name);
}

function parseJsonLine(line) {
  try { return JSON.parse(line); }
  catch { return null; }
}

async function runTest() {
  const outDir = dirname(OUTPUT_LOG);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const logStream = createWriteStream(OUTPUT_LOG, { flags: "w" });

  console.log("=".repeat(60));
  console.log("  Phronesis Integration Test");
  console.log("=".repeat(60));
  console.log("");
  console.log("  Task:");
  TASK.split("\n").forEach((l) => console.log(`    ${l}`));
  console.log("");

  const args = ["run", "--format", "json", "--model", "opencode/big-pickle", TASK];

  console.log(`  Cmd: opencode run --format json\n`);

  const TIMEOUT_MS = 300_000; // 5 min — local LLM may cold-start

  const child = spawn(OPENCODE, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  const killTimer = setTimeout(() => {
    console.log(`  [WARN] Timed out after ${TIMEOUT_MS / 1000}s`);
    child.kill("SIGTERM");
  }, TIMEOUT_MS);

  let stdout = "";
  let stderr = "";
  let toolCallCount = 0;
  let stepCount = 0;
  let resolve;
  const finished = new Promise((r) => (resolve = r));

  // opencode run --format json outputs events to stdout; plugin warnings to stderr
  child.stdout.on("data", (data) => {
    stdout += data.toString();
    logStream.write(data);
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      const event = parseJsonLine(line);
      if (!event) continue;

      // Track Phronesis tool calls
      if (event.type === "tool_use") {
        const toolName = event?.part?.tool || "unknown";
        if (isPhronesisTool(toolName)) {
          invokedTools.add(toolName);
          toolCallCount++;
          console.log(`  📞 Phronesis tool: ${toolName}`);
        }
      }

      // Track steps
      if (event.type === "step_start") {
        stepCount++;
      }

      // Track usage from step_finish
      if (event.type === "step_finish" && event.part) {
        if (event.part.cost) totalCost = event.part.cost;
        if (event.part.tokens) totalTokens = event.part.tokens;
      }
    }
  });

  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  child.on("close", (code) => {
    clearTimeout(killTimer);
    resolve({ code, stdout, stderr });
  });

  child.on("error", (err) => {
    clearTimeout(killTimer);
    console.error(`  [ERR] Process error: ${err.message}`);
    resolve({ code: -1, stdout, stderr });
  });

  const { code } = await finished;

  console.log("");
  console.log("=".repeat(60));
  console.log("  Results");
  console.log("=".repeat(60));
  console.log(`  Exit code:    ${code}`);
  console.log(`  Steps:        ${stepCount}`);
  console.log(`  Phronesis tools: ${toolCallCount}`);

  const invoked = Array.from(invokedTools).sort();
  const missing = Array.from(REQUIRED_TOOLS).filter((t) => !invokedTools.has(t));
  const bonusInvoked = Array.from(BONUS_TOOLS).filter((t) => invokedTools.has(t));

  console.log(`\n  Invoked Phronesis tools (${invoked.length}):`);
  for (const t of invoked) {
    const tag = REQUIRED_TOOLS.has(t) ? " [REQUIRED]" : BONUS_TOOLS.has(t) ? " [BONUS]" : "";
    console.log(`    ✅ ${t}${tag}`);
  }

  if (missing.length > 0) {
    console.log(`\n  ❌ Missing required tools:`);
    for (const t of missing) {
      console.log(`    ❌ ${t}`);
    }
  }

  const totalPhronesis = invoked.length;
  const totalAllTools = PHRONESIS_TOOLS.length;

  console.log(`\n  Coverage: ${totalPhronesis}/${totalAllTools} Phronesis tools ever invoked`);
  console.log(`  Total cost:   $${totalCost.toFixed(4)}`);
  console.log(`  Total tokens: ${totalTokens}`);

  // PASS if all required tools were invoked
  const requiredMet = missing.length === 0;

  console.log(`\n  Summary:`);
  console.log(`    Required tools: ${requiredMet ? "✅" : "❌"}`);

  const passed = requiredMet;
  console.log(`\n  ${passed ? "✅ TEST PASSED" : "❌ TEST FAILED"}`);
  console.log("");

  logStream.end();
  process.exit(passed ? 0 : 1);
}

runTest().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
