/**
 * Telegram notification utility for Phronesis plugins.
 *
 * Reads bot credentials from:
 *   1. Explicit config object (opencode.json plugin config) — highest priority
 *   2. ~/.config/opencode-telegram-bot/.env — zero-config for existing bots
 *   3. Environment variables (TELEGRAM_BOT_TOKEN / TELEGRAM_ALLOWED_USER_ID) — fallback
 */

import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const TELEGRAM_API = "https://api.telegram.org/bot";

// ---------------------------------------------------------------------------
// Config resolution
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

  // 2. Read from bot-1's .env file
  const envPath = path.join(homedir(), ".config", "opencode-telegram-bot", ".env");
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, "utf-8");
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
  }

  // 3. Environment variables (lowest priority)
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
