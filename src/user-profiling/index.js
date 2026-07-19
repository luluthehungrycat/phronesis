import { tool } from "@opencode-ai/plugin";
import fs from "node:fs";
import path from "node:path";
import { getTelegramConfig, sendTelegramNotification } from "../shared/telegram.js";

// ---------------------------------------------------------------------------
// Profile storage
//   .opencode/profile/profile.json — full user profile
// ---------------------------------------------------------------------------
const PROFILE_DIR = ".opencode/profile";
const PROFILE_FILE = "profile.json";

function profilePath(worktree) {
  return path.join(worktree, PROFILE_DIR, PROFILE_FILE);
}

function readProfile(worktree) {
  const fp = profilePath(worktree);
  if (!fs.existsSync(fp)) {
    return defaultProfile();
  }
  try {
    return { ...defaultProfile(), ...JSON.parse(fs.readFileSync(fp, "utf-8")) };
  } catch {
    return defaultProfile();
  }
}

function writeProfile(worktree, profile) {
  const d = path.join(worktree, PROFILE_DIR);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  profile.lastUpdated = new Date().toISOString();
  fs.writeFileSync(profilePath(worktree), JSON.stringify(profile, null, 2), "utf-8");
}

function defaultProfile() {
  return {
    communication: { verbosity: null, formality: null, technicalDepth: null },
    preferences: [],
    commonTasks: [],
    tools: [],
    sessionCount: 0,
    lastUpdated: null,
  };
}

// ---------------------------------------------------------------------------
// Per-session tracking state
// ---------------------------------------------------------------------------
const MAX_SESSIONS = 200;
const sessionProfileState = new Map();

function evictOldestSession() {
  let oldestKey = null;
  let oldestTime = Infinity;
  for (const [sid, state] of sessionProfileState) {
    if (state.startedAt < oldestTime) {
      oldestTime = state.startedAt;
      oldestKey = sid;
    }
  }
  if (oldestKey) sessionProfileState.delete(oldestKey);
}

function getSessionState(sessionID) {
  if (!sessionProfileState.has(sessionID)) {
    if (sessionProfileState.size >= MAX_SESSIONS) evictOldestSession();
    sessionProfileState.set(sessionID, {
      toolCallCount: 0,
      messageCount: 0,
      totalMessageLength: 0,
      technicalTerms: new Set(),
      toolsUsed: new Set(),
      taskTypes: [],
      startedAt: Date.now(),
      lastMessageLength: 0,
    });
  }
  return sessionProfileState.get(sessionID);
}

function cleanupSession(sessionID) {
  sessionProfileState.delete(sessionID);
}

// Periodically clean stale sessions (>2h inactivity)
setInterval(() => {
  const now = Date.now();
  for (const [sid, state] of sessionProfileState) {
    if (now - state.startedAt > 2 * 60 * 60 * 1000) {
      sessionProfileState.delete(sid);
    }
  }
}, 30 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Heuristic detection helpers
// ---------------------------------------------------------------------------
const TECH_TERMS = new Set([
  "api", "docker", "kubernetes", "typescript", "javascript", "python", "rust",
  "react", "node", "sql", "database", "deploy", "config", "middleware",
  "async", "callback", "promise", "endpoint", "schema", "query", "mutation",
  "websocket", "http", "json", "yaml", "rest", "graphql", "cli", "sdk",
  "framework", "library", "compiler", "debug", "test", "ci", "cd",
  "pipeline", "container", "orchestrator", "monolith", "microservice",
  "lambda", "serverless", "function", "variable", "algorithm", "pattern",
]);

function detectTechnicalDepth(message) {
  if (!message || message.length < 20) return null;
  const lower = message.toLowerCase();
  const words = lower.split(/\W+/).filter((w) => w.length > 2);
  const techCount = words.filter((w) => TECH_TERMS.has(w)).length;
  const ratio = techCount / words.length;
  if (ratio > 0.15) return "high";
  if (ratio > 0.05) return "medium";
  return "low";
}

function detectVerbosity(message) {
  if (!message) return null;
  const length = message.length;
  if (length > 500) return "verbose";
  if (length > 100) return "moderate";
  return "concise";
}

function detectFormality(message) {
  if (!message || message.length < 10) return null;
  const lower = message.toLowerCase();
  // Informal markers
  const informal = ["hey", "gonna", "wanna", "yeah", "nah", "cool", "awesome",
    "btw", "imo", "lol", "thx", "plz", "dunno", "kinda", "sorta"];
  const formal = ["please", "regarding", "would like", "could you", "in order to",
    "furthermore", "however", "therefore", "additionally", "specifically"];

  const informalCount = informal.filter((w) => lower.includes(w)).length;
  const formalCount = formal.filter((w) => lower.includes(w)).length;

  if (formalCount > informalCount) return "formal";
  if (informalCount > formalCount) return "casual";
  return null;
}

// ---------------------------------------------------------------------------
// Task classification
// ---------------------------------------------------------------------------
const TASK_PATTERNS = [
  { pattern: /implement|add|create|write|build|develop/i, label: "implementation" },
  { pattern: /fix|bug|error|issue|broken|failure|crash/i, label: "debugging" },
  { pattern: /refactor|restructure|reorganize|clean|optimize/i, label: "refactoring" },
  { pattern: /test|spec|assert|mock|coverage/i, label: "testing" },
  { pattern: /deploy|release|publish|ship|rollback/i, label: "deployment" },
  { pattern: /doc|readme|comment|explain|describe/i, label: "documentation" },
  { pattern: /config|setup|install|init|scaffold/i, label: "configuration" },
  { pattern: /research|explore|search|find|learn|understand/i, label: "research" },
  { pattern: /review|audit|inspect|check|validate/i, label: "review" },
  { pattern: /migrate|upgrade|update|moved|convert/i, label: "migration" },
];

function classifyTask(userMessage) {
  if (!userMessage) return "other";
  for (const { pattern, label } of TASK_PATTERNS) {
    if (pattern.test(userMessage)) return label;
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Plugin entrypoint
// ---------------------------------------------------------------------------
export default async function plugin(ctx) {
  const worktree = ctx?.worktree || ctx?.project?.worktree || process.cwd();
  const tgConfig = getTelegramConfig(ctx?.config);

  return {
    // ── Inject profile context into system prompt  ──
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        const profile = readProfile(worktree);
        const sections = [];

        // Communication preferences
        const comm = profile.communication;
        if (comm.verbosity || comm.formality || comm.technicalDepth) {
          const prefs = [];
          if (comm.verbosity) prefs.push(`verbosity: ${comm.verbosity}`);
          if (comm.formality) prefs.push(`formality: ${comm.formality}`);
          if (comm.technicalDepth) prefs.push(`technical depth: ${comm.technicalDepth}`);
          sections.push(`### User Communication Profile\nDetected preferences: ${prefs.join(", ")}.`);
        }

        // Explicit preferences
        const recentPrefs = profile.preferences.slice(-3);
        if (recentPrefs.length > 0) {
          sections.push(
            "### Stated Preferences",
            recentPrefs.map((p) => `- ${p.category}: ${p.key} = ${p.value}`).join("\n"),
          );
        }

        // Common tasks
        if (profile.commonTasks.length > 0) {
          const top = profile.commonTasks
            .sort((a, b) => b.frequency - a.frequency)
            .slice(0, 3);
          sections.push(
            "### Common Task Types",
            top.map((t) => `- ${t.pattern} (${t.frequency}x)`).join("\n"),
          );
        }

        if (sections.length > 0) {
          output.system.push("---", "### User Profile (auto-detected)", ...sections, "");
        }
      } catch (e) {
        console.error("[user-profiling] system.transform error:", e.message);
      }
    },

    // ── Track communication patterns per message  ──
    "experimental.chat.messages.transform": async (input, output) => {
      try {
        const sessionID = input?.sessionID || input?.messages?.[0]?.sessionID;
        if (!sessionID) return;

        const state = getSessionState(sessionID);

        // Analyze user messages
        const messages = input?.messages || [];
        const userMessages = messages.filter((m) => m.role === "user");

        for (const msg of userMessages) {
          const text = msg.content || "";
          state.messageCount++;
          state.totalMessageLength += text.length;

          // Detect technical terms
          const lower = text.toLowerCase();
          const words = lower.split(/\W+/);
          for (const word of words) {
            if (TECH_TERMS.has(word)) state.technicalTerms.add(word);
          }

          // Detect task type
          const taskType = classifyTask(text);
          if (taskType !== "other" && !state.taskTypes.includes(taskType)) {
            state.taskTypes.push(taskType);
          }

          state.lastMessageLength = text.length;
        }

        // Detect tool preferences
        // (tracked via tool.execute.after)

      } catch (e) {
        console.error("[user-profiling] messages.transform error:", e.message);
      }
    },

    "tool.execute.after": async (input) => {
      try {
        const state = getSessionState(input.sessionID);
        if (!state) return;

        state.toolCallCount++;
        state.toolsUsed.add(input.tool);
      } catch (e) {
        console.error("[user-profiling] tool.execute.after error:", e.message);
      }
    },

    tool: {
      // ── profile-summary ──
      "profile-summary": tool({
        description: "Show the current user profile — communication preferences, common tasks, and tool usage patterns.",
        args: {},
        async execute() {
          const profile = readProfile(worktree);
          const comm = profile.communication;

          return JSON.stringify({
            communication: {
              verbosity: comm.verbosity || "not yet detected",
              formality: comm.formality || "not yet detected",
              technicalDepth: comm.technicalDepth || "not yet detected",
            },
            preferences: profile.preferences.slice(-10).reverse(),
            commonTasks: profile.commonTasks.sort((a, b) => b.frequency - a.frequency).slice(0, 10),
            tools: profile.tools.sort((a, b) => b.frequency - a.frequency).slice(0, 10),
            sessionCount: profile.sessionCount,
            lastUpdated: profile.lastUpdated,
          });
        },
      }),

      // ── profile-preference ──
      "profile-preference": tool({
        description:
          "Record an explicit user preference. " +
          "This builds the user profile and is used to personalize agent behavior. " +
          "Categories include: communication, workflow, tools, environment, feedback.",
        args: {
          category: tool.schema.string().describe("Preference category (e.g. 'communication', 'workflow', 'tools', 'environment')"),
          key: tool.schema.string().describe("Preference name (e.g. 'preferred_language', 'response_verbosity')"),
          value: tool.schema.string().describe("Preference value (e.g. 'python', 'concise')"),
        },
        async execute(args) {
          const profile = readProfile(worktree);

          profile.preferences.push({
            category: args.category,
            key: args.key,
            value: args.value,
            recordedAt: new Date().toISOString(),
          });

          // Update communication profile for known keys
          if (args.category === "communication") {
            if (args.key === "verbosity") profile.communication.verbosity = args.value;
            if (args.key === "formality") profile.communication.formality = args.value;
            if (args.key === "technical_depth" || args.key === "technicalDepth") profile.communication.technicalDepth = args.value;
          }

          writeProfile(worktree, profile);

          if (tgConfig) {
            sendTelegramNotification(`<b>📋 Preference Recorded</b>\n${args.category}: <code>${args.key}</code> = ${args.value}`, tgConfig).catch(() => {});
          }

          return JSON.stringify({
            success: true,
            message: `Preference recorded: ${args.category} / ${args.key} = ${args.value}`,
            totalPreferences: profile.preferences.length,
          });
        },
      }),

      // ── profile-insights ──
      "profile-insights": tool({
        description:
          "Generate profile insights from session patterns. " +
          "Analyzes session data detected patterns in communication, tools, and tasks. " +
          "Updates the profile with new detections.",
        args: {},
        async execute() {
          const profile = readProfile(worktree);

          const insights = [];

          // Communication pattern analysis
          const verbosities = [];
          const formalityLevels = [];
          const techLevels = [];

          // We don't store per-message data across sessions, so we use
          // the currently accumulated session states
          for (const [, state] of sessionProfileState) {
            if (state.messageCount > 0) {
              const avgLen = state.totalMessageLength / state.messageCount;
              verbosities.push(avgLen > 300 ? "verbose" : avgLen > 80 ? "moderate" : "concise");

              // Technical depth from terms collected
              if (state.technicalTerms.size > 3) techLevels.push("high");
              else if (state.technicalTerms.size > 1) techLevels.push("medium");
              else techLevels.push("low");
            }
          }

          // Update profile with detected patterns
          if (verbosities.length > 0) {
            const mode = verbosities.sort((a, b) =>
              verbosities.filter((v) => v === a).length - verbosities.filter((v) => v === b).length
            ).pop();
            if (mode) profile.communication.verbosity = mode;
            insights.push(`Consistent ${mode} communication style`);
          }

          if (techLevels.length > 0) {
            const mode = techLevels.sort((a, b) =>
              techLevels.filter((v) => v === a).length - techLevels.filter((v) => v === b).length
            ).pop();
            if (mode) profile.communication.technicalDepth = mode;
            insights.push(`Technical depth: ${mode}`);
          }

          // Aggregate task types from session states
          const taskFreq = new Map();
          for (const [, state] of sessionProfileState) {
            for (const task of state.taskTypes) {
              taskFreq.set(task, (taskFreq.get(task) || 0) + 1);
            }
          }

          for (const [task, freq] of taskFreq) {
            const existing = profile.commonTasks.find((t) => t.pattern === task);
            if (existing) {
              existing.frequency += freq;
              existing.lastSeen = new Date().toISOString();
            } else {
              profile.commonTasks.push({
                pattern: task,
                frequency: freq,
                lastSeen: new Date().toISOString(),
              });
            }
          }

          // Aggregate tools
          for (const [, state] of sessionProfileState) {
            for (const toolName of state.toolsUsed) {
              const existing = profile.tools.find((t) => t.name === toolName);
              if (existing) {
                existing.frequency += 1;
                existing.lastSeen = new Date().toISOString();
              } else {
                profile.tools.push({
                  name: toolName,
                  frequency: 1,
                  lastSeen: new Date().toISOString(),
                });
              }
            }
          }

          profile.sessionCount += 1;
          writeProfile(worktree, profile);

          if (tgConfig && insights.length > 0) {
            sendTelegramNotification(`<b>📊 Profile Insights</b>\nSession ${profile.sessionCount}\n${insights.join("\n")}`, tgConfig).catch(() => {});
          }

          return JSON.stringify({
            success: true,
            insights: insights.length > 0 ? insights : ["Not enough data yet — keep using the agent to build profile."],
            profile: {
              communication: profile.communication,
              preferencesCount: profile.preferences.length,
              commonTasksCount: profile.commonTasks.length,
              toolsCount: profile.tools.length,
              totalSessions: profile.sessionCount,
            },
          });
        },
      }),
    },

    config: async (opencodeConfig) => {
      const perm = opencodeConfig.permission ?? {};
      for (const t of ["profile-summary", "profile-preference", "profile-insights"]) {
        if (typeof perm[t] === "undefined") {
          opencodeConfig.permission = { ...opencodeConfig.permission, [t]: "allow" };
        }
      }
    },
  };
}
