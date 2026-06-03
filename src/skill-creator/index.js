import { tool } from "@opencode-ai/plugin";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Per-session complexity tracking state
// ---------------------------------------------------------------------------
const sessionState = new Map();

function getState(sessionID) {
  if (!sessionState.has(sessionID)) {
    sessionState.set(sessionID, {
      toolCallCount: 0,
      fileModifications: 0,
      errors: 0,
      toolsUsed: new Set(),
      startedAt: Date.now(),
      userMessages: [],        // store recent user message content
      createdSkillThisSession: false,  // avoid spamming
    });
  }
  return sessionState.get(sessionID);
}

/** Reset state for a new session (called on session lifecycle if available). */
function resetState(sessionID) {
  sessionState.delete(sessionID);
}

// ---------------------------------------------------------------------------
// Complexity thresholds
// ---------------------------------------------------------------------------
const THRESHOLDS = {
  toolCallCount: 5,
  fileModifications: 2,
  elapsedSeconds: 30,
};

function isComplexTask(state) {
  const elapsed = (Date.now() - state.startedAt) / 1000;
  return (
    state.toolCallCount >= THRESHOLDS.toolCallCount ||
    state.fileModifications >= THRESHOLDS.fileModifications ||
    (elapsed >= THRESHOLDS.elapsedSeconds && state.toolCallCount >= 3)
  );
}

// ---------------------------------------------------------------------------
// Skill file-system helpers
// ---------------------------------------------------------------------------
const SKILLS_DIR = ".opencode/skills";

function skillsPath(worktree) {
  return path.join(worktree, SKILLS_DIR);
}

function skillDir(worktree, name) {
  return path.join(worktree, SKILLS_DIR, name);
}

function skillFilePath(worktree, name) {
  return path.join(skillDir(worktree, name), "SKILL.md");
}

function feedbackFilePath(worktree, name) {
  return path.join(skillDir(worktree, name), ".feedback.json");
}

/**
 * Scan saved skills in the project.
 * Returns array of { name, path, description, trigger, feedbackScore }.
 */
function scanSkills(worktree) {
  const sp = skillsPath(worktree);
  if (!fs.existsSync(sp)) return [];

  return fs.readdirSync(sp, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const sf = skillFilePath(worktree, d.name);
      let description = "";
      let trigger = "";
      if (fs.existsSync(sf)) {
        const content = fs.readFileSync(sf, "utf-8");
        const descM = content.match(/description:\s*(.+)/);
        if (descM) description = descM[1];
        const trigM = content.match(/trigger:\s*(.+)/);
        if (trigM) trigger = trigM[1];
      }
      // Load feedback score if available
      const ff = feedbackFilePath(worktree, d.name);
      let feedbackScore = null;
      if (fs.existsSync(ff)) {
        try {
          const fb = JSON.parse(fs.readFileSync(ff, "utf-8"));
          feedbackScore = fb.averageScore;
        } catch { /* ignore corrupt feedback files */ }
      }
      return {
        name: d.name,
        path: `${SKILLS_DIR}/${d.name}/SKILL.md`,
        description,
        trigger,
        feedbackScore,
      };
    });
}

/**
 * Dedup check: find an existing skill with same or very similar name.
 * Returns the matching skill object or null.
 */
function findSimilarSkill(worktree, name) {
  const skills = scanSkills(worktree);
  const normalized = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-");

  // Exact name match first
  const exact = skills.find((s) => s.name === normalized);
  if (exact) return { match: exact, kind: "exact" };

  // Prefix/contain match
  const similar = skills.find((s) =>
    s.name.includes(normalized) || normalized.includes(s.name)
  );
  if (similar) return { match: similar, kind: "similar" };

  return null;
}

// ---------------------------------------------------------------------------
// SKILL.md content generation
// ---------------------------------------------------------------------------
function generateSkillContent(args) {
  const toolsList = args.tools
    ? args.tools.split(",").map((t) => `- \`${t.trim()}\``).join("\n")
    : "- (add tools as needed)";

  return `---
name: ${args.name}
description: ${args.description}
trigger: ${args.trigger}
${args.tools ? `tools: [${args.tools.split(",").map((t) => `"${t.trim()}"`).join(", ")}]` : ""}
---

# ${args.name}

## Description
${args.description}

## When to Use
${args.trigger}

## Steps
${args.steps}

${args.example ? `## Example\n${args.example}\n` : ""}
## Tools Used
${toolsList}
`;
}

// ---------------------------------------------------------------------------
// Plugin entrypoint
// ---------------------------------------------------------------------------
export default async function plugin(ctx) {
  const worktree = ctx?.worktree || ctx?.project?.worktree || process.cwd();

  return {
    // ── Track tool execution for complexity metrics ──
    "tool.execute.after": async (input, output) => {
      try {
        const state = getState(input.sessionID);
        state.toolCallCount++;
        state.toolsUsed.add(input.tool);

        if (input.tool === "edit" || input.tool === "write") {
          state.fileModifications++;
        }

        // Track user messages from the input if available (for context matching)
        if (input.args?.text && typeof input.args.text === "string") {
          state.userMessages.push(input.args.text);
          // Keep only the last 5 messages
          if (state.userMessages.length > 5) state.userMessages.shift();
        }

        // Detect output containing errors
        if (
          output.output &&
          typeof output.output === "string" &&
          /error|Error|failed|Failed/i.test(output.output)
        ) {
          state.errors++;
        }
      } catch (e) {
        // Never let hook failures propagate to the agent
      }
    },

    // ── Augment system prompt with skill awareness ──
    "experimental.chat.system.transform": async (input, output) => {
      try {
        const existingSkills = scanSkills(worktree);

        // --- Skill Creation Guidance ---
        output.system.push(
          "",
          "---",
          "### Skill Creation System",
          "You have access to `save-skill`, `list-skills`, `update-skill`, and `skill-feedback` tools.",
          "",
          "**When to save a skill:** After complex tasks (5+ tool calls, multi-file changes,",
          "tricky bug fixes, non-trivial workflows) — preserve the approach as a reusable skill.",
          "",
          "**After saving a skill:** Ask the user 'Would you like to rate this skill?' using `skill-feedback`.",
          "This helps improve the skill's quality over time.",
          "",
          "**Updating skills:** If a skill needs refinement, use `update-skill` to improve it.",
          "",
        );

        // --- Contextual Skill Matching ---
        if (existingSkills.length > 0) {
          // Get the user's current message for context matching
          const userInput = input?.messages?.slice(-1)?.[0]?.content || "";

          // Score skills by relevance to the current context
          const scored = existingSkills
            .map((s) => ({
              ...s,
              score: relevanceScore(userInput, s),
            }))
            .filter((s) => s.score > 0)
            .sort((a, b) => b.score - a.score);

          if (scored.length > 0) {
            output.system.push(
              "### Relevant Skills for This Task",
              "The following saved skills match your current context. Consider using them:",
              scored.slice(0, 3).map((s) => {
                const rating = s.feedbackScore != null
                  ? ` (rated ${s.feedbackScore.toFixed(1)}/5)`
                  : "";
                return `- \`${s.name}\` — ${s.description}${rating}`;
              }).join("\n"),
              "",
            );
          }

          // Still list all skills for reference (but shorter)
          output.system.push(
            "### All Saved Skills in This Project",
            existingSkills.length <= 5
              ? existingSkills.map((s) => `- \`${s.name}\`: ${s.description}`).join("\n")
              : `(${existingSkills.length} skills available — use \`list-skills\` to see them all)`,
            "",
          );
        }
      } catch (e) {
        // Never let hook failures propagate
      }
    },

    // ── Register tools ──
    tool: {
      // ── save-skill (with dedup) ──
      "save-skill": tool({
        description:
          "Save a reusable skill (workflow/approach) as a SKILL.md file. " +
          "Skills are automatically loaded in future sessions when relevant. " +
          "Use this after completing a complex multi-step task to preserve the approach. " +
          "If a skill with a similar name already exists, set `update: true` to overwrite it.",
        args: {
          name: tool.schema
            .string()
            .describe("Short kebab-case name (e.g. 'fix-npm-conflicts')"),
          description: tool.schema
            .string()
            .describe("One-line description of what this skill does"),
          trigger: tool.schema
            .string()
            .describe("Natural language condition for when to use this skill"),
          steps: tool.schema
            .string()
            .describe("Step-by-step instructions in markdown format"),
          tools: tool.schema
            .string()
            .optional()
            .describe("Comma-separated tools typically used"),
          example: tool.schema
            .string()
            .optional()
            .describe("Optional example usage or CLI output"),
          update: tool.schema
            .boolean()
            .optional()
            .default(false)
            .describe("Set to true to overwrite an existing skill with the same name"),
        },
        async execute(args, context) {
          const sp = skillsPath(worktree);

          // --- Dedup check ---
          const existing = findSimilarSkill(worktree, args.name);
          if (existing && !args.update) {
            return JSON.stringify({
              success: false,
              conflict: true,
              existingName: existing.match.name,
              existingPath: existing.match.path,
              message:
                `A skill named '${existing.match.name}' already exists. ` +
                `Call save-skill again with update:true to overwrite it, ` +
                `or choose a different name. Use \`list-skills\` to see all existing skills.`,
            });
          }

          // Normalize the name to kebab-case
          const normalizedName = args.name
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/^-+|-+$/g, "");

          const sd = skillDir(worktree, normalizedName);
          fs.mkdirSync(sd, { recursive: true });

          const content = generateSkillContent({
            ...args,
            name: normalizedName,
          });
          fs.writeFileSync(skillFilePath(worktree, normalizedName), content, "utf-8");

          const action = existing ? "Updated" : "Created";

          return JSON.stringify({
            success: true,
            action,  // "Created" or "Updated"
            path: `${SKILLS_DIR}/${normalizedName}/SKILL.md`,
            message:
              `${action} skill '${normalizedName}'. ` +
              `This skill will be available in future sessions. ` +
              `Consider asking the user to rate it using the \`skill-feedback\` tool.`,
          });
        },
      }),

      // ── update-skill (convenience wrapper) ──
      "update-skill": tool({
        description:
          "Update an existing skill by name. Loads the current content, " +
          "applies your changes, and saves. Use this when a skill needs refinement " +
          "after you've used it and found improvements.",
        args: {
          name: tool.schema
            .string()
            .describe("Name of the existing skill to update"),
          description: tool.schema
            .string()
            .optional()
            .describe("Updated description"),
          trigger: tool.schema
            .string()
            .optional()
            .describe("Updated trigger condition"),
          steps: tool.schema
            .string()
            .optional()
            .describe("Updated step-by-step instructions"),
          tools: tool.schema
            .string()
            .optional()
            .describe("Updated comma-separated tools"),
          example: tool.schema
            .string()
            .optional()
            .describe("Updated example"),
        },
        async execute(args, _context) {
          const sf = skillFilePath(worktree, args.name);
          if (!fs.existsSync(sf)) {
            return JSON.stringify({
              success: false,
              message: `No skill named '${args.name}' found. Use \`save-skill\` to create a new one.`,
            });
          }

          // Read existing content, parse frontmatter, merge updates
          const existingContent = fs.readFileSync(sf, "utf-8");
          const frontMatter = {};
          for (const line of existingContent.split("\n")) {
            const m = line.match(/^(\w+):\s*(.+)/);
            if (m) frontMatter[m[1]] = m[2];
          }

          const merged = {
            name: args.name,
            description: args.description || frontMatter.description || "",
            trigger: args.trigger || frontMatter.trigger || "",
            steps: args.steps || "",
            tools: args.tools || frontMatter.tools?.replace(/[[\]" ]/g, "") || "",
            example: args.example || "",
          };

          const newContent = generateSkillContent(merged);
          fs.writeFileSync(sf, newContent, "utf-8");

          return JSON.stringify({
            success: true,
            path: `${SKILLS_DIR}/${args.name}/SKILL.md`,
            message: `Skill '${args.name}' updated.`,
          });
        },
      }),

      // ── list-skills ──
      "list-skills": tool({
        description: "List all saved skills in this project with ratings.",
        args: {},
        async execute(_args, _context) {
          const skills = scanSkills(worktree);
          return JSON.stringify({
            skills: skills.map((s) => ({
              name: s.name,
              description: s.description,
              trigger: s.trigger,
              rating: s.feedbackScore != null ? s.feedbackScore.toFixed(1) : "unrated",
            })),
            count: skills.length,
          });
        },
      }),

      // ── skill-feedback ──
      "skill-feedback": tool({
        description:
          "Record user feedback on a saved skill. After using a skill, ask the user " +
          "to rate it 1-5. This tracks skill effectiveness over time.",
        args: {
          name: tool.schema
            .string()
            .describe("Name of the skill to rate"),
          score: tool.schema
            .number()
            .min(1)
            .max(5)
            .describe("Rating 1-5 (1=not helpful, 5=very helpful)"),
          comment: tool.schema
            .string()
            .optional()
            .describe("Optional user comment about the skill"),
        },
        async execute(args, _context) {
          const sf = skillFilePath(worktree, args.name);
          if (!fs.existsSync(sf)) {
            return JSON.stringify({
              success: false,
              message: `No skill named '${args.name}' found.`,
            });
          }

          const ff = feedbackFilePath(worktree, args.name);
          let feedbackList = [];
          if (fs.existsSync(ff)) {
            try {
              const stored = JSON.parse(fs.readFileSync(ff, "utf-8"));
              feedbackList = Array.isArray(stored.feedback) ? stored.feedback : [];
            } catch { /* reset */ }
          }

          feedbackList.push({
            score: args.score,
            comment: args.comment || "",
            timestamp: new Date().toISOString(),
          });

          const scores = feedbackList.map((f) => f.score);
          const average = scores.reduce((a, b) => a + b, 0) / scores.length;
          const total = scores.length;

          // Store feedback + computed aggregate
          fs.writeFileSync(ff, JSON.stringify({
            feedback: feedbackList,
            averageScore: average,
            totalRatings: total,
            lastRated: new Date().toISOString(),
          }, null, 2), "utf-8");

          return JSON.stringify({
            success: true,
            skill: args.name,
            rating: args.score,
            averageScore: average,
            totalRatings: total,
            message:
              total === 1
                ? `Thanks! Skill '${args.name}' rated ${args.score}/5 (first rating).`
                : `Thanks! Skill '${args.name}' average is now ${average.toFixed(1)}/5 (${total} ratings).`,
          });
        },
      }),
    },

    // ── Ensure skill permission is allowed in config ──
    config: async (opencodeConfig) => {
      const permission = opencodeConfig.permission ?? {};
      if (typeof permission.skill === "undefined") {
        opencodeConfig.permission = { ...permission, skill: "allow" };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Simple context-to-skill relevance scoring
// ---------------------------------------------------------------------------
/** Compute a simple relevance score between user input text and a skill. */
function relevanceScore(userInput, skill) {
  if (!userInput || !skill) return 0;

  const text = userInput.toLowerCase();
  let score = 0;

  // Score from skill name (split kebab-case into words)
  const nameWords = skill.name.split("-").filter(Boolean);
  for (const word of nameWords) {
    if (text.includes(word)) score += 2;
  }

  // Score from description
  if (skill.description) {
    const descWords = skill.description.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    for (const word of descWords) {
      if (text.includes(word)) score += 1;
    }
  }

  // Score from trigger
  if (skill.trigger) {
    const trigWords = skill.trigger.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    for (const word of trigWords) {
      if (text.includes(word)) score += 1.5;
    }
  }

  return score;
}
