import { tool } from '@opencode-ai/plugin';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';
import { getTelegramConfig, sendTelegramNotification } from "../shared/telegram.js";

// ---------------------------------------------------------------------------
// FTS5 index builder — uses sqlite3 CLI (bypasses OpenCode's native module ban)
// ---------------------------------------------------------------------------

/**
 * Escape a value for safe use in SQL string literals.
 * SQLite: single quotes inside strings are doubled ('').
 * NULL -> NULL, everything else -> 'escaped'.
 */
function sqlEscape(val) {
  if (val === null || val === undefined) return 'NULL';
  return "'" + String(val).replace(/'/g, "''") + "'";
}

/**
 * Encode a value as a hex blob CAST to TEXT for use inside an INSERT.
 * The sqlite3 CLI cannot bind parameters through `.parameter set` for
 * values containing single quotes (the parser doesn't honour the `''`
 * escape inside string literals), so we round-trip the value through
 * a hex blob. The CLI lexer only ever sees hex digits and a fixed
 * structural template, so user data is stored as data, never as SQL.
 *
 * @param {*} s
 * @returns {string} SQL fragment usable as a VALUES expression
 */
function hexText(s) {
  if (s === null || s === undefined) return "CAST(X'' AS TEXT)";
  const hex = Buffer.from(String(s), "utf8").toString("hex");
  return `CAST(X'${hex}' AS TEXT)`;
}

/**
 * Build a single prepared-style INSERT statement for session_search.
 * Uses explicit column names (rather than positional VALUES) so the
 * statement is robust to schema column-order changes.
 */
function buildInsertSessionRow(sessionId, sessionTitle, role, text) {
  return (
    "INSERT INTO session_search(session_id, session_title, role, text) VALUES(" +
    hexText(sessionId) + ", " +
    hexText(sessionTitle) + ", " +
    hexText(role) + ", " +
    hexText(text) +
    ");"
  );
}

const SEARCH_DB_NAME = 'phronesis_search.db';

function searchDbPath() {
  const base = process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, 'opencode')
    : join(homedir(), '.local', 'share', 'opencode');
  return join(base, SEARCH_DB_NAME);
}

function opencodeDbPath() {
  const base = process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, 'opencode')
    : join(homedir(), '.local', 'share', 'opencode');
  return join(base, 'opencode.db');
}

/**
 * Run a sqlite3 command and return parsed JSON rows.
 * Uses spawnSync (NOT execSync) — sqlite3 arguments must be
 * passed as an array, not as part of the command string.
 */
function sql(query, dbPath, opts = {}) {
  const args = [];
  if (opts.readonly) args.push('-readonly');
  args.push('-json', dbPath, query);
  try {
    const result = spawnSync('sqlite3', args, { encoding: 'utf8', timeout: 10000 });
    if (result.error) {
      console.warn(`[session-search] sqlite3 error: ${result.error.message}`);
      return [];
    }
    if (result.status !== 0) {
      console.warn(`[session-search] sqlite3 exited with status ${result.status}: ${result.stderr?.trim()}`);
      return [];
    }
    return JSON.parse(result.stdout.trim() || '[]');
  } catch (err) {
    console.warn(`[session-search] sqlite3 parse error: ${err.message}`);
    return [];
  }
}

/**
 * Execute a sqlite3 command that returns no rows (CREATE, INSERT, DELETE).
 */
function sqlExec(query, dbPath) {
  try {
    const result = spawnSync('sqlite3', [dbPath, query], { encoding: 'utf8', timeout: 10000 });
    if (result.error) {
      console.warn(`[session-search] sqlite3 exec error: ${result.error.message}`);
      return false;
    }
    if (result.status !== 0) {
      console.warn(`[session-search] sqlite3 exec exited with status ${result.status}: ${result.stderr?.trim()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[session-search] sqlite3 exec error: ${err.message}`);
    return false;
  }
}

/**
 * Rebuild the FTS5 search index from the main opencode.db.
 * Uses sqlite3 CLI to avoid native module restrictions.
 */
function rebuildIndex() {
  const src = opencodeDbPath();
  if (!existsSync(src)) {
    console.warn('[session-search] opencode.db not found at', src);
    return;
  }

  const searchPath = searchDbPath();
  const dstDir = dirname(searchPath);
  if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });

  // Create FTS5 virtual table
  const createSql = `CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(
    session_id UNINDEXED,
    session_title,
    role UNINDEXED,
    text,
    tokenize='porter unicode61'
  );`;

  if (!sqlExec(createSql, searchPath)) {
    console.warn('[session-search] cannot create search index');
    return;
  }

  // Clear existing data
  sqlExec('DELETE FROM session_search', searchPath);

  // Index session messages (grouped by message, text concatenated)
  const msgQuery = `
    SELECT
      s.id AS session_id,
      s.title AS session_title,
      json_extract(m.data, '$.role') AS role,
      group_concat(json_extract(p.data, '$.text'), ' ') AS text
    FROM session s
    JOIN message m ON m.session_id = s.id
    JOIN part p ON p.message_id = m.id
    WHERE json_extract(p.data, '$.text') IS NOT NULL
      AND json_extract(p.data, '$.text') != ''
    GROUP BY m.id
    HAVING length(text) > 20
    ORDER BY m.time_created
  `;

  const msgRows = sql(msgQuery, src, { readonly: true });
  if (msgRows.length > 0) {
    // Use hex-encoded values (CAST(X'...' AS TEXT)) so user data is never
    // parsed as SQL by the sqlite3 CLI — the lexer only ever sees hex
    // digits and a fixed structural template. The original sqlEscape
    // helper remained correct for SQL string literals, but the prepared-
    // statement pattern is a stronger invariant for untrusted inputs.
    const inserts = msgRows.map((r) =>
      buildInsertSessionRow(
        r.session_id,
        r.session_title,
        r.role,
        r.text
      )
    );
    sqlExec("BEGIN;\n" + inserts.join("\n") + "\nCOMMIT;", searchPath);
  }

  // Index session titles
  const titleQuery = `
    SELECT id AS session_id, title AS session_title, NULL AS role, title AS text
    FROM session
    WHERE title NOT LIKE 'New session%'
  `;
  const titleRows = sql(titleQuery, src, { readonly: true });
  if (titleRows.length > 0) {
    // Same hex-encoded prepared-statement pattern as the message loop.
    // All rows are wrapped in a single BEGIN/COMMIT transaction.
    const inserts = titleRows.map((r) =>
      buildInsertSessionRow(
        r.session_id,
        r.session_title,
        r.role,
        r.text
      )
    );
    sqlExec("BEGIN;\n" + inserts.join("\n") + "\nCOMMIT;", searchPath);
  }

  console.log(`[session-search] indexed ${msgRows.length} messages + ${titleRows.length} titles`);
}

/**
 * Query the FTS5 search index.
 */
function searchIndex(query, limit = 10) {
  const searchPath = searchDbPath();
  if (!existsSync(searchPath)) {
    rebuildIndex();
    if (!existsSync(searchPath)) {
      return [];
    }
  }

  // Sanitize FTS5 query: escape special chars, add prefix matching
  const sanitized = query
    .replace(/['"]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .trim();

  if (!sanitized) return [];

  const terms = sanitized.split(/\s+/).filter(Boolean);
  const ftsQuery = terms.map(t => `"${t}"*`).join(' AND ');

  const searchSql = `
    SELECT
      session_id,
      session_title,
      rank,
      snippet(session_search, 3, '<<', '>>', '...', 40) AS snippet_text
    FROM session_search
    WHERE session_search MATCH ${sqlEscape(ftsQuery)}
    ORDER BY rank
    LIMIT ${Math.min(limit, 100)}
  `;

  const rows = sql(searchSql, searchPath, { readonly: true });

  // Deduplicate by session_id, keep best snippet
  const seen = new Set();
  const deduped = [];
  for (const r of rows) {
    if (!seen.has(r.session_id)) {
      seen.add(r.session_id);
      deduped.push(r);
    }
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// Plugin entrypoint
// ---------------------------------------------------------------------------

export default {
  id: 'session-search',
  server: async () => {
    const tgConfig = getTelegramConfig();

    return {
      tool: {
        'search-sessions': tool({
          description: `Search past OpenCode sessions by natural language query.
Returns relevant session excerpts with session IDs, titles, and matching text snippets.
Use this when you need to recall how something was done before, find past solutions,
or reference previous work.`,
          args: {
            query: tool.schema.string().describe('Natural language search query (e.g. "how to set up auth middleware", "docker compose deployment")'),
            limit: tool.schema.number().optional().default(5).describe('Maximum number of results to return (default: 5, max: 20)'),
          },
          async execute(args) {
            const { query, limit } = args;
            const results = searchIndex(query, Math.min(limit || 5, 20));

            if (results.length === 0) {
              return `No sessions found matching "${query}". Try different keywords or check that the session search index has been built (it updates automatically).`;
            }

            if (tgConfig) {
              sendTelegramNotification(`<b>🔍 Session Search</b>\n<code>${query}</code>\n${results.length} result(s) found`, tgConfig).catch(() => {});
            }

            let output = `## Session Search Results\n\n**Query:** ${query}\n\nFound ${results.length} matching session(s):\n\n`;
            for (let i = 0; i < results.length; i++) {
              const r = results[i];
              output += `### ${i + 1}. ${r.session_title}\n`;
              output += `**Session ID:** \`${r.session_id}\`\n`;
              output += `**Relevance:** ${(r.rank !== undefined && r.rank !== null) ? r.rank.toFixed(4) : 'N/A'}\n`;
              output += `**Match:** ${r.snippet_text}\n\n`;
            }

            output += `Use \`/search-sessions\` with a different query to refine results.`;
            return output;
          },
        }),
      },
    };
  },
};
