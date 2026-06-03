import { tool } from "@opencode-ai/plugin";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PERSONA_DIR = ".opencode/persona";
const PERSONA_FILE = "PERSONA.md";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------
function personaPath(worktree) {
  return path.join(worktree, PERSONA_DIR);
}

function personaFilePath(worktree) {
  return path.join(personaPath(worktree), PERSONA_FILE);
}

// ---------------------------------------------------------------------------
// Default persona (used when no PERSONA.md exists)
// ---------------------------------------------------------------------------
function defaultPersona() {
  return {
    name: "Default Assistant",
    version: "1.0.0",
    description: "A helpful, professional coding assistant focused on clarity and correctness.",
    identity: {
      role: "coding assistant",
      expertise: [
        "software engineering",
        "system architecture",
        "debugging",
        "code review",
      ],
      traits: ["thorough", "clear", "cautious"],
    },
    behavior: {
      communication_style: "professional",
      verbosity: "balanced",
      formality: "professional",
    },
    constraints: [
      "Always ask for confirmation before destructive file operations (delete, overwrite, rename)",
      "Explain your reasoning before suggesting solutions",
      "Prefer standard library and well-maintained dependencies over obscure packages",
      "When you identify a security concern, raise it immediately",
      "If you don't know something, say so — never fabricate information",
    ],
    response_style: {
      code_blocks: true,
      explanations: "after-code",
      examples: true,
    },
    triggers: [
      {
        name: "security-sensitive",
        when: "task involves credentials, tokens, secrets, or authentication",
        action: "Warn about exposure risks and suggest safe alternatives (env vars, secret managers, .gitignore)",
      },
      {
        name: "destructive",
        when: "task would delete, overwrite, or rename files or directories",
        action: "Ask for confirmation before proceeding",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Serialize persona to PERSONA.md format
// ---------------------------------------------------------------------------
function personaToMarkdown(persona) {
  const esc = (s) => String(s).replace(/"/g, '\\"');

  // Build YAML frontmatter
  let frontmatter = "---\n";
  frontmatter += `name: "${esc(persona.name)}"\n`;
  frontmatter += `version: "${esc(persona.version)}"\n`;
  frontmatter += `description: "${esc(persona.description)}"\n\n`;

  frontmatter += "identity:\n";
  frontmatter += `  role: "${esc(persona.identity.role)}"\n`;
  frontmatter += `  expertise: [${persona.identity.expertise.map((e) => `"${esc(e)}"`).join(", ")}]\n`;
  frontmatter += `  traits: [${persona.identity.traits.map((t) => `"${esc(t)}"`).join(", ")}]\n\n`;

  frontmatter += "behavior:\n";
  frontmatter += `  communication_style: "${esc(persona.behavior.communication_style)}"\n`;
  frontmatter += `  verbosity: "${esc(persona.behavior.verbosity)}"\n`;
  frontmatter += `  formality: "${esc(persona.behavior.formality)}"\n\n`;

  if (persona.constraints && persona.constraints.length > 0) {
    frontmatter += "constraints:\n";
    for (const c of persona.constraints) {
      frontmatter += `  - "${esc(c)}"\n`;
    }
    frontmatter += "\n";
  }

  frontmatter += "response_style:\n";
  frontmatter += `  code_blocks: ${persona.response_style.code_blocks}\n`;
  frontmatter += `  explanations: "${esc(persona.response_style.explanations)}"\n`;
  frontmatter += `  examples: ${persona.response_style.examples}\n`;

  if (persona.triggers && persona.triggers.length > 0) {
    frontmatter += "\ntriggers:\n";
    for (const t of persona.triggers) {
      frontmatter += `  - name: "${esc(t.name)}"\n`;
      frontmatter += `    when: "${esc(t.when)}"\n`;
      frontmatter += `    action: "${esc(t.action)}"\n`;
    }
  }
  frontmatter += "---\n\n";

  // Markdown body
  let body = `# Persona: ${persona.name}\n\n`;
  body += `> ${persona.description}\n\n`;

  body += "## Identity\n\n";
  body += `I am a ${persona.identity.role} with expertise in ${persona.identity.expertise.join(", ")}. `;
  body += `My working style is ${persona.identity.traits.join(", ")}.\n\n`;

  body += "## Communication\n\n";
  body += `I communicate in a ${persona.behavior.communication_style} manner `;
  body += `with ${persona.behavior.verbosity} detail, and maintain a ${persona.behavior.formality} tone.\n\n`;

  if (persona.constraints && persona.constraints.length > 0) {
    body += "## Constraints\n\n";
    for (let i = 0; i < persona.constraints.length; i++) {
      body += `${i + 1}. ${persona.constraints[i]}\n`;
    }
    body += "\n";
  }

  body += "## Response Style\n\n";
  body += `- Code blocks: **${persona.response_style.code_blocks ? "included" : "avoided"}**\n`;
  body += `- Explanations: ${persona.response_style.explanations}\n`;
  body += `- Examples: **${persona.response_style.examples ? "included" : "avoided"}**\n\n`;

  if (persona.triggers && persona.triggers.length > 0) {
    body += "## Triggers\n\n";
    body += "These situational rules activate when specific conditions are met:\n\n";
    for (const t of persona.triggers) {
      body += `### ${t.name}\n`;
      body += `- **When**: ${t.when}\n`;
      body += `- **Action**: ${t.action}\n\n`;
    }
  }

  return frontmatter + body;
}

// ---------------------------------------------------------------------------
// Parse PERSONA.md into persona object
// ---------------------------------------------------------------------------
function parsePersonaFile(content) {
  const defaults = defaultPersona();

  // Extract YAML frontmatter between --- markers
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) return defaults;

  const fm = fmMatch[1];
  const body = content.slice(fmMatch[0].length);

  const persona = {
    name: extractScalar(fm, "name") || defaults.name,
    version: extractScalar(fm, "version") || defaults.version,
    description: extractScalar(fm, "description") || defaults.description,
    identity: {
      role: extractNestedScalar(fm, "identity", "role") || defaults.identity.role,
      expertise: extractNestedList(fm, "identity", "expertise") || defaults.identity.expertise,
      traits: extractNestedList(fm, "identity", "traits") || defaults.identity.traits,
    },
    behavior: {
      communication_style: extractNestedScalar(fm, "behavior", "communication_style") || defaults.behavior.communication_style,
      verbosity: extractNestedScalar(fm, "behavior", "verbosity") || defaults.behavior.verbosity,
      formality: extractNestedScalar(fm, "behavior", "formality") || defaults.behavior.formality,
    },
    constraints: extractBlockList(fm, "constraints") || defaults.constraints,
    response_style: {
      code_blocks: extractNestedBoolean(fm, "response_style", "code_blocks") ?? defaults.response_style.code_blocks,
      explanations: extractNestedScalar(fm, "response_style", "explanations") || defaults.response_style.explanations,
      examples: extractNestedBoolean(fm, "response_style", "examples") ?? defaults.response_style.examples,
    },
    triggers: extractTriggerList(fm) || defaults.triggers,
  };

  return persona;
}

// ---------------------------------------------------------------------------
// YAML parsing helpers (simple line-based, no external deps)
// ---------------------------------------------------------------------------
function extractScalar(yaml, key) {
  const re = new RegExp(`^${key}:\\s*["']?(.+?)["']?$`, "m");
  const m = yaml.match(re);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

function extractNestedScalar(yaml, parent, key) {
  const re = new RegExp(`^\\s{2}${key}:\\s*["']?(.+?)["']?$`, "m");
  // Find the line after the parent section
  const lines = yaml.split("\n");
  let inParent = false;
  for (const line of lines) {
    if (line.match(new RegExp(`^${parent}:`))) {
      inParent = true;
      continue;
    }
    if (inParent) {
      if (line.match(/^\w/)) break; // next top-level key
      const m = line.match(new RegExp(`^\\s{2}${key}:\\s*["']?(.+?)["']?$`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

function extractNestedList(yaml, parent, key) {
  const lines = yaml.split("\n");
  let inParent = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(new RegExp(`^${parent}:`))) {
      inParent = true;
      continue;
    }
    if (inParent) {
      if (line.match(/^\w/)) break; // next top-level key
      const m = line.match(new RegExp(`^\\s{2}${key}:\\s*\\[(.*)\\]$`));
      if (m) {
        return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
    }
  }
  return null;
}

function extractBlockList(yaml, key) {
  const lines = yaml.split("\n");
  let inBlock = false;
  const items = [];
  for (const line of lines) {
    if (line.match(new RegExp(`^${key}:`))) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line.match(/^\w/)) break; // next top-level key
      const m = line.match(/^\s{2}-\s*["']?(.+?)["']?$/);
      if (m) items.push(m[1].trim().replace(/^["']|["']$/g, ""));
    }
  }
  return items.length > 0 ? items : null;
}

function extractNestedBoolean(yaml, parent, key) {
  const val = extractNestedScalar(yaml, parent, key);
  if (val === "true") return true;
  if (val === "false") return false;
  return null;
}

function extractTriggerList(yaml) {
  const lines = yaml.split("\n");
  let inTriggers = false;
  const triggers = [];
  let current = null;
  for (const line of lines) {
    if (line.match(/^triggers:$/)) {
      inTriggers = true;
      continue;
    }
    if (inTriggers) {
      if (line.match(/^\w/)) break; // next top-level key
      if (line.match(/^\s{2}- name:/)) {
        if (current) triggers.push(current);
        current = { name: "", when: "", action: "" };
        const m = line.match(/name:\s*["']?(.+?)["']?$/);
        if (m) current.name = m[1].trim().replace(/^["']|["']$/g, "");
      } else if (current) {
        const wm = line.match(/^\s{6}when:\s*["']?(.+?)["']?$/);
        if (wm) current.when = wm[1].trim().replace(/^["']|["']$/g, "");
        const am = line.match(/^\s{6}action:\s*["']?(.+?)["']?$/);
        if (am) current.action = am[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  if (current) triggers.push(current);
  return triggers.length > 0 ? triggers : null;
}

// ---------------------------------------------------------------------------
// SOUL.md compatibility — Hermes SOUL.md format
// ---------------------------------------------------------------------------

/**
 * Import a persona from Hermes SOUL.md format.
 * SOUL.md is free-form markdown with recognizable sections.
 * We extract what we can and fill defaults for the rest.
 */
function importFromSoul(content) {
  const persona = defaultPersona();

  // Try to extract name from first heading
  const nameM = content.match(/^#\s+(.+)/m);
  if (nameM) persona.name = nameM[1].trim();

  // Extract description from first paragraph after title
  const descM = content.match(/^>\s+(.+)/m);
  if (descM) persona.description = descM[1].trim();

  // Extract sections by heading
  const sections = {};
  let currentHeading = "";
  const lines = content.split("\n");
  for (const line of lines) {
    const headM = line.match(/^##\s+(.+)/);
    if (headM) {
      currentHeading = headM[1].trim().toLowerCase();
      sections[currentHeading] = [];
    } else if (currentHeading && line.trim()) {
      sections[currentHeading].push(line.trim());
    }
  }

  // Map known sections
  if (sections["identity"]) {
    const text = sections["identity"].join(" ");
    // Try to extract role and expertise
    const roleM = text.match(/I am a\s+(.+?)(?:with|in|\.|$)/i);
    if (roleM) persona.identity.role = roleM[1].trim();
    const expM = text.match(/expertise in\s+(.+?)(?:\.|$)/i);
    if (expM) {
      persona.identity.expertise = expM[1].split(",").map((s) => s.trim().toLowerCase());
    }
  }

  if (sections["constraints"] || sections["rules"]) {
    const section = sections["constraints"] || sections["rules"];
    persona.constraints = section
      .map((l) => l.replace(/^[-*\d]+\.?\s*/, "").trim())
      .filter(Boolean);
  }

  if (sections["communication"]) {
    const text = sections["communication"].join(" ");
    if (/casual/i.test(text)) persona.behavior.communication_style = "casual";
    else if (/friendly/i.test(text)) persona.behavior.communication_style = "friendly";
    else if (/academic/i.test(text)) persona.behavior.communication_style = "academic";
    else persona.behavior.communication_style = "professional";

    if (/concise|brief|short/i.test(text)) persona.behavior.verbosity = "concise";
    else if (/detailed|thorough|comprehensive/i.test(text)) persona.behavior.verbosity = "detailed";
    else persona.behavior.verbosity = "balanced";

    if (/formal|professional/i.test(text)) persona.behavior.formality = "professional";
    else if (/casual|informal/i.test(text)) persona.behavior.formality = "casual";
    else persona.behavior.formality = "professional";
  }

  if (sections["triggers"]) {
    const triggers = [];
    let currentTrigger = null;
    for (const line of sections["triggers"]) {
      const hM = line.match(/^###\s+(.+)/);
      if (hM) {
        if (currentTrigger) triggers.push(currentTrigger);
        currentTrigger = { name: hM[1].trim(), when: "", action: "" };
      } else if (currentTrigger) {
        const wM = line.match(/when:\s*(.+)/i);
        if (wM) currentTrigger.when = wM[1].trim();
        const aM = line.match(/action:\s*(.+)/i);
        if (aM) currentTrigger.action = aM[1].trim();
      }
    }
    if (currentTrigger) triggers.push(currentTrigger);
    if (triggers.length > 0) persona.triggers = triggers;
  }

  return persona;
}

/**
 * Export persona to Hermes SOUL.md format.
 */
function exportToSoul(persona) {
  let md = `# ${persona.name}\n\n`;
  md += `> ${persona.description}\n\n`;

  md += "## Identity\n\n";
  md += `I am a ${persona.identity.role} with expertise in ${persona.identity.expertise.join(", ")}. `;
  md += `My working style is ${persona.identity.traits.join(", ")}.\n\n`;

  md += "## Communication\n\n";
  md += `I communicate in a ${persona.behavior.communication_style} manner with `;
  md += `${persona.behavior.verbosity} detail, maintaining a ${persona.behavior.formality} tone.\n\n`;

  if (persona.constraints && persona.constraints.length > 0) {
    md += "## Constraints\n\n";
    for (const c of persona.constraints) {
      md += `- ${c}\n`;
    }
    md += "\n";
  }

  md += "## Response Style\n\n";
  md += `- Code blocks: ${persona.response_style.code_blocks ? "Yes" : "No"}\n`;
  md += `- Explanations: ${persona.response_style.explanations}\n`;
  md += `- Examples: ${persona.response_style.examples ? "Yes" : "No"}\n\n`;

  if (persona.triggers && persona.triggers.length > 0) {
    md += "## Triggers\n\n";
    for (const t of persona.triggers) {
      md += `### ${t.name}\n`;
      md += `- **When**: ${t.when}\n`;
      md += `- **Action**: ${t.action}\n\n`;
    }
  }

  return md;
}

// ---------------------------------------------------------------------------
// Load/parse persona from filesystem with caching
// ---------------------------------------------------------------------------
let cachedPersona = null;
let personaMtime = 0;

function loadPersona(worktree) {
  const fPath = personaFilePath(worktree);
  if (!fs.existsSync(fPath)) {
    cachedPersona = defaultPersona();
    return cachedPersona;
  }

  const stat = fs.statSync(fPath);
  if (cachedPersona && stat.mtimeMs === personaMtime) {
    return cachedPersona;
  }

  try {
    const content = fs.readFileSync(fPath, "utf-8");
    cachedPersona = parsePersonaFile(content);
    personaMtime = stat.mtimeMs;
  } catch (e) {
    cachedPersona = defaultPersona();
  }
  return cachedPersona;
}

// ---------------------------------------------------------------------------
// Save persona to PERSONA.md
// ---------------------------------------------------------------------------
function savePersona(worktree, persona) {
  const dir = personaPath(worktree);
  fs.mkdirSync(dir, { recursive: true });
  const content = personaToMarkdown(persona);
  fs.writeFileSync(personaFilePath(worktree), content, "utf-8");
  // Invalidate cache
  cachedPersona = persona;
  personaMtime = Date.now();
  return content;
}

// ---------------------------------------------------------------------------
// Build persona guidance text for system prompt
// ---------------------------------------------------------------------------
function buildPersonaGuidance(persona) {
  const parts = [];

  parts.push(`### Persona: ${persona.name}`);
  parts.push(`You are roleplaying as: ${persona.identity.role}`);
  parts.push("");

  // Constraints
  if (persona.constraints && persona.constraints.length > 0) {
    parts.push("**Operational Constraints**:");
    for (const c of persona.constraints) {
      parts.push(`- ${c}`);
    }
    parts.push("");
  }

  // Communication style
  parts.push("**Communication Style**:");
  parts.push(`- Tone: ${persona.behavior.communication_style}`);
  parts.push(`- Verbosity: ${persona.behavior.verbosity}`);
  parts.push(`- Formality: ${persona.behavior.formality}`);
  parts.push("");

  // Response style
  parts.push("**Response Style**:");
  parts.push(`- Code blocks in responses: ${persona.response_style.code_blocks ? "Yes (always include relevant code)" : "No (avoid code blocks)"}`);
  parts.push(`- Explanations: ${persona.response_style.explanations === "after-code" ? "Provide explanation after code examples" : persona.response_style.explanations === "before-code" ? "Provide explanation before code examples" : persona.response_style.explanations === "inline" ? "Explain inline with examples" : "No separate explanations"}`);
  parts.push(`- Include examples: ${persona.response_style.examples ? "Yes" : "No"}`);
  parts.push("");

  // Triggers
  if (persona.triggers && persona.triggers.length > 0) {
    parts.push("**Situational Triggers** (activate when conditions are met):");
    for (const t of persona.triggers) {
      parts.push(`- **${t.name}**: When ${t.when}, then ${t.action}`);
    }
    parts.push("");
  }

  // Identity traits
  const traits = persona.identity.traits.join(", ");
  parts.push(`Your behavior should embody these traits: ${traits}`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Plugin entrypoint
// ---------------------------------------------------------------------------
export default async function plugin(ctx) {
  const worktree = ctx?.worktree || ctx?.project?.worktree || process.cwd();

  return {
    // ── Inject persona into system prompt ──
    "experimental.chat.system.transform": async (input, output) => {
      try {
        const persona = loadPersona(worktree);
        const guidance = buildPersonaGuidance(persona);

        output.system.push(
          "",
          "---",
          guidance,
          "",
        );
      } catch (e) {
        // Never let hook failures propagate
      }
    },

    // ── Optionally inject style guidance into user messages ──
    "experimental.chat.messages.transform": async (input, output) => {
      try {
        const persona = loadPersona(worktree);

        // Only act on the first user message in a session (add style reminder)
        const userMessages = (input.messages || []).filter(
          (m) => m.role === "user",
        );

        if (userMessages.length === 1) {
          const style = `[Style: ${persona.behavior.communication_style}, ` +
            `verbosity: ${persona.behavior.verbosity}, ` +
            `explanations: ${persona.response_style.explanations}]`;

          output.messages = input.messages;
          if (output.messages && output.messages.length > 0) {
            const last = output.messages[output.messages.length - 1];
            if (last && last.role === "user") {
              last.content = `${last.content}\n\n${style}`;
            }
          }
        }
      } catch (e) {
        // Never let hook failures propagate
      }
    },

    // ── Register persona management tools ──
    tool: {
      // ── get-persona ──
      "get-persona": tool({
        description: "View the current persona settings for this agent — identity, communication style, constraints, triggers.",
        args: {},
        async execute(_args, _context) {
          const persona = loadPersona(worktree);
          const filePath = personaFilePath(worktree);
          const exists = fs.existsSync(filePath);

          return JSON.stringify({
            name: persona.name,
            description: persona.description,
            identity: persona.identity,
            behavior: persona.behavior,
            constraints: persona.constraints,
            response_style: persona.response_style,
            triggers: persona.triggers,
            file: exists ? filePath : null,
            source: exists ? "PERSONA.md" : "default (no PERSONA.md file found)",
          });
        },
      }),

      // ── set-persona ──
      "set-persona": tool({
        description:
          "Create or overwrite the persona for this agent. " +
          "Provide the persona as a JSON object matching the PERSONA.md schema. " +
          "Any fields not provided will use defaults.",
        args: {
          persona: tool.schema
            .string()
            .describe(
              'JSON string representing the persona. All fields optional. ' +
              'Example: {"name":"Expert Helper","identity":{"role":"debugging specialist","expertise":["python","react"],"traits":["meticulous"]},"behavior":{"communication_style":"friendly","verbosity":"detailed","formality":"casual"},"constraints":["Always ask before destructive operations"],"response_style":{"code_blocks":true,"explanations":"before-code","examples":true},"triggers":[{"name":"security","when":"tokens involved","action":"warn"}]}',
            ),
        },
        async execute(args, _context) {
          try {
            const partial = JSON.parse(args.persona);
            const defaults = defaultPersona();

            // Deep merge with defaults
            const persona = {
              name: partial.name || defaults.name,
              version: partial.version || defaults.version,
              description: partial.description || defaults.description,
              identity: {
                role: partial.identity?.role || defaults.identity.role,
                expertise: partial.identity?.expertise || defaults.identity.expertise,
                traits: partial.identity?.traits || defaults.identity.traits,
              },
              behavior: {
                communication_style: partial.behavior?.communication_style || defaults.behavior.communication_style,
                verbosity: partial.behavior?.verbosity || defaults.behavior.verbosity,
                formality: partial.behavior?.formality || defaults.behavior.formality,
              },
              constraints: partial.constraints || defaults.constraints,
              response_style: {
                code_blocks: partial.response_style?.code_blocks ?? defaults.response_style.code_blocks,
                explanations: partial.response_style?.explanations || defaults.response_style.explanations,
                examples: partial.response_style?.examples ?? defaults.response_style.examples,
              },
              triggers: partial.triggers || defaults.triggers,
            };

            savePersona(worktree, persona);

            return JSON.stringify({
              success: true,
              name: persona.name,
              path: `${PERSONA_DIR}/${PERSONA_FILE}`,
              message: `Persona '${persona.name}' saved. It will be active in the next session.`,
            });
          } catch (e) {
            return JSON.stringify({
              success: false,
              message: `Failed to parse persona JSON: ${e.message}`,
            });
          }
        },
      }),

      // ── edit-persona ──
      "edit-persona": tool({
        description:
          "Edit specific fields of the current persona. Pass only the fields you want to change. " +
          "Fields not included will remain unchanged.",
        args: {
          name: tool.schema.string().optional().describe("New persona name"),
          description: tool.schema.string().optional().describe("New description"),
          "identity.role": tool.schema.string().optional().describe("New role"),
          "identity.expertise": tool.schema.string().optional().describe("Comma-separated expertise list"),
          "identity.traits": tool.schema.string().optional().describe("Comma-separated traits list"),
          "behavior.communication_style": tool.schema.string().optional().describe("casual, friendly, professional, or academic"),
          "behavior.verbosity": tool.schema.string().optional().describe("concise, balanced, or detailed"),
          "behavior.formality": tool.schema.string().optional().describe("casual or professional"),
          constraints: tool.schema.string().optional().describe("JSON array of constraint strings"),
          "response_style.code_blocks": tool.schema.boolean().optional().describe("Include code blocks"),
          "response_style.explanations": tool.schema.string().optional().describe("before-code, after-code, inline, or none"),
          "response_style.examples": tool.schema.boolean().optional().describe("Include examples"),
        },
        async execute(args, _context) {
          try {
            const persona = loadPersona(worktree);

            // Apply edits
            if (args.name) persona.name = args.name;
            if (args.description) persona.description = args.description;
            if (args["identity.role"]) persona.identity.role = args["identity.role"];
            if (args["identity.expertise"]) {
              persona.identity.expertise = args["identity.expertise"].split(",").map((s) => s.trim());
            }
            if (args["identity.traits"]) {
              persona.identity.traits = args["identity.traits"].split(",").map((s) => s.trim());
            }
            if (args["behavior.communication_style"]) persona.behavior.communication_style = args["behavior.communication_style"];
            if (args["behavior.verbosity"]) persona.behavior.verbosity = args["behavior.verbosity"];
            if (args["behavior.formality"]) persona.behavior.formality = args["behavior.formality"];
            if (args.constraints) {
              try {
                persona.constraints = JSON.parse(args.constraints);
              } catch {
                persona.constraints = [args.constraints];
              }
            }
            if (args["response_style.code_blocks"] !== undefined) persona.response_style.code_blocks = args["response_style.code_blocks"];
            if (args["response_style.explanations"]) persona.response_style.explanations = args["response_style.explanations"];
            if (args["response_style.examples"] !== undefined) persona.response_style.examples = args["response_style.examples"];

            savePersona(worktree, persona);

            return JSON.stringify({
              success: true,
              name: persona.name,
              path: `${PERSONA_DIR}/${PERSONA_FILE}`,
              message: `Persona '${persona.name}' updated. Changes will be active in the next session.`,
            });
          } catch (e) {
            return JSON.stringify({
              success: false,
              message: `Failed to edit persona: ${e.message}`,
            });
          }
        },
      }),

      // ── import-soul ──
      "import-soul": tool({
        description:
          "Import a persona from a Hermes SOUL.md file. " +
          "Parses the SOUL.md markdown sections (Identity, Communication, Constraints, Triggers) " +
          "and creates a PERSONA.md. Any missing fields use defaults.",
        args: {
          path: tool.schema
            .string()
            .describe("Path to the SOUL.md file to import"),
        },
        async execute(args, _context) {
          try {
            const soulPath = path.resolve(worktree, args.path);
            if (!fs.existsSync(soulPath)) {
              return JSON.stringify({
                success: false,
                message: `SOUL.md file not found at '${soulPath}'`,
              });
            }

            const content = fs.readFileSync(soulPath, "utf-8");
            const persona = importFromSoul(content);
            savePersona(worktree, persona);

            return JSON.stringify({
              success: true,
              name: persona.name,
              path: `${PERSONA_DIR}/${PERSONA_FILE}`,
              message: `Imported persona '${persona.name}' from SOUL.md. Converted to ${PERSONA_DIR}/${PERSONA_FILE}`,
            });
          } catch (e) {
            return JSON.stringify({
              success: false,
              message: `Failed to import SOUL.md: ${e.message}`,
            });
          }
        },
      }),

      // ── export-soul ──
      "export-soul": tool({
        description:
          "Export the current persona to Hermes SOUL.md format. " +
          "Creates a SOUL.md file at the specified path that can be used with Hermes Agent.",
        args: {
          output: tool.schema
            .string()
            .optional()
            .default(".opencode/persona/SOUL.md")
            .describe("Output path for the SOUL.md file (default: .opencode/persona/SOUL.md)"),
        },
        async execute(args, _context) {
          try {
            const persona = loadPersona(worktree);
            const soulContent = exportToSoul(persona);
            const outPath = path.resolve(worktree, args.output);
            const outDir = path.dirname(outPath);
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(outPath, soulContent, "utf-8");

            return JSON.stringify({
              success: true,
              path: path.relative(worktree, outPath) || args.output,
              message: `Exported persona '${persona.name}' to SOUL.md format at '${args.output}'`,
            });
          } catch (e) {
            return JSON.stringify({
              success: false,
              message: `Failed to export SOUL.md: ${e.message}`,
            });
          }
        },
      }),

      // ── reset-persona ──
      "reset-persona": tool({
        description:
          "Reset the persona to factory defaults. " +
          "Deletes the PERSONA.md file and reverts to the built-in default persona.",
        args: {},
        async execute(_args, _context) {
          const fPath = personaFilePath(worktree);
          if (fs.existsSync(fPath)) {
            fs.unlinkSync(fPath);
          }
          cachedPersona = null;

          return JSON.stringify({
            success: true,
            message: "Persona reset to defaults. Default persona will be active in the next session.",
          });
        },
      }),
    },

    // ── Ensure persona permission is allowed ──
    config: async (opencodeConfig) => {
      const permission = opencodeConfig.permission ?? {};
      if (typeof permission.persona === "undefined") {
        opencodeConfig.permission = { ...permission, persona: "allow" };
      }
    },
  };
}
