import { tool } from "@opencode-ai/plugin";
import fs from "node:fs";
import path from "node:path";
import { getTelegramConfig, sendTelegramNotification } from "../shared/telegram.js";

// ---------------------------------------------------------------------------
// Per-session complexity tracking state
// ---------------------------------------------------------------------------
const MAX_SESSIONS = 200;
const sessionState = new Map();

function evictOldestSession() {
  let oldestKey = null;
  let oldestTime = Infinity;
  for (const [sid, state] of sessionState) {
    if (state.startedAt < oldestTime) {
      oldestTime = state.startedAt;
      oldestKey = sid;
    }
  }
  if (oldestKey) sessionState.delete(oldestKey);
}

function getState(sessionID) {
  if (!sessionState.has(sessionID)) {
    if (sessionState.size >= MAX_SESSIONS) evictOldestSession();
    sessionState.set(sessionID, {
      toolCallCount: 0,
      fileModifications: 0,
      errors: 0,
      toolsUsed: new Set(),
      startedAt: Date.now(),
      userMessages: [],              // recent user message content (for context)
      createdSkillThisSession: false, // avoid spamming same-session creation
      nudgeSent: false,              // Tier 2 nudge already injected
      autoSaved: false,              // Tier 3 auto-save already fired
      saveSkillAttempted: false,     // agent called save-skill/update-skill
      taskSummary: [],               // accumulated snippets for auto-save content
    });
  }
  return sessionState.get(sessionID);
}

function resetState(sessionID) {
  sessionState.delete(sessionID);
}

// Periodically clean stale sessions (>24h inactivity)
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
setInterval(() => {
  const now = Date.now();
  for (const [sid, state] of sessionState) {
    if (now - state.startedAt > 24 * 60 * 60 * 1000) {
      sessionState.delete(sid);
    }
  }
}, CLEANUP_INTERVAL).unref();

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

/** Far exceeds thresholds — triggers Tier 3 auto-save. */
function isSuperComplexTask(state) {
  return state.toolCallCount >= THRESHOLDS.toolCallCount * 2 ||
         state.fileModifications >= THRESHOLDS.fileModifications * 3;
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
      const ff = feedbackFilePath(worktree, d.name);
      let feedbackScore = null;
      if (fs.existsSync(ff)) {
        try {
          const fb = JSON.parse(fs.readFileSync(ff, "utf-8"));
          feedbackScore = fb.averageScore;
        } catch (e) { console.error("[skill-creator] corrupt feedback file:", e.message); }
      }
      return { name: d.name, path: `${SKILLS_DIR}/${d.name}/SKILL.md`, description, trigger, feedbackScore };
    });
}

function findSimilarSkill(worktree, name) {
  const skills = scanSkills(worktree);
  const normalized = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const exact = skills.find((s) => s.name === normalized);
  if (exact) return { match: exact, kind: "exact" };
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
// Tier 3: Auto-save (fallback when agent ignores Tiers 1 & 2)
// ---------------------------------------------------------------------------
function autoSaveSkill(state, worktree) {
  // Collect context from the session
  const toolList = [...state.toolsUsed].join(", ");

  // Derive a name from user messages (first substantive request)
  const allUserText = state.userMessages.join(" ");
  const significant = allUserText
    .toLowerCase()
    .match(/\b(\w{5,})\b/g);

  const nameWords = significant
    ? [...new Set(significant)].slice(0, 4)
    : [`task-${Math.floor(Date.now() / 1000)}`];

  const name = nameWords.join("-").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

  // Build a simple description from tracked data
  const modSnippet = state.fileModifications > 0
    ? `modified ${state.fileModifications} file(s)`
    : "";
  const errSnippet = state.errors > 0
    ? `with ${state.errors} error(s) handled`
    : "";
  const desc = `Auto-saved task using ${state.toolCallCount} tool calls`
    + (modSnippet ? `, ${modSnippet}` : "")
    + (errSnippet ? ` ${errSnippet}` : "");

  const trigger = `When working on tasks involving: ${nameWords.join(", ")}`;

  const steps = `1. Identify the task requirements\n2. Use available tools (${toolList}) to complete it\n3. Verify the result`;
  const example = `(This skill was auto-saved. Edit it with update-skill to add a concrete example.)`;

  const sd = skillDir(worktree, name);
  fs.mkdirSync(sd, { recursive: true });

  const content = generateSkillContent({
    name,
    description: desc,
    trigger,
    steps,
    tools: toolList,
    example,
  });
  fs.writeFileSync(skillFilePath(worktree, name), content, "utf-8");

  state.createdSkillThisSession = true;
  state.autoSaved = true;

  console.log(`[skill-creator] Tier 3 auto-saved skill '${name}' (${state.toolCallCount} tools, ${state.fileModifications} files)`);
  return { name, description: desc };
}

// ---------------------------------------------------------------------------
// Plugin entrypoint
// ---------------------------------------------------------------------------
export default async function plugin(ctx) {
  const worktree = ctx?.worktree || ctx?.project?.worktree || process.cwd();
  const tgConfig = getTelegramConfig(ctx?.config);

  return {
    // ── Track tool execution for complexity metrics  ──
    //     (also enforces Tier 3 auto-save fallback)
    "tool.execute.after": async (input, output) => {
      try {
        const state = getState(input.sessionID);
        state.toolCallCount++;
        state.toolsUsed.add(input.tool);

        // Track file modifications
        if (input.tool === "edit" || input.tool === "write") {
          state.fileModifications++;
        }

        // Collect message content for context
        if (input.args?.text && typeof input.args.text === "string") {
          state.userMessages.push(input.args.text);
          if (state.userMessages.length > 5) state.userMessages.shift();
        }

        // Detect errors in output
        if (
          output.output &&
          typeof output.output === "string" &&
          /error|Error|failed|Failed/i.test(output.output)
        ) {
          state.errors++;
        }

        // Track whether the agent is already handling skill creation
        if (input.tool === "save-skill" || input.tool === "update-skill") {
          state.saveSkillAttempted = true;
        }

        // Tier 3: auto-save when super-complex and agent hasn't done it
        if (
          isSuperComplexTask(state) &&
          !state.autoSaved &&
          !state.saveSkillAttempted &&
          !state.createdSkillThisSession
        ) {
          const auto = autoSaveSkill(state, worktree);

          // Notify via Telegram
          sendTelegramNotification(
            `<b>🤖 Auto-Saved Skill</b>\n<code>${auto.name}</code>\n${auto.description}`,
            tgConfig
          ).catch(() => {});
        }
      } catch (e) {
        console.error("[skill-creator] tool.execute.after error:", e.message);
      }
    },

    // ── Tier 2: Synthetic nudge when agent ignores Tier 1  ──
    "experimental.chat.messages.transform": async (input, output) => {
      try {
        const sessionID = input?.sessionID || input?.messages?.[0]?.sessionID;
        if (!sessionID) return { output };

        const state = getState(sessionID);

        // If the task is complex, agent hasn't saved a skill, and we haven't nudged yet
        if (
          isComplexTask(state) &&
          !state.nudgeSent &&
          !state.saveSkillAttempted &&
          !state.createdSkillThisSession
        ) {
          state.nudgeSent = true;

          // Inject a synthetic assistant message as a reminder
          output.messages = output.messages || [];
          output.messages.push({
            role: "assistant",
            content:
              `[System: This task involved ${state.toolCallCount} tool calls ` +
              `and modified ${state.fileModifications} file(s). ` +
              `Consider preserving this approach with \`save-skill\` so it's ` +
              `reusable in the future. You can describe what was done and ` +
              `what tools were used.]`,
          });
        }
      } catch (e) {
        console.error("[skill-creator] messages.transform error:", e.message);
      }
    },

    // ── Tier 1: Directive system prompt  ──
    "experimental.chat.system.transform": async (input, output) => {
      try {
        const existingSkills = scanSkills(worktree);

        // --- Directive Skill Creation Guidance ---
        output.system.push(
          "",
          "---",
          "### Skill Creation System (Mandatory)",
          "You MUST save a reusable skill after completing ANY complex task.",
          "",
          "**Complexity Thresholds (meet any one):**",
          `- 5+ tool calls in a session`,
          `- 2+ file modifications`,
          `- 30+ seconds of work with 3+ distinct tools`,
          `- Any non-trivial bug fix or error recovery that required investigation`,
          "",
          "**How to save:** Call `save-skill` with: name (kebab-case), description,",
          "trigger conditions, step-by-step instructions, and tools used.",
          "",
          "**DO NOT ask permission** to save a skill — just save it when the task",
          "meets the threshold and inform the user afterward.",
          "",
          "**After saving:** Offer the user a chance to rate it via `skill-feedback`.",
          "",
          "**Available commands:** `save-skill`, `update-skill`, `list-skills`, `skill-feedback`",
          "",
        );

        // --- Contextual Skill Matching ---
        if (existingSkills.length > 0) {
          const userInput = input?.messages?.slice(-1)?.[0]?.content || "";
          const scored = existingSkills
            .map((s) => ({ ...s, score: relevanceScore(userInput, s) }))
            .filter((s) => s.score > 0)
            .sort((a, b) => b.score - a.score);

          if (scored.length > 0) {
            output.system.push(
              "### Relevant Skills for This Task",
              "The following saved skills match your current context. Consider using them:",
              scored.slice(0, 3).map((s) => {
                const rating = s.feedbackScore != null ? ` (rated ${s.feedbackScore.toFixed(1)}/5)` : "";
                return `- \`${s.name}\` — ${s.description}${rating}`;
              }).join("\n"),
              "",
            );
          }

          output.system.push(
            "### All Saved Skills in This Project",
            existingSkills.length <= 5
              ? existingSkills.map((s) => `- \`${s.name}\`: ${s.description}`).join("\n")
              : `(${existingSkills.length} skills available — use \`list-skills\` to see them all)`,
            "",
          );
        }
      } catch (e) {
        console.error("[skill-creator] system.transform error:", e.message);
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
          name: tool.schema.string().describe("Short kebab-case name (e.g. 'fix-npm-conflicts')"),
          description: tool.schema.string().describe("One-line description of what this skill does"),
          trigger: tool.schema.string().describe("Natural language condition for when to use this skill"),
          steps: tool.schema.string().describe("Step-by-step instructions in markdown format"),
          tools: tool.schema.string().optional().describe("Comma-separated tools typically used"),
          example: tool.schema.string().optional().describe("Optional example usage or CLI output"),
          update: tool.schema.boolean().optional().default(false)
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

          const normalizedName = args.name
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/^-+|-+$/g, "");

          const sd = skillDir(worktree, normalizedName);
          fs.mkdirSync(sd, { recursive: true });

          const content = generateSkillContent({ ...args, name: normalizedName });
          fs.writeFileSync(skillFilePath(worktree, normalizedName), content, "utf-8");

          const action = existing ? "Updated" : "Created";

          // Fire-and-forget Telegram notification
          sendTelegramNotification(
            `<b>${action === "Created" ? "🧠" : "🔄"} Skill ${action}</b>\n` +
            `<code>${normalizedName}</code>\n${args.description || args.trigger || ""}`,
            tgConfig
          ).catch(() => {});

          // Mark that the session has had a skill created
          const sid = context?.sessionID;
          if (sid && sessionState.has(sid)) {
            sessionState.get(sid).createdSkillThisSession = true;
          }

          return JSON.stringify({
            success: true,
            action,
            path: `${SKILLS_DIR}/${normalizedName}/SKILL.md`,
            message:
              `${action} skill '${normalizedName}'. ` +
              `This skill will be available in future sessions. ` +
              `Consider asking the user to rate it using the \`skill-feedback\` tool.`,
          });
        },
      }),

      // ── update-skill ──
      "update-skill": tool({
        description:
          "Update an existing skill by name. Loads the current content, " +
          "applies your changes, and saves. Use this when a skill needs refinement.",
        args: {
          name: tool.schema.string().describe("Name of the existing skill to update"),
          description: tool.schema.string().optional().describe("Updated description"),
          trigger: tool.schema.string().optional().describe("Updated trigger condition"),
          steps: tool.schema.string().optional().describe("Updated step-by-step instructions"),
          tools: tool.schema.string().optional().describe("Updated comma-separated tools"),
          example: tool.schema.string().optional().describe("Updated example"),
        },
        async execute(args, _context) {
          const sf = skillFilePath(worktree, args.name);
          if (!fs.existsSync(sf)) {
            return JSON.stringify({
              success: false,
              message: `No skill named '${args.name}' found. Use \`save-skill\` to create a new one.`,
            });
          }

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

          fs.writeFileSync(sf, generateSkillContent(merged), "utf-8");

          sendTelegramNotification(
            `<b>🔄 Skill Updated</b>\n<code>${args.name}</code>`,
            tgConfig
          ).catch(() => {});

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
          name: tool.schema.string().describe("Name of the skill to rate"),
          score: tool.schema.number().min(1).max(5)
            .describe("Rating 1-5 (1=not helpful, 5=very helpful)"),
          comment: tool.schema.string().optional().describe("Optional user comment"),
        },
        async execute(args, _context) {
          const sf = skillFilePath(worktree, args.name);
          if (!fs.existsSync(sf)) {
            return JSON.stringify({ success: false, message: `No skill named '${args.name}' found.` });
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

          fs.writeFileSync(ff, JSON.stringify({
            feedback: feedbackList,
            averageScore: average,
            totalRatings: total,
            lastRated: new Date().toISOString(),
          }, null, 2), "utf-8");

          const milestone = total === 1 || total === 5 || total === 10 || total % 10 === 0;
          if (milestone) {
            sendTelegramNotification(
              `<b>⭐ Skill Rated</b>\n<code>${args.name}</code> — ${args.score}/5\n` +
              `Average: ${average.toFixed(1)}/5 from ${total} rating${total === 1 ? "" : "s"}` +
              (args.comment ? `\n\nComment: ${args.comment}` : ""),
              tgConfig
            ).catch(() => {});
          }

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
function relevanceScore(userInput, skill) {
  if (!userInput || !skill) return 0;
  const text = userInput.toLowerCase();
  let score = 0;

  const nameWords = skill.name.split("-").filter(Boolean);
  for (const word of nameWords) { if (text.includes(word)) score += 2; }

  if (skill.description) {
    const descWords = skill.description.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    for (const word of descWords) { if (text.includes(word)) score += 1; }
  }

  if (skill.trigger) {
    const trigWords = skill.trigger.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    for (const word of trigWords) { if (text.includes(word)) score += 1.5; }
  }

  return score;
}
