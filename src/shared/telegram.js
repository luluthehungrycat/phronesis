/**
 * Telegram notification utility for Phronesis plugins.
 *
 * Reads bot credentials from (in priority order):
 *   1. Explicit config object (opencode.json plugin config) — highest priority
 *   2. OPENCODE_TELEGRAM_HOME/.env — phronesis gateway convention (set by `phronesis gateway install`)
 *   3. ~/.config/phronesis/config.yaml (telegram.bot_token / telegram.chat_id keys)
 *   4. ~/.config/opencode-telegram-bot/.env — legacy Bot 1 fallback
 *   5. Environment variables (TELEGRAM_BOT_TOKEN / TELEGRAM_ALLOWED_USER_ID) — lowest priority
 */

import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const TELEGRAM_API = "https://api.telegram.org/bot";
const PHRONESIS_CONFIG_PATH = path.join(
  homedir(), ".config", "phronesis", "config.yaml"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read bot credentials from a standard .env file.
 * Expects TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_ID keys.
 * @param {string} filePath
 * @returns {{ token: string, chatId: string } | null}
 */
function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const tokenMatch = content.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
    const chatMatch = content.match(/^TELEGRAM_ALLOWED_USER_ID=(.+)$/m);
    if (tokenMatch && chatMatch) {
      return {
        token: tokenMatch[1].trim(),
        chatId: chatMatch[1].trim(),
      };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Parse telegram credentials from phronesis config.yaml.
 * Looks for a top-level `telegram:` section with `bot_token` and `chat_id`.
 *
 * Handles both quoted and unquoted YAML scalar values.
 * @param {string} yamlPath
 * @returns {{ token: string, chatId: string } | null}
 */
function readPhronesisTelegramConfig(yamlPath) {
  if (!fs.existsSync(yamlPath)) return null;
  try {
    const raw = fs.readFileSync(yamlPath, "utf-8");

    // Find the telegram: section — capture everything indented under it
    const sectionMatch = raw.match(
      /^telegram:\s*\n((?:\s{2,}[^\n]*\n)*)/m
    );
    if (!sectionMatch) return null;

    const body = sectionMatch[1];

    // Extract bot_token and chat_id values, handling quotes and comments
    const botMatch = body.match(/^\s{2}bot_token:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/m);
    const chatMatch = body.match(/^\s{2}chat_id:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/m);

    if (botMatch && chatMatch) {
      return {
        token: botMatch[1].trim(),
        chatId: chatMatch[1].trim(),
      };
    }
  } catch {
    // fall through
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve Telegram bot credentials.
 * @param {object} [pluginCfg={}] — Plugin config from opencode.json
 * @returns {{ token: string, chatId: string } | null}
 */
export function getTelegramConfig(pluginCfg = {}) {
  // 1. Plugin config (highest priority)
  if (pluginCfg.botToken && pluginCfg.chatId) {
    return { token: pluginCfg.botToken, chatId: String(pluginCfg.chatId) };
  }

  // 2. OPENCODE_TELEGRAM_HOME/.env (phronesis gateway convention)
  if (process.env.OPENCODE_TELEGRAM_HOME) {
    const envPath = path.join(process.env.OPENCODE_TELEGRAM_HOME, ".env");
    const result = readEnvFile(envPath);
    if (result) return result;
  }

  // 3. Phronesis global config (~/.config/phronesis/config.yaml)
  const yamlResult = readPhronesisTelegramConfig(PHRONESIS_CONFIG_PATH);
  if (yamlResult) return yamlResult;

  // 4. Legacy Bot 1 .env
  const bot1Env = path.join(homedir(), ".config", "opencode-telegram-bot", ".env");
  const legacyResult = readEnvFile(bot1Env);
  if (legacyResult) return legacyResult;

  // 5. Environment variables (lowest priority)
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ALLOWED_USER_ID) {
    return {
      token: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_ALLOWED_USER_ID,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Send a plain-text notification via the Telegram Bot API.
 * Notifications are silent (don't ping the user).
 *
 * @param {string} text          — Message body (UTF-8, supports HTML entities)
 * @param {{ token: string, chatId: string }} config
 * @param {object} [opts={}]
 * @param {boolean} [opts.silent=true] — disable_notification
 * @returns {Promise<boolean>}
 */
export async function sendTelegramNotification(text, config, opts = {}) {
  if (!config) return false;
  const silent = opts.silent !== false;

  try {
    const res = await fetch(`${TELEGRAM_API}${config.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: "HTML",
        disable_notification: silent,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "unknown");
      console.error("[telegram-notify] API error:", res.status, errBody.slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[telegram-notify] send failed:", e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/** Shortcut: send a skill-related notification. */
export async function notifySkillEvent(event, name, detail, config) {
  const icons = { created: "🧠", updated: "🔄", rated: "⭐" };
  const icon = icons[event] || "📌";
  const text = `<b>${icon} Skill ${event.charAt(0).toUpperCase() + event.slice(1)}</b>\n<code>${name}</code>\n${detail}`;
  return sendTelegramNotification(text, config);
}

/** Shortcut: send a memory-related notification. */
export async function notifyMemoryEvent(subject, detail, config) {
  const icons = { fact: "💾", observation: "📝", consolidation: "🔔", complete: "✅" };
  const icon = icons[subject] || "📌";
  const text = `<b>${icon} Memory ${subject.charAt(0).toUpperCase() + subject.slice(1)}</b>\n${detail}`;
  return sendTelegramNotification(text, config);
}
