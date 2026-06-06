import { tool } from "@opencode-ai/plugin";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { getTelegramConfig, sendTelegramNotification } from "../shared/telegram.js";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Local SQLite Memory Store — always active, no configuration needed
// ---------------------------------------------------------------------------
const MEMORY_DIR = path.join(homedir(), ".local", "share", "opencode");
const MEMORY_DB = "phronesis_memory.db";

function dbPath() {
  const dir = MEMORY_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, MEMORY_DB);
}

let db = null;

function getDb() {
  if (db) return db;
  const Database = loadBetterSqlite3();
  if (!Database) {
    throw new Error("better-sqlite3 not available — cannot initialize local memory");
  }
  db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

function loadBetterSqlite3() {
  try {
    return require("better-sqlite3");
  } catch {
    return null;
  }
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      confidence REAL DEFAULT 1.0,
      source_session_id TEXT,
      source TEXT DEFAULT 'auto',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      access_count INTEGER DEFAULT 0
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
      content, category,
      content=facts, content_rowid=id
    );

    CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
      INSERT INTO facts_fts(rowid, content, category)
      VALUES (new.id, new.content, new.category);
    END;

    CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
      INSERT INTO facts_fts(facts_fts, rowid, content, category)
      VALUES ('delete', old.id, old.content, old.category);
    END;

    CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
      INSERT INTO facts_fts(facts_fts, rowid, content, category)
      VALUES ('delete', old.id, old.content, old.category);
      INSERT INTO facts_fts(rowid, content, category)
      VALUES (new.id, new.content, new.category);
    END;

    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      session_id TEXT,
      topic TEXT DEFAULT 'general',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
      content, topic,
      content=observations, content_rowid=id
    );

    CREATE TRIGGER IF NOT EXISTS obs_ai AFTER INSERT ON observations BEGIN
      INSERT INTO observations_fts(rowid, content, topic)
      VALUES (new.id, new.content, new.topic);
    END;

    CREATE TRIGGER IF NOT EXISTS obs_ad AFTER DELETE ON observations BEGIN
      INSERT INTO observations_fts(observations_fts, rowid, content, topic)
      VALUES ('delete', old.id, old.content, old.topic);
    END;

    CREATE TABLE IF NOT EXISTS seen_sessions (
      session_id TEXT PRIMARY KEY,
      title TEXT,
      tool_count INTEGER DEFAULT 0,
      consolidated INTEGER DEFAULT 0,
      first_seen TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS consolidation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      triggered_by TEXT DEFAULT 'manual',
      sessions_processed INTEGER DEFAULT 0,
      facts_added INTEGER DEFAULT 0,
      observations_added INTEGER DEFAULT 0,
      supermemory_synced INTEGER DEFAULT 0,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      status TEXT DEFAULT 'running'
    );
  `);
}

// ---------------------------------------------------------------------------
// Plugin config schema (settable in opencode.json plugin config)
// ---------------------------------------------------------------------------
let pluginConfig = {
  supermemory_url: "",
  supermemory_api_key: "",
  consolidation_interval_hours: 6,
  max_facts_in_context: 5,
};

// ---------------------------------------------------------------------------
// Supermemory push (optional, non-blocking)
// ---------------------------------------------------------------------------
async function pushToSupermemory(payload) {
  if (!pluginConfig.supermemory_url) return { pushed: false, reason: "not configured" };
  try {
    const headers = { "Content-Type": "application/json" };
    if (pluginConfig.supermemory_api_key) {
      headers["Authorization"] = `Bearer ${pluginConfig.supermemory_api_key}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(pluginConfig.supermemory_url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { pushed: res.ok, status: res.status };
  } catch (e) {
    return { pushed: false, reason: e.message };
  }
}

// ---------------------------------------------------------------------------
// Periodic heartbeat — flags when consolidation is overdue
// ---------------------------------------------------------------------------
let heartbeatHandle = null;
let consolidationOverdue = false;

function startHeartbeat() {
  if (heartbeatHandle) clearInterval(heartbeatHandle);
  // Check every 30 minutes if consolidation has happened recently
  const intervalMs = 30 * 60 * 1000;
  heartbeatHandle = setInterval(() => {
    try {
      const database = getDb();
      const lastRun = database.prepare(
        "SELECT completed_at FROM consolidation_log WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1"
      ).get();
      if (lastRun) {
        const hoursSince = (Date.now() - new Date(lastRun.completed_at + "Z").getTime()) / (1000 * 60 * 60);
        consolidationOverdue = hoursSince > pluginConfig.consolidation_interval_hours;
      } else {
        consolidationOverdue = true; // never consolidated
      }
    } catch {
      consolidationOverdue = false;
    }
  }, intervalMs);
}

function stopHeartbeat() {
  if (heartbeatHandle) {
    clearInterval(heartbeatHandle);
    heartbeatHandle = null;
  }
}

// ---------------------------------------------------------------------------
// Build fact context for system prompt
// ---------------------------------------------------------------------------
function buildFactContext(userInput, maxFacts) {
  try {
    const database = getDb();

    // If we have user input, search for relevant facts
    let facts = [];
    if (userInput && userInput.trim().length > 0) {
      // Simple keyword match via FTS5 (no LLM needed here)
      const terms = userInput
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3)
        .map((w) => `"${w}"`)
        .join(" OR ");

      if (terms) {
        facts = database.prepare(`
          SELECT f.id, f.content, f.category, f.confidence
          FROM facts_fts fts
          JOIN facts f ON f.rowid = fts.rowid
          WHERE facts_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(terms, maxFacts);
      }
    }

    // If no relevant facts, get most accessed
    if (facts.length === 0) {
      facts = database.prepare(`
        SELECT id, content, category, confidence
        FROM facts
        ORDER BY access_count DESC
        LIMIT ?
      `).all(maxFacts);
    }

    // Update access counts
    for (const fact of facts) {
      database.prepare("UPDATE facts SET access_count = access_count + 1 WHERE id = ?").run(fact.id);
    }

    return facts;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Plugin entrypoint
// ---------------------------------------------------------------------------
export default async function plugin(ctx) {

  // Initialize DB on load (non-blocking — will lazy-init on first access)
  try { getDb(); } catch { /* will init on first tool use */ }

  // Read optional config from plugin options
  if (ctx?.config) {
    if (ctx.config.supermemory_url) pluginConfig.supermemory_url = ctx.config.supermemory_url;
    if (ctx.config.supermemory_api_key) pluginConfig.supermemory_api_key = ctx.config.supermemory_api_key;
    if (ctx.config.consolidation_interval_hours) pluginConfig.consolidation_interval_hours = ctx.config.consolidation_interval_hours;
    if (ctx.config.max_facts_in_context) pluginConfig.max_facts_in_context = ctx.config.max_facts_in_context;
  }

  const tgConfig = getTelegramConfig(ctx?.config);

  startHeartbeat();

  // Clean up heartbeat on plugin unload (best-effort)
  process.on("exit", stopHeartbeat);

  return {
    // ── Track seen sessions for consolidation awareness ──
    "experimental.session.compacting": async (input) => {
      try {
        const database = getDb();
        const sid = input?.sessionID;
        if (!sid) return;

        database.prepare(`
          INSERT INTO seen_sessions (session_id, title, last_seen)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(session_id) DO UPDATE SET
            last_seen = datetime('now'),
            tool_count = COALESCE(seen_sessions.tool_count, 0) + 1
        `).run(sid, input?.title || "");
      } catch (e) {
        console.error("[memory-consolidation] session.compacting error:", e.message);
      }
    },

    // ── Inject relevant memory context into system prompt ──
    "experimental.chat.system.transform": async (input, output) => {
      try {
        const database = getDb();

        // Count stats
        const factCount = database.prepare("SELECT COUNT(*) as c FROM facts").get()?.c || 0;
        const obsCount = database.prepare("SELECT COUNT(*) as c FROM observations").get()?.c || 0;
        const unconsolidated = database.prepare(
          "SELECT COUNT(*) as c FROM seen_sessions WHERE consolidated = 0"
        ).get()?.c || 0;

        const parts = [];
        parts.push("---");
        parts.push("### Persistent Memory System");
        parts.push(
          `You have access to a local memory store (${factCount} facts, ${obsCount} observations). ` +
          `${unconsolidated} session(s) have not yet been reviewed for knowledge extraction.`
        );
        parts.push("");

        // Add consolidation guidance if overdue
        if (consolidationOverdue && unconsolidated > 0) {
          parts.push(
            "**⚠️ Consolidation Recommended**: Unprocessed sessions are accumulating. " +
            "Consider using `consolidate-memory` to extract durable facts from recent sessions."
          );
          parts.push("");

          // Fire-and-forget Telegram alert (throttled via overdue flag — only fires once per interval)
          sendTelegramNotification(
            `<b>🔔 Consolidation Overdue</b>\n` +
            `${unconsolidated} session(s) unconsolidated. ` +
            `Interval: ${pluginConfig.consolidation_interval_hours}h. ` +
            `Use \`consolidate-memory\` to extract knowledge.`,
            tgConfig
          ).catch(() => {});
        }

        // Inject relevant facts into context
        const userInput = input?.messages?.slice(-1)?.[0]?.content || "";
        const relevantFacts = buildFactContext(userInput, pluginConfig.max_facts_in_context);

        if (relevantFacts.length > 0) {
          parts.push("**Relevant Stored Knowledge for This Task:**");
          for (const fact of relevantFacts) {
            parts.push(`- [${fact.category}] ${fact.content}`);
          }
          parts.push("");
        }

        // Memory management tools overview
        parts.push(
          "**Memory Tools Available:**",
          "- `add-fact` — store a durable fact (always local, pushes to supermemory if configured)",
          "- `add-observations` — batch store observations from a session",
          "- `search-facts` — search stored facts (FTS5 full-text search)",
          "- `list-facts` — browse stored facts by category",
          "- `forget-fact` — remove a fact",
          "- `consolidate-memory` — review recent sessions and extract knowledge",
          "- `memory-stats` — view memory status and stats",
          "",
          "**Guideline:** After completing significant work (new patterns, learned preferences, " +
          "environment changes), store a fact so it's available in future sessions. " +
          "The local store persists independently — supermemory is an optional secondary sync.",
        );

        output.system.push(...parts);
      } catch (e) {
        console.error("[memory-consolidation] system.transform error:", e.message);
      }
    },

    // ── Register memory management tools ──
    tool: {
      // ── add-fact ──
      "add-fact": tool({
        description:
          "Store a durable fact in persistent memory. Facts are knowledge that should be " +
          "available across sessions — user preferences, project conventions, environment details, " +
          "decisions made, patterns learned. Stored locally by default; if supermemory is configured, " +
          "also syncs there.",
        args: {
          content: tool.schema
            .string()
            .describe("The factual statement to remember (e.g., 'User prefers PostgreSQL over MySQL for new projects')"),
          category: tool.schema
            .string()
            .optional()
            .default("general")
            .describe("Category: general, preference, convention, environment, decision, pattern, config, todo"),
          confidence: tool.schema
            .number()
            .min(0)
            .max(1)
            .optional()
            .default(1.0)
            .describe("Confidence in this fact (0-1, default 1.0)"),
          source_session: tool.schema
            .string()
            .optional()
            .describe("Optional session ID where this fact was discovered"),
        },
        async execute(args, _context) {
          try {
            const database = getDb();

            // Check for duplicate (same content)
            const existing = database.prepare(
              "SELECT id FROM facts WHERE content = ?"
            ).get(args.content);

            if (existing) {
              // Update confidence and refresh timestamp
              database.prepare(`
                UPDATE facts SET confidence = ?, updated_at = datetime('now'), access_count = access_count + 1
                WHERE id = ?
              `).run(args.confidence, existing.id);
            } else {
              database.prepare(`
                INSERT INTO facts (content, category, confidence, source_session_id)
                VALUES (?, ?, ?, ?)
              `).run(args.content, args.category, args.confidence, args.source_session || null);
            }

            // Optional supermemory push (non-blocking)
            const supermemoryResult = await pushToSupermemory({
              content: args.content,
              category: args.category,
              source: "opencode-memory-consolidation",
              session_id: args.source_session,
            });

            // Fire-and-forget Telegram notification
            sendTelegramNotification(
              `<b>💾 Fact ${existing ? "Updated" : "Stored"}</b>\n` +
              `[${args.category}] ${args.content.slice(0, 200)}`,
              tgConfig
            ).catch(() => {});

            return JSON.stringify({
              success: true,
              action: existing ? "updated" : "created",
              fact: args.content,
              category: args.category,
              supermemory: supermemoryResult.pushed
                ? "synced"
                : `not synced (${supermemoryResult.reason || supermemoryResult.status || "not configured"})`,
              message: existing
                ? `Fact updated (confidence: ${args.confidence})`
                : `Fact stored locally${supermemoryResult.pushed ? " and synced to supermemory" : ""}.`,
            });
          } catch (e) {
            return JSON.stringify({ success: false, message: e.message });
          }
        },
      }),

      // ── add-observations ──
      "add-observations": tool({
        description:
          "Batch store multiple observations from a session. Observations are lighter than facts — " +
          "they capture raw insights before they're distilled into durable facts.",
        args: {
          observations: tool.schema
            .string()
            .describe("JSON array of observation strings, or a single observation string"),
          session: tool.schema
            .string()
            .optional()
            .describe("Optional session ID"),
          topic: tool.schema
            .string()
            .optional()
            .default("general")
            .describe("Topic label for this batch of observations"),
        },
        async execute(args, _context) {
          try {
            const database = getDb();
            let items;
            try {
              items = JSON.parse(args.observations);
              if (!Array.isArray(items)) items = [items];
            } catch {
              items = [args.observations];
            }

            const insert = database.prepare(
              "INSERT INTO observations (content, session_id, topic) VALUES (?, ?, ?)"
            );
            const tx = database.transaction((obs) => {
              let count = 0;
              for (const o of obs) {
                if (o && o.trim()) {
                  insert.run(o.trim(), args.session || null, args.topic);
                  count++;
                }
              }
              return count;
            });

            const count = tx(items);

            // Fire-and-forget Telegram notification
            sendTelegramNotification(
              `<b>📝 Observations Stored</b>\n${count} observation(s) on topic "${args.topic}"`,
              tgConfig
            ).catch(() => {});

            return JSON.stringify({
              success: true,
              stored: count,
              message: `${count} observation(s) stored locally.`,
            });
          } catch (e) {
            return JSON.stringify({ success: false, message: e.message });
          }
        },
      }),

      // ── search-facts ──
      "search-facts": tool({
        description:
          "Full-text search across stored facts. Uses FTS5 for fast keyword matching. " +
          "Results are ranked by relevance.",
        args: {
          query: tool.schema
            .string()
            .describe("Search query — natural language or keywords"),
          limit: tool.schema
            .number()
            .optional()
            .default(10)
            .describe("Maximum results to return"),
          category: tool.schema
            .string()
            .optional()
            .describe("Filter by category (general, preference, convention, environment, decision, pattern, config, todo)"),
        },
        async execute(args, _context) {
          try {
            const database = getDb();

            const terms = args.query
              .toLowerCase()
              .split(/[^a-z0-9]+/)
              .filter((w) => w.length > 2)
              .map((w) => `"${w}"`)
              .join(" OR ");

            if (!terms) {
              // Fallback: return recent facts
              const facts = database.prepare(
                "SELECT id, content, category, confidence, created_at, access_count FROM facts ORDER BY created_at DESC LIMIT ?"
              ).all(args.limit);

              return JSON.stringify({ success: true, query: args.query, count: facts.length, facts });
            }

            let query = `
              SELECT f.id, f.content, f.category, f.confidence, f.created_at, f.access_count
              FROM facts_fts fts
              JOIN facts f ON f.rowid = fts.rowid
              WHERE facts_fts MATCH ?
            `;
            const params = [terms];

            if (args.category) {
              query += " AND f.category = ?";
              params.push(args.category);
            }

            query += " ORDER BY rank LIMIT ?";
            params.push(args.limit);

            const facts = database.prepare(query).all(...params);

            // Update access counts
            for (const fact of facts) {
              database.prepare("UPDATE facts SET access_count = access_count + 1 WHERE id = ?").run(fact.id);
            }

            return JSON.stringify({
              success: true,
              query: args.query,
              category: args.category || "all",
              count: facts.length,
              facts,
            });
          } catch (e) {
            return JSON.stringify({ success: false, message: e.message });
          }
        },
      }),

      // ── list-facts ──
      "list-facts": tool({
        description:
          "Browse stored facts with optional category filter. Shows content, category, confidence, " +
          "creation date, and access count.",
        args: {
          category: tool.schema
            .string()
            .optional()
            .describe("Filter by category: general, preference, convention, environment, decision, pattern, config, todo"),
          sort: tool.schema
            .string()
            .optional()
            .default("recent")
            .describe("Sort order: recent, accessed, confident, alphabetical"),
          limit: tool.schema
            .number()
            .optional()
            .default(20)
            .describe("Maximum facts to return"),
        },
        async execute(args, _context) {
          try {
            const database = getDb();

            let query = "SELECT id, content, category, confidence, created_at, access_count FROM facts";
            const params = [];

            if (args.category) {
              query += " WHERE category = ?";
              params.push(args.category);
            }

            switch (args.sort) {
              case "accessed": query += " ORDER BY access_count DESC"; break;
              case "confident": query += " ORDER BY confidence DESC"; break;
              case "alphabetical": query += " ORDER BY content ASC"; break;
              default: query += " ORDER BY created_at DESC";
            }

            query += " LIMIT ?";
            params.push(args.limit);

            const facts = database.prepare(query).all(...params);

            // Get category breakdown
            const categories = database.prepare(
              "SELECT category, COUNT(*) as count FROM facts GROUP BY category ORDER BY count DESC"
            ).all();

            return JSON.stringify({
              success: true,
              category: args.category || "all",
              sort: args.sort,
              count: facts.length,
              total: database.prepare("SELECT COUNT(*) as c FROM facts").get().c,
              categories,
              facts,
            });
          } catch (e) {
            return JSON.stringify({ success: false, message: e.message });
          }
        },
      }),

      // ── forget-fact ──
      "forget-fact": tool({
        description:
          "Remove a fact from memory. Provide the fact ID (from search-facts or list-facts) to delete.",
        args: {
          id: tool.schema
            .number()
            .describe("The fact ID to remove (from search-facts or list-facts)"),
        },
        async execute(args, _context) {
          try {
            const database = getDb();
            const existing = database.prepare("SELECT id, content FROM facts WHERE id = ?").get(args.id);

            if (!existing) {
              return JSON.stringify({ success: false, message: `No fact with ID ${args.id} found.` });
            }

            database.prepare("DELETE FROM facts WHERE id = ?").run(args.id);

            return JSON.stringify({
              success: true,
              removed: existing.content,
              message: `Fact #${args.id} removed from memory.`,
            });
          } catch (e) {
            return JSON.stringify({ success: false, message: e.message });
          }
        },
      }),

      // ── consolidate-memory ──
      "consolidate-memory": tool({
        description:
          "Review unprocessed sessions and store important knowledge as durable facts. " +
          "Call this when significant work has been done to ensure knowledge persists " +
          "across sessions. The tool logs a consolidation run — you then use `add-fact` " +
          "or `add-observations` to store what you've learned, and finally mark sessions " +
          "as consolidated.",
        args: {
          sessions_to_review: tool.schema
            .number()
            .optional()
            .default(5)
            .describe("Number of recent unconsolidated sessions to consider"),
        },
        async execute(args, _context) {
          try {
            const database = getDb();

            // Start a consolidation run
            const runResult = database.prepare(`
              INSERT INTO consolidation_log (triggered_by, started_at, status)
              VALUES (?, datetime('now'), 'running')
            `).run("tool");

            const runId = runResult.lastInsertRowid;

            // Get unconsolidated sessions
            const sessions = database.prepare(`
              SELECT session_id, title, tool_count, first_seen, last_seen
              FROM seen_sessions
              WHERE consolidated = 0
              ORDER BY last_seen DESC
              LIMIT ?
            `).all(args.sessions_to_review);

            // We can't read opencode.db directly here (too complex),
            // but we provide the session list to the agent which can
            // explore them using other tools if needed

            // Fire-and-forget Telegram notification
            if (sessions.length > 0) {
              sendTelegramNotification(
                `<b>🔔 Consolidation Needed</b>\n` +
                `${sessions.length} unconsolidated session(s) found.\n` +
                `Use \`consolidate-memory\` then \`add-fact\` to extract knowledge.`,
                tgConfig
              ).catch(() => {});
            }

            return JSON.stringify({
              success: true,
              run_id: Number(runId),
              sessions_found: sessions.length,
              sessions,
              guidance:
                `Found ${sessions.length} unconsolidated sessions. Review the sessions above and ` +
                `use \`add-fact\` to store any important knowledge you find. ` +
                `Then use \`mark-consolidated\` to mark sessions as processed.`,
            });
          } catch (e) {
            return JSON.stringify({ success: false, message: e.message });
          }
        },
      }),

      // ── mark-consolidated ──
      "mark-consolidated": tool({
        description:
          "Mark one or more sessions as consolidated. Used after extracting knowledge " +
          "from sessions via consolidate-memory. Provide a session ID or 'all' to mark all " +
          "unconsolidated sessions.",
        args: {
          session_id: tool.schema
            .string()
            .describe("Session ID to mark, or 'all' to mark all unconsolidated sessions"),
        },
        async execute(args, _context) {
          try {
            const database = getDb();

            let count;
            if (args.session_id === "all") {
              const result = database.prepare(`
                UPDATE seen_sessions SET consolidated = 1 WHERE consolidated = 0
              `).run();
              count = result.changes;
            } else {
              const result = database.prepare(`
                UPDATE seen_sessions SET consolidated = 1 WHERE session_id = ?
              `).run(args.session_id);
              count = result.changes;
            }

            // Finalize the latest open consolidation run
            database.prepare(`
              UPDATE consolidation_log
              SET completed_at = datetime('now'), status = 'completed',
                  sessions_processed = ?
              WHERE status = 'running'
              ORDER BY started_at DESC LIMIT 1
            `).run(count);

            consolidationOverdue = false;

            // Fire-and-forget Telegram notification
            sendTelegramNotification(
              `<b>✅ Consolidation Complete</b>\n${count} session(s) marked as consolidated.`,
              tgConfig
            ).catch(() => {});

            return JSON.stringify({
              success: true,
              marked: count,
              message: `${count} session(s) marked as consolidated.`,
            });
          } catch (e) {
            return JSON.stringify({ success: false, message: e.message });
          }
        },
      }),

      // ── memory-stats ──
      "memory-stats": tool({
        description:
          "View memory store statistics — total facts, observations, sessions tracked, " +
          "consolidation status, category breakdown, and recent consolidation runs.",
        args: {},
        async execute(_args, _context) {
          try {
            const database = getDb();

            const factCount = database.prepare("SELECT COUNT(*) as c FROM facts").get().c;
            const obsCount = database.prepare("SELECT COUNT(*) as c FROM observations").get().c;
            const totalSessions = database.prepare("SELECT COUNT(*) as c FROM seen_sessions").get().c;
            const unconsolidated = database.prepare(
              "SELECT COUNT(*) as c FROM seen_sessions WHERE consolidated = 0"
            ).get().c;

            const categories = database.prepare(
              "SELECT category, COUNT(*) as count FROM facts GROUP BY category ORDER BY count DESC"
            ).all();

            const lastConsolidation = database.prepare(
              "SELECT started_at, completed_at, sessions_processed, facts_added, status " +
              "FROM consolidation_log ORDER BY started_at DESC LIMIT 3"
            ).all();

            const mostAccessed = database.prepare(
              "SELECT content, category, access_count FROM facts ORDER BY access_count DESC LIMIT 5"
            ).all();

            return JSON.stringify({
              success: true,
              local: {
                facts: factCount,
                observations: obsCount,
                sessions_tracked: totalSessions,
                unconsolidated_sessions: unconsolidated,
                categories,
                top_facts: mostAccessed,
              },
              supermemory: pluginConfig.supermemory_url
                ? { configured: true, url: pluginConfig.supermemory_url }
                : { configured: false },
              consolidation: {
                history: lastConsolidation,
                interval_hours: pluginConfig.consolidation_interval_hours,
                overdue: consolidationOverdue,
              },
            });
          } catch (e) {
            return JSON.stringify({ success: false, message: e.message });
          }
        },
      }),
    },

    // ── Register memory permission ──
    config: async (opencodeConfig) => {
      const permission = opencodeConfig.permission ?? {};
      if (typeof permission.memory === "undefined") {
        opencodeConfig.permission = { ...permission, memory: "allow" };
      }
    },
  };
}
