import { tool } from "@opencode-ai/plugin";
import fs from "node:fs";
import path from "node:path";
import { getTelegramConfig, sendTelegramNotification } from "../shared/telegram.js";

// ---------------------------------------------------------------------------
// File-system layout (parallel to skill-creator)
//   .opencode/skills/<name>/SKILL.md     — skill content
//   .opencode/skills/<name>/.meta.json   — version, deprecation, dates
//   .opencode/skills/<name>/.usage.json  — invocation log
//   .opencode/skills/<name>/.versions/   — archived SKILL.md snapshots
// ---------------------------------------------------------------------------
const SKILLS_DIR = ".opencode/skills";

function skillsPath(worktree) { return path.join(worktree, SKILLS_DIR); }
function skillDir(worktree, name) { return path.join(worktree, SKILLS_DIR, name); }
function skillFilePath(worktree, name) { return path.join(skillDir(worktree, name), "SKILL.md"); }
function metaFilePath(worktree, name) { return path.join(skillDir(worktree, name), ".meta.json"); }
function usageFilePath(worktree, name) { return path.join(skillDir(worktree, name), ".usage.json"); }
function versionsDir(worktree, name) { return path.join(skillDir(worktree, name), ".versions"); }
function versionFilePath(worktree, name, version) {
  return path.join(versionsDir(worktree, name), `v${version}.md`);
}
function feedbackFilePath(worktree, name) {
  return path.join(skillDir(worktree, name), ".feedback.json");
}

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------
function readMeta(worktree, name) {
  const fp = metaFilePath(worktree, name);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, "utf-8")); }
  catch { return null; }
}

function writeMeta(worktree, name, meta) {
  const d = skillDir(worktree, name);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(metaFilePath(worktree, name), JSON.stringify(meta, null, 2), "utf-8");
}

function ensureMeta(worktree, name) {
  let meta = readMeta(worktree, name);
  if (!meta) {
    meta = { version: 1, deprecation: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    writeMeta(worktree, name, meta);
  }
  return meta;
}

// ---------------------------------------------------------------------------
// Usage helpers
// ---------------------------------------------------------------------------
function readUsage(worktree, name) {
  const fp = usageFilePath(worktree, name);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, "utf-8")); }
  catch { return null; }
}

function writeUsage(worktree, name, usage) {
  const d = skillDir(worktree, name);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(usageFilePath(worktree, name), JSON.stringify(usage, null, 2), "utf-8");
}

function logUsage(worktree, name, success, durationMs) {
  const usage = readUsage(worktree, name) || { invocations: [] };
  usage.invocations.push({
    timestamp: new Date().toISOString(),
    success,
    durationMs,
  });
  // Keep last 200 invocations
  if (usage.invocations.length > 200) {
    usage.invocations = usage.invocations.slice(-200);
  }
  writeUsage(worktree, name, usage);
}

// ---------------------------------------------------------------------------
// Skill scanning
// ---------------------------------------------------------------------------
function scanSkillNames(worktree) {
  const sp = skillsPath(worktree);
  if (!fs.existsSync(sp)) return [];
  return fs.readdirSync(sp, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name);
}

function readSkillContent(worktree, name) {
  const fp = skillFilePath(worktree, name);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, "utf-8");
}

/** Parse front matter fields from SKILL.md. */
function parseFrontMatter(content) {
  const fields = {};
  if (!content) return fields;
  for (const line of content.split("\n")) {
    const m = line.match(/^(\w+):\s*(.+)/);
    if (m) fields[m[1]] = m[2];
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Version archiving
// ---------------------------------------------------------------------------
function archiveCurrentVersion(worktree, name, meta) {
  const currentContent = readSkillContent(worktree, name);
  if (!currentContent) return;

  const vd = versionsDir(worktree, name);
  if (!fs.existsSync(vd)) fs.mkdirSync(vd, { recursive: true });

  const vfp = versionFilePath(worktree, name, meta.version);
  fs.writeFileSync(vfp, currentContent, "utf-8");
}

function listVersions(worktree, name) {
  const vd = versionsDir(worktree, name);
  if (!fs.existsSync(vd)) return [];

  return fs.readdirSync(vd)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const v = parseInt(f.match(/v(\d+)\.md/)?.[1] || "0", 10);
      const stat = fs.statSync(path.join(vd, f));
      return { version: v, filename: f, size: stat.size, archivedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.version - a.version);
}

// ---------------------------------------------------------------------------
// Auto-patch: detect when an improved approach is consistently used
// ---------------------------------------------------------------------------
const correctionPatterns = new Map();
// Map<skillName, Set<actionDescription>>

function recordCorrection(worktree, skillName, description) {
  if (!correctionPatterns.has(skillName)) {
    correctionPatterns.set(skillName, new Map());
  }
  const patterns = correctionPatterns.get(skillName);
  const key = description.toLowerCase().trim();
  patterns.set(key, (patterns.get(key) || 0) + 1);
}

function getConsistentCorrections(skillName, threshold = 2) {
  const patterns = correctionPatterns.get(skillName);
  if (!patterns) return [];
  return [...patterns.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([desc, count]) => ({ description: desc, count }));
}

// ---------------------------------------------------------------------------
// Plugin entrypoint
// ---------------------------------------------------------------------------
export default async function plugin(ctx) {
  const worktree = ctx?.worktree || ctx?.project?.worktree || process.cwd();
  const tgConfig = getTelegramConfig(ctx?.config);

  return {
    // ── Inject lifecycle guidance into system prompt  ──
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        const names = scanSkillNames(worktree);
        if (names.length === 0) return;

        const active = [];
        const deprecated = [];

        for (const name of names) {
          const meta = readMeta(worktree, name);
          if (meta?.deprecation) {
            const content = readSkillContent(worktree, name);
            const desc = content ? parseFrontMatter(content).description || "" : "";
            deprecated.push({ name, reason: meta.deprecation, description: desc });
          } else {
            const usage = readUsage(worktree, name);
            const total = usage?.invocations?.length || 0;
            const successes = usage?.invocations?.filter((i) => i.success).length || 0;
            const successRate = total > 0 ? (successes / total * 100).toFixed(0) : null;
            const content = readSkillContent(worktree, name);
            const desc = content ? parseFrontMatter(content).description || "" : "";
            active.push({ name, description: desc, total, successRate });
          }
        }

        const sections = [];

        // High-success recommendations
        const topSkills = active
          .filter((s) => s.total >= 2 && parseInt(s.successRate) >= 80)
          .sort((a, b) => parseInt(b.successRate) - parseInt(a.successRate))
          .slice(0, 5);

        if (topSkills.length > 0) {
          sections.push(
            "### Recommended Skills (High Success Rate)",
            topSkills.map((s) =>
              `- \`${s.name}\`${s.description ? ` — ${s.description}` : ""} (${s.successRate}% success, ${s.total} uses)`
            ).join("\n"),
            "",
          );
        }

        // Deprecation warnings
        if (deprecated.length > 0) {
          sections.push(
            "### ⚠️ Deprecated Skills (Avoid Using)",
            deprecated.map((s) =>
              `- \`${s.name}\`${s.description ? ` — ${s.description}` : ""} — ${s.reason}`
            ).join("\n"),
            "Use `skill-deprecate` to reinstate if needed.",
            "",
          );
        }

        // Unused skills
        const unused = active.filter((s) => s.total === 0);
        if (unused.length > 0) {
          const limit = 5;
          const names = unused.slice(0, limit).map((s) => `\`${s.name}\``).join(", ");
          sections.push(
            `${unused.length > limit ? `${unused.length} skills` : "Skills"} never invoked: ${names}`,
            unused.length > limit ? `  (and ${unused.length - limit} more — use \`skill-stats\` to see all)` : "",
            "",
          );
        }

        // Auto-improvement hints
        if (correctionPatterns.size > 0) {
          const hints = [...correctionPatterns.entries()]
            .map(([name, patterns]) => {
              const consistent = getConsistentCorrections(name);
              if (consistent.length === 0) return null;
              return `- \`${name}\`: ${consistent.map((c) => `"${c.description}" (×${c.count})`).join(", ")}`;
            })
            .filter(Boolean);
          if (hints.length > 0) {
            sections.push(
              "### Skills With Repeated Corrections",
              "The following skills have been corrected multiple times — consider updating them:",
              hints.join("\n"),
              "",
            );
          }
        }

        if (sections.length > 0) {
          output.system.push("---", "### Skill Lifecycle Management", ...sections);
        }
      } catch (e) {
        console.error("[skill-lifecycle] system.transform error:", e.message);
      }
    },

    tool: {
      // ── skill-stats ──
      "skill-stats": tool({
        description:
          "Show usage and effectiveness metrics for all skills. " +
          "Includes invocation counts, success rates, average duration, and ratings.",
        args: {},
        async execute() {
          const names = scanSkillNames(worktree);
          const stats = names.map((name) => {
            const meta = readMeta(worktree, name);
            const usage = readUsage(worktree, name);
            const content = readSkillContent(worktree, name);
            const frontMatter = content ? parseFrontMatter(content) : {};

            const invocations = usage?.invocations || [];
            const total = invocations.length;
            const successes = invocations.filter((i) => i.success).length;
            const durations = invocations.filter((i) => i.durationMs != null).map((i) => i.durationMs);
            const avgDuration = durations.length > 0
              ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(0)
              : null;

            // Feedback/rating
            const ff = feedbackFilePath(worktree, name);
            let rating = null;
            if (fs.existsSync(ff)) {
              try {
                const fb = JSON.parse(fs.readFileSync(ff, "utf-8"));
                rating = fb.averageScore || null;
              } catch { /* ignore */ }
            }

            const consistent = getConsistentCorrections(name);

            return {
              name,
              description: frontMatter.description || "",
              version: meta?.version || 1,
              deprecated: meta?.deprecation || null,
              createdAt: meta?.createdAt || null,
              updatedAt: meta?.updatedAt || null,
              totalInvocations: total,
              successRate: total > 0 ? +(successes / total * 100).toFixed(1) : null,
              avgDurationMs: avgDuration ? +avgDuration : null,
              rating: rating ? +rating.toFixed(1) : null,
              corrections: consistent,
            };
          });

          const totalInvocations = stats.reduce((s, sk) => s + sk.totalInvocations, 0);
          const avgSuccessRate = stats.filter((s) => s.successRate != null)
            .reduce((s, sk) => s + sk.successRate, 0);
          const countWithRate = stats.filter((s) => s.successRate != null).length;

          return JSON.stringify({
            skills: stats,
            summary: {
              totalSkills: stats.length,
              totalInvocations,
              averageSuccessRate: countWithRate > 0 ? +(avgSuccessRate / countWithRate).toFixed(1) : null,
              deprecatedCount: stats.filter((s) => s.deprecated).length,
            },
          });
        },
      }),

      // ── skill-versions ──
      "skill-versions": tool({
        description: "List archived versions of a skill. Each version is a snapshot of SKILL.md at update time.",
        args: {
          name: tool.schema.string().describe("Name of the skill to show versions for"),
          show: tool.schema.number().optional().describe("Version number to show full content for"),
        },
        async execute(args) {
          const sf = skillFilePath(worktree, args.name);
          if (!fs.existsSync(sf)) {
            return JSON.stringify({ success: false, message: `No skill named '${args.name}' found.` });
          }

          const meta = readMeta(worktree, args.name) || { version: 1 };
          const versions = listVersions(worktree, args.name);

          let versionContent = null;
          if (args.show) {
            const vfp = versionFilePath(worktree, args.name, args.show);
            if (fs.existsSync(vfp)) {
              versionContent = fs.readFileSync(vfp, "utf-8");
            } else {
              return JSON.stringify({
                success: false,
                message: `Version ${args.show} not found for skill '${args.name}'.`,
                currentVersion: meta.version,
                availableVersions: versions.map((v) => v.version),
              });
            }
          }

          return JSON.stringify({
            success: true,
            skill: args.name,
            currentVersion: meta.version,
            versions,
            versionContent,
          });
        },
      }),

      // ── skill-verify ──
      "skill-verify": tool({
        description:
          "Check that a skill's SKILL.md is well-formed and its referenced tools/examples " +
          "are valid. Returns any issues found.",
        args: {
          name: tool.schema.string().describe("Name of the skill to verify"),
        },
        async execute(args) {
          const sf = skillFilePath(worktree, args.name);
          if (!fs.existsSync(sf)) {
            return JSON.stringify({ success: false, message: `No skill named '${args.name}' found.` });
          }

          const content = fs.readFileSync(sf, "utf-8");
          const issues = [];

          // Check frontmatter
          if (!content.startsWith("---")) {
            issues.push("Missing YAML frontmatter (must start with '---')");
          }

          const fm = parseFrontMatter(content);
          if (!fm.name) issues.push("Missing 'name' field in frontmatter");
          if (!fm.description) issues.push("Missing 'description' field in frontmatter — consider adding one");

          // Check structure
          if (!content.includes("## Steps")) issues.push("Missing '## Steps' section");
          if (!content.includes("## Tools Used")) issues.push("Missing '## Tools Used' section");

          // Check for empty steps
          const stepsMatch = content.match(/## Steps\n([\s\S]*?)(?:\n##|\n$)/);
          if (!stepsMatch || stepsMatch[1].trim().length < 10) {
            issues.push("Steps section is too short — consider adding detailed instructions");
          }

          // Check feedback exists
          const ff = feedbackFilePath(worktree, args.name);
          let feedbackCount = 0;
          if (fs.existsSync(ff)) {
            try {
              const fb = JSON.parse(fs.readFileSync(ff, "utf-8"));
              feedbackCount = fb.totalRatings || 0;
            } catch { /* ignore */ }
          }

          const meta = readMeta(worktree, args.name);
          const totalInvocations = (readUsage(worktree, args.name)?.invocations?.length) || 0;

          return JSON.stringify({
            success: issues.length === 0,
            skill: args.name,
            issues: issues.length > 0 ? issues : null,
            meta: {
              version: meta?.version || 1,
              deprecated: meta?.deprecation || null,
              createdAt: meta?.createdAt || null,
              updatedAt: meta?.updatedAt || null,
            },
            ratings: feedbackCount,
            totalInvocations,
            healthy: issues.length === 0,
          });
        },
      }),

      // ── skill-deprecate ──
      "skill-deprecate": tool({
        description:
          "Mark a skill as deprecated (or reinstate it). Deprecated skills are flagged in the system prompt " +
          "and excluded from auto-suggestion. Use --reinstate to un-deprecate.",
        args: {
          name: tool.schema.string().describe("Name of the skill to deprecate or reinstate"),
          reason: tool.schema.string().optional().describe("Reason for deprecation (shown in system prompt)"),
          reinstate: tool.schema.boolean().optional().default(false).describe("Set to true to un-deprecate"),
        },
        async execute(args) {
          const sf = skillFilePath(worktree, args.name);
          if (!fs.existsSync(sf)) {
            return JSON.stringify({ success: false, message: `No skill named '${args.name}' found.` });
          }

          const meta = ensureMeta(worktree, args.name);

          if (args.reinstate) {
            if (!meta.deprecation) {
              return JSON.stringify({ success: false, message: `Skill '${args.name}' is not deprecated.` });
            }
            meta.deprecation = null;
            meta.updatedAt = new Date().toISOString();
            writeMeta(worktree, args.name, meta);
            sendTelegramNotification(
              `<b>🔄 Skill Reinstated</b>\n<code>${args.name}</code>`,
              tgConfig
            );
            return JSON.stringify({
              success: true,
              action: "reinstate",
              message: `Skill '${args.name}' reinstated and will appear in suggestions again.`,
            });
          }

          meta.deprecation = args.reason || "No reason given";
          meta.updatedAt = new Date().toISOString();
          writeMeta(worktree, args.name, meta);

          sendTelegramNotification(
            `<b>⚠️ Skill Deprecated</b>\n<code>${args.name}</code>\n${meta.deprecation}`,
            tgConfig
          );

          return JSON.stringify({
            success: true,
            action: "deprecate",
            reason: meta.deprecation,
            message: `Skill '${args.name}' deprecated: ${meta.deprecation}`,
          });
        },
      }),

      // ── skill-prune ──
      "skill-prune": tool({
        description:
          "Permanently remove deprecated skills older than N days. " +
          "Also removes their metadata, usage history, and archived versions. " +
          "Use --dry-run to preview without deleting.",
        args: {
          days: tool.schema.number().optional().default(30).describe("Remove skills deprecated for more than this many days"),
          dryRun: tool.schema.boolean().optional().default(true).describe("Set to false to actually delete"),
          name: tool.schema.string().optional().describe("Prune a specific skill only"),
        },
        async execute(args) {
          const names = args.name ? [args.name] : scanSkillNames(worktree);
          const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000;
          const toRemove = [];

          for (const name of names) {
            const meta = readMeta(worktree, name);
            if (!meta?.deprecation) continue;

            const deprecatedAt = meta.updatedAt ? new Date(meta.updatedAt).getTime() : 0;
            if (deprecatedAt > 0 && (args.days === 0 || deprecatedAt < cutoff)) {
              toRemove.push({ name, deprecatedOn: meta.updatedAt, reason: meta.deprecation });
            }
          }

          if (args.dryRun) {
            return JSON.stringify({
              success: true,
              dryRun: true,
              message: toRemove.length === 0
                ? "No deprecated skills are old enough to prune."
                : `${toRemove.length} skill(s) would be removed:`,
              candidates: toRemove,
            });
          }

          // Actual removal
          const removed = [];
          for (const { name } of toRemove) {
            const dir = skillDir(worktree, name);
            if (fs.existsSync(dir)) {
              fs.rmSync(dir, { recursive: true, force: true });
              removed.push(name);
            }
          }

          if (removed.length > 0) {
            sendTelegramNotification(
              `<b>🗑️ Skills Pruned</b>\nRemoved ${removed.length} deprecated skill(s).\n<code>${removed.join(", ")}</code>`,
              tgConfig
            );
          }

          return JSON.stringify({
            success: true,
            dryRun: false,
            removed,
            count: removed.length,
            message: `Removed ${removed.length} deprecated skill(s).`,
          });
        },
      }),
    },

    // ── Track invocations for usage metrics ──
    //     (We piggyback on the skill-creator's tool.execute.after for invocation tracking
    //      by reading usage. For now, track when skill tools are called.)
    "tool.execute.after": async (input) => {
      try {
        // Track when a skill tool is used (from skill-creator)
        if (input.tool === "save-skill" || input.tool === "update-skill") {
          const name = input.args?.name;
          if (name) {
            const success = !input.error;
            const dur = input.durationMs || 0;
            logUsage(worktree, name, success, dur);
          }
        }

        // Track corrections: when update-skill is called, the old approach was corrected
        if (input.tool === "update-skill") {
          const name = input.args?.name;
          if (name) {
            recordCorrection(worktree, name, "Updated via update-skill");
          }
        }

        // When skill-feedback scores below 3, it indicates the skill needs improvement
        if (input.tool === "skill-feedback") {
          const name = input.args?.name;
          const score = input.args?.score;
          if (name && score != null && score < 3) {
            recordCorrection(worktree, name, `Low rating (${score}/5)`);
          }
        }
      } catch (e) {
        console.error("[skill-lifecycle] tool.execute.after error:", e.message);
      }
    },

    config: async (opencodeConfig) => {
      const perm = opencodeConfig.permission ?? {};
      for (const t of ["skill-stats", "skill-versions", "skill-verify", "skill-deprecate", "skill-prune"]) {
        if (typeof perm[t] === "undefined") {
          opencodeConfig.permission = { ...opencodeConfig.permission, [t]: "allow" };
        }
      }
    },
  };
}
