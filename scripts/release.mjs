#!/usr/bin/env node
/**
 * Phronesis Release Script
 *
 * Automates: version bump, CHANGELOG generation, tag, push.
 *
 * Usage:
 *   node scripts/release.mjs patch     # 0.1.0 → 0.1.1
 *   node scripts/release.mjs minor     # 0.1.0 → 0.2.0
 *   node scripts/release.mjs major     # 0.1.0 → 1.0.0
 *   node scripts/release.mjs 0.2.0     # explicit version
 *
 * Requirements: git, Node.js 20+
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI_PKG = join(ROOT, "cli", "package.json");
const CHANGELOG = join(ROOT, "CHANGELOG.md");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: opts.silent ? "pipe" : "inherit",
    ...opts,
  });
  if (result.error) throw new Error(`${cmd} ${args.join(" ")}: ${result.error.message}`);
  if (result.status !== 0 && !opts.allowFailure) {
    throw new Error(`${cmd} ${args.join(" ")}: exited ${result.status}`);
  }
  return result.stdout?.trim() || "";
}

function getLastTag() {
  try {
    return run("git", ["describe", "--tags", "--abbrev=0"], { silent: true, allowFailure: true });
  } catch {
    return "";
  }
}

function getGitLog(fromTag) {
  const range = fromTag ? `${fromTag}..HEAD` : "HEAD";
  const raw = run("git", ["log", "--no-merges", "--format=%s|||%b|||%H", range], { silent: true });
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => {
    const [subject, body, hash] = line.split("|||");
    return { subject: subject || "", body: body || "", hash: (hash || "").slice(0, 7) };
  });
}

function parseConventionalCommit(subject) {
  // Supported: feat:, fix:, chore:, docs:, test:, refactor:, style:, perf:, ci:, build:, revert:
  const match = subject.match(
    /^(feat|fix|chore|docs|test|refactor|style|perf|ci|build|revert)(\([^)]+\))?:\s*(.+)$/i
  );
  if (match) {
    return {
      type: match[1].toLowerCase(),
      scope: match[2] ? match[2].slice(1, -1) : null,
      message: match[3],
    };
  }
  // Fallback: treat as 'other'
  return { type: "other", scope: null, message: subject };
}

function changelogSection(version, date, entries) {
  const lines = [`## [${version}] — ${date}`, ""];

  const groups = {
    feat: "Added",
    fix: "Fixed",
    docs: "Documentation",
    chore: "Chores",
    refactor: "Refactored",
    test: "Tests",
    perf: "Performance",
    style: "Style",
    ci: "CI/CD",
    build: "Build",
    revert: "Reverted",
    other: "Miscellaneous",
  };

  const grouped = {};
  for (const entry of entries) {
    const group = groups[entry.type] || "Miscellaneous";
    if (!grouped[group]) grouped[group] = [];
    const scope = entry.scope ? `**${entry.scope}:** ` : "";
    const hash = entry.hash ? ` (${entry.hash})` : "";
    grouped[group].push(`- ${scope}${entry.message}${hash}`);
  }

  for (const [group, items] of Object.entries(groups)) {
    const key = items;
    if (grouped[key]) {
      lines.push(`### ${key}`);
      lines.push(...grouped[key]);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function nextVersion(current, bump) {
  const parts = current.split(".").map(Number);
  if (bump === "major") return `${parts[0] + 1}.0.0`;
  if (bump === "minor") return `${parts[0]}.${parts[1] + 1}.0`;
  if (bump === "patch") return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  // explicit version
  return bump;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const bump = process.argv[2];
  if (!bump || !["patch", "minor", "major"].includes(bump)) {
    console.error("Usage: node scripts/release.mjs <patch|minor|major>");
    process.exit(1);
  }

  // 1. Read current version
  const pkg = JSON.parse(readFileSync(CLI_PKG, "utf8"));
  const currentVersion = pkg.version;
  const newVersion = nextVersion(currentVersion, bump);

  console.log(`\n  📦 Phronesis Release`);
  console.log(`     ${currentVersion} → ${newVersion} (${bump})\n`);

  // 2. Get git log since last tag
  const lastTag = getLastTag();
  console.log(`  Last tag: ${lastTag || "(none)"}\n`);

  const commits = getGitLog(lastTag);
  if (commits.length === 0) {
    console.log("  No new commits since last tag. Nothing to release.");
    process.exit(0);
  }

  const entries = commits.map((c) => {
    const parsed = parseConventionalCommit(c.subject);
    const message = parsed.message || c.subject;
    return { ...parsed, message, hash: c.hash };
  });

  // 3. Generate CHANGELOG entry
  const today = new Date().toISOString().slice(0, 10);
  const newSection = changelogSection(newVersion, today, entries);

  const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : "# Changelog\n\n";
  const header = existing.startsWith("# Changelog") ? "# Changelog\n\n" : "# Changelog\n\n";
  const rest = existing.replace(header, "").trim();

  const newChangelog = header + newSection + "\n" + (rest ? rest + "\n" : "");
  writeFileSync(CHANGELOG, newChangelog, "utf8");
  console.log(`  ✓ CHANGELOG.md updated with ${entries.length} entries`);

  // 4. Update package.json version
  pkg.version = newVersion;
  writeFileSync(CLI_PKG, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  console.log(`  ✓ cli/package.json → ${newVersion}`);

  // 5. Commit, tag, push
  run("git", ["add", CLI_PKG, CHANGELOG]);
  run("git", ["commit", "-m", `chore: release v${newVersion}`]);
  run("git", ["tag", "-a", `v${newVersion}`, "-m", `chore: release v${newVersion}`]);
  console.log(`  ✓ Committed and tagged v${newVersion}`);

  run("git", ["push", "origin", `v${newVersion}`]);
  run("git", ["push", "origin", "master"]);
  console.log(`\n  🚀 Released v${newVersion}\n`);
}

main().catch((err) => {
  console.error(`\n  ✗ ${err.message}\n`);
  process.exit(1);
});
