#!/usr/bin/env node
/**
 * Phronesis Dashboard — web UI for browsing sessions, viewing config,
 * and checking gateway status.
 *
 * Usage: node index.js [--port 4099] [--profile <name>]
 *
 * Environment:
 *   PORT              - server port (default: 4099)
 *   PROFILE           - profile name to use (default: active profile)
 *   PHRONESIS_HOME    - config directory (default: ~/.config/phronesis)
 *
 * ---------------------------------------------------------------------------
 * Security model
 * ---------------------------------------------------------------------------
 *
 * The dashboard binds to 127.0.0.1 only (loopback). It is NOT exposed to
 * the network; tunnel externally via Tailscale, `ssh -L`, or similar.
 *
 * Three layered controls protect the gateway endpoints
 * (`/api/gateway/:action` and `/api/gateway/status`):
 *
 *   1. Origin / CSRF guard — the request `Origin` header must equal
 *      `http://127.0.0.1:<PORT>`. Browsers cannot forge Origin from
 *      cross-origin fetch/forms, so this blocks drive-by CSRF from
 *      a malicious local page. Requests with a missing or different
 *      Origin are rejected with HTTP 403.
 *
 *   2. Unit allowlist — only systemd user units matching
 *      `phronesis-gateway-*-telegram-*` (plus the legacy
 *      `opencode-telegram[-2]` fallback) are accepted by the action
 *      endpoint. The same naming convention is used by the CLI
 *      (`cli/src/cli.js:159`). An attacker who can speak to the
 *      loopback still cannot target `sshd`, `nginx`, etc.
 *
 *   3. Per-IP rate limiting — the gateway endpoints allow at most
 *      10 requests per minute per IP, enforced by an in-memory
 *      sliding-window counter. This limits abuse from a local
 *      attacker or a compromised browser tab.
 *
 * Read-only GET routes outside the gateway surface (sessions search,
 * config, profile) remain accessible to any local client. To expose
 * the dashboard remotely, run it behind an authenticating reverse
 * proxy (Tailscale serve, Caddy + OIDC, etc.).
 *
 * Error responses use `{ ok: false, error: "..." }`; success responses
 * add an `ok: true` flag and keep the pre-existing top-level fields
 * for backwards compatibility with the bundled dashboard UI.
 */

import { spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import express from "express";
import rateLimit from "express-rate-limit";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "4099", 10);
const PHRONESIS_HOME = process.env.PHRONESIS_HOME || join(homedir(), ".config", "phronesis");
const GLOBAL_CONFIG_PATH = join(PHRONESIS_HOME, "config.yaml");
const PROFILES_DIR = join(PHRONESIS_HOME, "profiles");

// ---------------------------------------------------------------------------
// Security constants
// ---------------------------------------------------------------------------

/**
 * Allowlist for systemd unit names accepted by /api/gateway/:action.
 *
 * Mirrors the naming convention in `cli/src/cli.js` (the `unitName()`
 * helper resolves `phronesis-gateway-<profile>-telegram-<id>` and
 * falls back to the legacy `opencode-telegram[-2]`).
 */
const ALLOWED_UNITS = /^(phronesis-gateway-[A-Za-z0-9_.-]+-telegram-[A-Za-z0-9_.-]+|opencode-telegram(-2)?)$/;

/** Loopback origin used for the CSRF / origin check on gateway endpoints. */
const LOOPBACK_ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * CSRF / origin check. Reject requests whose `Origin` header does not
 * match the loopback origin. Returns true if the request is allowed,
 * false if a 403 response has already been sent.
 */
function checkLoopbackOrigin(req, res) {
  const origin = req.headers.origin;
  if (origin !== LOOPBACK_ORIGIN) {
    res.status(403).json({ ok: false, error: `forbidden: origin must be ${LOOPBACK_ORIGIN}` });
    return false;
  }
  return true;
}

/**
 * Validate a user-supplied unit name against the allowlist. Strips an
 * optional `.service` suffix before matching so callers may pass either
 * form (`phronesis-gateway-default-telegram-1` or `...service`).
 * Returns the canonical name on success, or null on rejection.
 */
function validateUnit(unit) {
  if (typeof unit !== "string" || unit.length === 0 || unit.length > 200) return null;
  const canonical = unit.endsWith(".service") ? unit.slice(0, -".service".length) : unit;
  return ALLOWED_UNITS.test(canonical) ? canonical : null;
}

/**
 * Rate-limiter for gateway endpoints — 10 requests per minute per IP.
 * Uses express-rate-limit with standard `RateLimit-*` headers.
 */
const gatewayRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "rate limit exceeded" },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readYaml(path) {
  try {
    if (!existsSync(path)) return null;
    // Use Node to parse since we might not have js-yaml here — shell out to node
    const raw = readFileSync(path, "utf8");
    // Basic YAML parse via node — we can use js-yaml if available
    try {
      const result = spawnSync("node", [
        "-e",
        `const y = require("js-yaml"); console.log(JSON.stringify(y.load(process.stdin.read())));`,
      ], {
        input: raw,
        encoding: "utf8",
        timeout: 5000,
      });
      if (result.status === 0) return JSON.parse(result.stdout);
    } catch { /* fall through */ }
    return raw;
  } catch {
    return null;
  }
}

function findSearchDb(profileName) {
  const candidates = [];

  if (profileName) {
    candidates.push(join(PROFILES_DIR, profileName, "data", "phronesis_search.db"));
  }

  const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  candidates.push(join(xdgData, "opencode", "phronesis_search.db"));
  candidates.push(join(homedir(), ".local", "share", "opencode", "phronesis_search.db"));

  return candidates.find((p) => existsSync(p)) || null;
}

function findSqlite() {
  for (const bin of ["sqlite3", "sqlite"]) {
    const r = spawnSync("which", [bin], { encoding: "utf8", timeout: 3000 });
    if (r.status === 0) return bin;
  }
  return null;
}

function queryDb(dbPath, sql) {
  const sqlite = findSqlite();
  if (!sqlite) throw new Error("sqlite3 not found");

  const result = spawnSync(sqlite, ["-json", dbPath], {
    input: sql,
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.error) throw new Error(`SQLite error: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`SQLite exited ${result.status}`);
  return JSON.parse(result.stdout || "[]");
}

function findOpenCodeDb() {
  const candidates = [];
  const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  candidates.push(join(xdgData, "opencode", "opencode.db"));
  candidates.push(join(homedir(), ".local", "share", "opencode", "opencode.db"));
  return candidates.find((p) => existsSync(p)) || null;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// Static files
app.use(express.static(join(__dirname, "public")));

// Rate limiter for all /api/gateway/* routes
app.use("/api/gateway", gatewayRateLimiter);

// ---- API Routes ----

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Global config
app.get("/api/config", (_req, res) => {
  const raw = readYaml(GLOBAL_CONFIG_PATH);
  const parsed = typeof raw === "object" ? raw : null;
  res.json({
    path: GLOBAL_CONFIG_PATH,
    exists: existsSync(GLOBAL_CONFIG_PATH),
    config: parsed,
    raw: typeof raw === "string" ? raw : null,
  });
});

// Profile info
app.get("/api/profile", (req, res) => {
  // Read active profile from global config
  const globalConfig = readYaml(GLOBAL_CONFIG_PATH);
  const activeProfile = globalConfig?.active_profile || "default";

  // List profiles
  let profiles = [];
  try {
    const entries = readdirSync(PROFILES_DIR);
    profiles = entries.filter((e) => {
      const st = statSync(join(PROFILES_DIR, e));
      return st.isDirectory();
    });
  } catch { /* no profiles dir */ }

  // Read profile config
  const profileConfig = readYaml(join(PROFILES_DIR, activeProfile, "config.yaml"));

  res.json({
    active_profile: activeProfile,
    profiles,
    profile_config: typeof profileConfig === "object" ? profileConfig : null,
    profiles_dir: PROFILES_DIR,
  });
});

// Session search
app.get("/api/sessions/search", (req, res) => {
  try {
    const query = (req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const profileName = req.query.profile;

    if (!query) {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }

    const dbPath = findSearchDb(profileName);
    if (!dbPath) {
      return res.status(404).json({ error: "Search database not found. Run 'phronesis sessions rebuild' first." });
    }

    const escaped = query.replace(/'/g, "''");
    const ftsQuery = `"${escaped}"*`;

    const sql = [
      "SELECT session_id, session_title,",
      "snippet(session_search, 3, '<mark>', '</mark>', '...', 40) AS snippet",
      "FROM session_search",
      `WHERE session_search MATCH '${ftsQuery}'`,
      "ORDER BY rank",
      `LIMIT ${limit}`,
    ].join("\n");

    const rows = queryDb(dbPath, sql);
    res.json({ query, count: rows.length, results: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Session list
app.get("/api/sessions", (req, res) => {
  try {
    const profileName = req.query.profile;
    const dbPath = findSearchDb(profileName);
    if (!dbPath) {
      return res.status(404).json({ error: "Search database not found." });
    }

    const sql = "SELECT DISTINCT session_id, session_title FROM session_search ORDER BY session_title;";
    const rows = queryDb(dbPath, sql);
    res.json({ count: rows.length, sessions: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Session detail (from opencode.db)
app.get("/api/sessions/:id", (req, res) => {
  try {
    const dbPath = findOpenCodeDb();
    if (!dbPath) {
      return res.status(404).json({ error: "opencode.db not found." });
    }

    const sid = req.params.id.replace(/'/g, "''");

    // Get session info
    const sessionSql = `SELECT id, title, time_created FROM session WHERE id = '${sid}';`;
    const sessionRows = queryDb(dbPath, sessionSql);

    if (sessionRows.length === 0) {
      return res.status(404).json({ error: "Session not found." });
    }

    // Get messages
    const msgSql = [
      "SELECT m.id, m.session_id, json_extract(m.data, '$.role') AS role, m.time_created,",
      "group_concat(json_extract(p.data, '$.text'), '\n') AS text",
      "FROM message m",
      "LEFT JOIN part p ON p.message_id = m.id",
      `WHERE m.session_id = '${sid}'`,
      "GROUP BY m.id",
      "ORDER BY m.time_created;",
    ].join("\n");
    const msgRows = queryDb(dbPath, msgSql);

    res.json({
      session: sessionRows[0],
      messages: msgRows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gateway status (units listing) — gated by loopback-origin CSRF check.
// Rate limiting is handled by the /api/gateway middleware (10 req/min/IP).
app.get("/api/gateway/status", (req, res) => {
  if (!checkLoopbackOrigin(req, res)) return;

  try {
    const profileName = req.query.profile;

    // Check systemd user units
    const result = spawnSync("systemctl", ["--user", "list-units", "--type=service", "--all", "--no-legend"], {
      encoding: "utf8",
      timeout: 10000,
      stdio: "pipe",
    });

    const units = [];
    if (result.status === 0) {
      const lines = result.stdout.trim().split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
          const name = parts[0];
          // Only show phronesis-related services
          if (name.includes("phronesis") || name.includes("opencode-telegram") || name.includes("opencode-serve")) {
            units.push({
              name: parts[0],
              load: parts[1],
              active: parts[2],
              sub: parts[3],
              description: parts.slice(4).join(" ") || "",
            });
          }
        }
      }
    }

    res.json({
      ok: true,
      data: {
        profile: profileName || "default",
        systemctl_available: result.status === 0,
        units,
      },
      // Legacy top-level fields kept for backwards compat with the dashboard UI.
      profile: profileName || "default",
      systemctl_available: result.status === 0,
      units,
    });
  } catch (err) {
    res.json({
      ok: false,
      error: err.message,
      profile: req.query.profile || "default",
      systemctl_available: false,
      units: [],
    });
  }
});

// Gateway service action — gated by the loopback-origin CSRF check and the
// systemd unit allowlist. Validation order: origin → action → unit → spawn.
// Rate limiting is handled by the /api/gateway middleware (10 req/min/IP).
app.post("/api/gateway/:action", (req, res) => {
  if (!checkLoopbackOrigin(req, res)) return;

  const validActions = ["start", "stop", "restart", "status"];
  const action = req.params.action;

  if (!validActions.includes(action)) {
    return res.status(400).json({ ok: false, error: `Invalid action. Use: ${validActions.join(", ")}` });
  }

  const canonical = validateUnit(req.body && req.body.unit);
  if (!canonical) {
    return res.status(400).json({ ok: false, error: "unit not in allowlist" });
  }

  try {
    const result = spawnSync("systemctl", ["--user", action, canonical], {
      encoding: "utf8",
      timeout: 30000,
      stdio: "pipe",
    });

    res.json({
      ok: true,
      data: {
        action,
        unit: canonical,
        exitCode: result.status === null ? -1 : result.status,
        stdout: result.stdout?.trim() || "",
        stderr: result.stderr?.trim() || "",
      },
      // Legacy top-level fields kept for backwards compat with the dashboard UI.
      action,
      unit: canonical,
      status: result.status === 0 ? "success" : "error",
      stdout: result.stdout?.trim() || "",
      stderr: result.stderr?.trim() || "",
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---- Start ----

const server = createServer(app);
// loopback only; tunnel externally via Tailscale/SSH/ssh -L
server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Phronesis Dashboard running at ${url}`);
  console.log(`Config: ${GLOBAL_CONFIG_PATH}`);
  console.log("");

  // Try to open browser
  const openCmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start"
    : "xdg-open";
  try {
    spawn(openCmd, [url], { detached: true, stdio: "ignore" });
  } catch { /* no browser opener available */ }
});
