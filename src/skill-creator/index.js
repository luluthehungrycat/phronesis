import { tool } from "@opencode-ai/plugin";
import fs from "node:fs";
import path from "node:path";

/**
 * Per-session complexity tracking state.
 * Used to detect when a task is complex enough to warrant skill creation.
 */
const sessionState = new Map();

function getState(sessionID) {
  if (!sessionState.has(sessionID)) {
    sessionState.set(sessionID, {
      toolCallCount: 0,
      fileModifications: 0,
      errors: 0,
      toolsUsed: new Set(),
      startedAt: Date.now(),
    });
  }
  return sessionState.get(sessionID);
}

function isComplexTask(state) {
  const thresholds = {
    toolCallCount: 5,
    fileModifications: 2,
    elapsedSeconds: 30,
  };
  const elapsed = (Date.now() - state.startedAt) / 1000;
  return (
    state.toolCallCount >= thresholds.toolCallCount ||
    state.fileModifications >= thresholds.fileModifications ||
    (elapsed >= thresholds.elapsedSeconds && state.toolCallCount >= 3)
  );
}

/**
 * Generate a SKILL.md file from structured skill data.
 */
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

/**
 * Scan the project's .opencode/skills/ directory for existing skills.
 */
function scanSkills(worktree) {
  const skillsPath = path.join(worktree, ".opencode", "skills");
  if (!fs.existsSync(skillsPath)) return [];

  return fs.readdirSync(skillsPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const skillFile = path.join(skillsPath, d.name, "SKILL.md");
      let description = "";
      if (fs.existsSync(skillFile)) {
        const content = fs.readFileSync(skillFile, "utf-8");
        const m = content.match(/description:\s*(.+)/);
        if (m) description = m[1];
      }
      return { name: d.name, path: `.opencode/skills/${d.name}/SKILL.md`, description };
    });
}

/**
 * Skill Creator Plugin for OpenCode.
 *
 * Features (v0.1.0):
 * - Registers `save-skill` and `list-skills` tools
 * - Tracks session complexity via tool.execute.after
 * - Injects skill-creation awareness into the system prompt
 */
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

    // ── Augment system prompt with skill creation guidance ──
    "experimental.chat.system.transform": async (input, output) => {
      try {
        const existingSkills = scanSkills(worktree);

        output.system.push(
          "",
          "---",
          "### Skill Creation",
          "You have access to the `save-skill` tool. After completing complex tasks " +
            "(5+ tool calls, multi-file changes, solving tricky problems), " +
            "consider saving the approach as a reusable skill. " +
            "Skills are automatically loaded in future sessions when relevant.",
          "",
        );

        if (existingSkills.length > 0) {
          output.system.push(
            "### Existing Skills in This Project",
            existingSkills
              .map((s) => `- \`${s.name}\`: ${s.description}`)
              .join("\n"),
          );
        }
      } catch (e) {
        // Never let hook failures propagate
      }
    },

    // ── Register tools ──
    tool: {
      "save-skill": tool({
        description:
          "Save a reusable skill (workflow/approach) as a SKILL.md file. " +
          "Skills are automatically loaded in future sessions when relevant. " +
          "Use this after completing a complex multi-step task to preserve the approach.",
        args: {
          name: tool.schema
            .string()
            .describe("Short kebab-case name (e.g. 'fix-npm-conflicts')"),
          description: tool.schema
            .string()
            .describe("One-line description of what this skill does"),
          trigger: tool.schema
            .string()
            .describe(
              "Natural language condition for when this skill should be used",
            ),
          steps: tool.schema
            .string()
            .describe("Step-by-step instructions in markdown format"),
          tools: tool.schema
            .string()
            .optional()
            .describe(
              "Comma-separated tools typically used (e.g. 'bash,edit,read')",
            ),
          example: tool.schema
            .string()
            .optional()
            .describe("Optional example usage or CLI output"),
        },
        async execute(args, context) {
          const skillsPath = path.join(worktree, ".opencode", "skills", args.name);
          fs.mkdirSync(skillsPath, { recursive: true });

          const content = generateSkillContent(args);
          fs.writeFileSync(path.join(skillsPath, "SKILL.md"), content, "utf-8");

          return JSON.stringify({
            success: true,
            path: `.opencode/skills/${args.name}/SKILL.md`,
            message: `Skill '${args.name}' created and ready for future sessions.`,
          });
        },
      }),

      "list-skills": tool({
        description: "List all saved skills in this project.",
        args: {},
        async execute(_args, _context) {
          const skills = scanSkills(worktree);
          return JSON.stringify({
            skills,
            count: skills.length,
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
