# Notification System

Phronesis plugins can send Telegram notifications for key events — skill creation, memory consolidation, overdue alerts, and feedback milestones. Notifications are **opt-in**, **silent** (no user ping), and **fire-and-forget** (failures are logged but never crash the agent).

---

## Architecture

```
┌──────────────────────────┐     POST /bot<token>/sendMessage
│  Plugin A (skill-creator)│─────────────────────────────┐
│  Plugin B (memory-...)   │────────────────────────────┐│
│  Plugin C (future)       │───────────────────────────┐││
└──────────────────────────┘                           │││
                                                        ▼▼▼
                                                ┌─────────────────┐
                                                │  Telegram API   │
                                                │  api.telegram.  │
                                                │  org            │
                                                └────────┬────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │  User's Telegram│
                                                │  (silent msg)   │
                                                └─────────────────┘
```

All notifications go through `src/shared/telegram.js` which provides:
- `getTelegramConfig(pluginConfig)` — resolves credentials from 3 sources
- `sendTelegramNotification(text, config, opts)` — sends via Bot API
- `notifySkillEvent(event, name, detail, config)` / `notifyMemoryEvent(subject, detail, config)` — convenience wrappers (available but not yet used by any plugin)

---

## Configuration

### Source Priority (1 = highest)

| Priority | Source | How to Set |
|----------|--------|------------|
| 1 | Plugin config in `opencode.json` | `"plugins": { "config": { "botToken": "...", "chatId": "..." } }` |
| 2 | `~/.config/opencode-telegram-bot/.env` | `TELEGRAM_BOT_TOKEN=...` + `TELEGRAM_ALLOWED_USER_ID=...` |
| 3 | Environment variables | `export TELEGRAM_BOT_TOKEN=...` + `TELEGRAM_ALLOWED_USER_ID=...` |

Priority 2 is the **recommended default** — if you already have a working Telegram bot via `@grinev/opencode-telegram-bot`, notifications work automatically with zero additional config.

### Plugin Config Example

```json
{
  "plugins": {
    "file:///home/user/phronesis/src/memory-consolidation": {
      "config": {
        "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        "chatId": "8582610783"
      }
    }
  }
}
```

---

## Events That Fire Notifications

### Skill Creator (`src/skill-creator/index.js`)

| Event | When | Message Content |
|-------|------|----------------|
| **Skill Created** | `save-skill` creates a new skill | `🧠 Skill Created — <name> — <description/trigger>` |
| **Skill Updated** | `save-skill` with `update: true` | `🔄 Skill Updated — <name> — <description/trigger>` |
| **Skill Rated** | `skill-feedback` on milestones (1st, 5th, 10th, 20th... rating) | `⭐ Skill Rated — <name> — <score>/5 — Average: X.X/5 — (optional comment)` |

Milestones: 1st rating (always), 5th, 10th, then every 10th (20, 30, 40...).

### Memory Consolidation (`src/memory-consolidation/index.js`)

| Event | When | Message Content |
|-------|------|----------------|
| **Fact Stored** | `add-fact` creates a new fact | `💾 Fact Stored — [category] — content (truncated to 200 chars)` |
| **Fact Updated** | `add-fact` updates existing duplicate fact | `💾 Fact Updated — [category] — content (truncated)` |
| **Observations Stored** | `add-observations` with 1+ items | `📝 Observations Stored — N observation(s) on topic "X"` |
| **Consolidation Needed** | `consolidate-memory` finds unprocessed sessions | `🔔 Consolidation Needed — N unconsolidated session(s) found` |
| **Sessions Marked** | `mark-consolidated` with session count | `✅ Sessions Marked Consolidated — N session(s)` |
| **Overdue Alert** | System transform detects overdue consolidation (throttled) | `🔔 Consolidation Overdue — N session(s) unconsolidated — Interval: Xh` |

The **overdue alert** is throttled to once per overdue cycle via the `overdueAlertSent` flag. When consolidation is completed (`mark-consolidated` or the flag in system.transform), the throttle resets and a new alert can fire if overdue re-occurs.

---

## Adding Notifications to a Plugin

### Step 1: Import

```javascript
import { getTelegramConfig, sendTelegramNotification } from "../shared/telegram.js";
```

### Step 2: Resolve config at plugin init

```javascript
export default async function plugin(ctx) {
  const tgConfig = getTelegramConfig(ctx?.config);
  // ...
}
```

### Step 3: Fire notification where appropriate

```javascript
// Inside a tool's execute function:
sendTelegramNotification(
  `<b>📌 Event Title</b>\nDetails about what happened`,
  tgConfig
).catch(() => {}); // fire-and-forget — never break the agent
```

### Best Practices

1. **Always `.catch(() => {})`** — network failures should never crash the tool
2. **Use fire-and-forget** — don't `await`, don't block the tool response on notification delivery
3. **Keep messages short** — Telegram has a 4096 character limit; truncate long content
4. **Use HTML parse_mode** — `<b>bold</b>`, `<code>inline code</code>`, `<i>italic</i>` (no markdown)
5. **Throttle aggressive events** — use a flag like `overdueAlertSent` to prevent flooding
6. **Check `tgConfig` is non-null** — `sendTelegramNotification` already handles null config (returns false), but the `getTelegramConfig` call at plugin init is the right place to check

---

## Troubleshooting

### No notifications arriving

1. **Verify the bot can message you**: Send `/start` to your bot in Telegram first
2. **Check the .env file exists**:
   ```bash
   ls -la ~/.config/opencode-telegram-bot/.env
   ```
3. **Verify credentials are correct**:
   ```bash
   grep TELEGRAM_BOT_TOKEN ~/.config/opencode-telegram-bot/.env
   grep TELEGRAM_ALLOWED_USER_ID ~/.config/opencode-telegram-bot/.env
   ```
4. **Check plugin logs** (OpenCode logs) for `[telegram-notify]` errors:
   ```bash
   journalctl -u opencode-serve.service --no-pager | grep "telegram-notify"
   ```

### Known non-issues

- **Silent mode**: Notifications have `disable_notification: true` by default. They won't make a sound or vibrate your phone. Set `opts.silent: false` in `sendTelegramNotification()` for high-priority alerts.
- **HTML formatting**: If you see raw `<b>` tags in the message, the bot may not support `parse_mode: HTML`. This is a Telegram Bot API limitation with certain clients.
