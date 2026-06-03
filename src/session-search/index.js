import { tool } from '@opencode-ai/plugin';
import { z } from 'zod';
import { createRequire } from 'module';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { readFileSync, existsSync, mkdirSync } from 'fs';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// DB helpers — uses built-in Node.js sqlite (experimental) or better-sqlite3
// ---------------------------------------------------------------------------

function openDb(path) {
  // Prefer better-sqlite3 if available (bundled by opencode), fallback to
  // built-in node:sqlite (Node 22+) or a simple JSON cache.
  try {
    const dblite = require('better-sqlite3');
    const db = new dblite(path, { readonly: true, fileMustExist: true });
    // Enable WAL-friendly reads
    db.pragma('journal_mode = WAL');
    return { db, close: () => db.close(), query, all, get };
  } catch {
    // Fallback: use node:sqlite (experimental, Node 22+)
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path, { readOnly: true });
    return { db, close: () => db.close(), query, all: db.prepare.bind(db), get: db.prepare.bind(db) };
  }
}

// ---------------------------------------------------------------------------
// FTS5 index builder
// ---------------------------------------------------------------------------

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
 * Rebuild the FTS5 search index from the main opencode.db.
 * Reads session → message → part, concatenates text per message,
 * and inserts into an FTS5 virtual table stored in a sidecar DB.
 */
function rebuildIndex() {
  const src = opencodeDbPath();
  if (!existsSync(src)) {
    console.warn('[session-search] opencode.db not found at', src);
    return;
  }

  let srcDb;
  try {
    srcDb = require('better-sqlite3')(src, { readonly: true, fileMustExist: true });
    srcDb.pragma('journal_mode = WAL');
  } catch {
    console.warn('[session-search] cannot open opencode.db (maybe locked)');
    return;
  }

  const searchPath = searchDbPath();
  const dstDir = dirname(searchPath);
  if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });

  let dstDb;
  try {
    dstDb = require('better-sqlite3')(searchPath);
  } catch {
    console.warn('[session-search] cannot create search index DB');
    srcDb.close();
    return;
  }

  // Create FTS5 virtual table if it doesn't exist
  dstDb.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(
      session_id UNINDEXED,
      session_title,
      role UNINDEXED,
      text,
      tokenize='porter unicode61'
    );
  `);

  // Clear and repopulate
  dstDb.exec('DELETE FROM session_search');

  const insert = dstDb.prepare(
    `INSERT INTO session_search(session_id, session_title, role, text) VALUES (?, ?, ?, ?)`
  );

  const insertMany = dstDb.transaction((rows) => {
    for (const r of rows) {
      insert.run(r.session_id, r.session_title, r.role, r.text);
    }
  });

  // Query: for each message with text parts, create a search row
  // We join session → message → part, grouping parts per message
  const rows = srcDb.prepare(`
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
  `).all();

  if (rows.length > 0) {
    insertMany(rows);
  }

  // Also index session titles for quick lookup
  const titleRows = srcDb.prepare(`
    SELECT id AS session_id, title AS session_title, NULL AS role, title AS text
    FROM session
    WHERE title NOT LIKE 'New session%'
  `).all();

  if (titleRows.length > 0) {
    insertMany(titleRows);
  }

  console.log(`[session-search] indexed ${rows.length} messages + ${titleRows.length} titles`);
  dstDb.close();
  srcDb.close();
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

  let db;
  try {
    db = require('better-sqlite3')(searchPath, { readonly: true });
  } catch {
    return [];
  }

  // Sanitize FTS5 query: escape special chars, add prefix matching
  const sanitized = query
    .replace(/['"]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .trim();

  if (!sanitized) {
    db.close();
    return [];
  }

  // Build FTS5 query: use term prefix matching
  const terms = sanitized.split(/\s+/).filter(Boolean);
  const ftsQuery = terms.map(t => `"${t}"*`).join(' AND ');

  try {
    const rows = db.prepare(`
      SELECT
        session_id,
        session_title,
        rank,
        snippet(session_search, 2, '<<', '>>', '...', 40) AS snippet_text
      FROM session_search
      WHERE session_search MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit);

    // Deduplicate by session_id, keep best snippet
    const seen = new Set();
    const deduped = [];
    for (const r of rows) {
      if (!seen.has(r.session_id)) {
        seen.add(r.session_id);
        deduped.push(r);
      }
    }

    db.close();
    return deduped;
  } catch (err) {
    console.warn('[session-search] query failed:', err.message);
    db.close();
    return [];
  }
}

// ---------------------------------------------------------------------------
// Plugin entrypoint
// ---------------------------------------------------------------------------

export default function () {
  // Build index on plugin load (async, fire and forget)
  try {
    rebuildIndex();
  } catch (err) {
    console.warn('[session-search] initial index build failed:', err.message);
  }

  return {
    tool: [
      tool({
        name: 'search-sessions',
        description: `Search past OpenCode sessions by natural language query.
Returns relevant session excerpts with session IDs, titles, and matching text snippets.
Use this when you need to recall how something was done before, find past solutions,
or reference previous work.`,
        args: {
          query: z.string().describe('Natural language search query (e.g. "how to set up auth middleware", "docker compose deployment")'),
          limit: z.number().optional().default(5).describe('Maximum number of results to return (default: 5, max: 20)'),
        },
        execute: async ({ query, limit }) => {
          const results = searchIndex(query, Math.min(limit || 5, 20));

          if (results.length === 0) {
            return `No sessions found matching "${query}". Try different keywords or check that the session search index has been built (it updates automatically).`;
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
    ],
  };
}
