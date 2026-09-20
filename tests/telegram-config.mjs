import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

const home = mkdtempSync(join("/tmp", "phronesis-telegram-"));
process.env.HOME = home;
const gatewayHome = join(home, "gateway");
const legacyHome = join(home, ".config", "opencode-telegram-bot");
const phronesisHome = join(home, ".config", "phronesis");
mkdirSync(gatewayHome, { recursive: true });
mkdirSync(legacyHome, { recursive: true });
mkdirSync(phronesisHome, { recursive: true });

const { getTelegramConfig } = await import("../src/shared/telegram.js");

function clearSources() {
  delete process.env.OPENCODE_TELEGRAM_HOME;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_ALLOWED_USER_ID;
  rmSync(join(gatewayHome, ".env"), { force: true });
  rmSync(join(legacyHome, ".env"), { force: true });
  rmSync(join(phronesisHome, "config.yaml"), { force: true });
}

test("Telegram config respects explicit plugin configuration", () => {
  clearSources();
  process.env.TELEGRAM_BOT_TOKEN = "env-token";
  process.env.TELEGRAM_ALLOWED_USER_ID = "env-chat";
  assert.deepEqual(getTelegramConfig({ botToken: "explicit-token", chatId: 123 }), {
    token: "explicit-token",
    chatId: "123",
  });
});

test("Telegram config reads the gateway env file before global config", () => {
  clearSources();
  process.env.OPENCODE_TELEGRAM_HOME = gatewayHome;
  writeFileSync(join(gatewayHome, ".env"), "TELEGRAM_BOT_TOKEN=gateway-token\nTELEGRAM_ALLOWED_USER_ID=gateway-chat\n");
  writeFileSync(join(phronesisHome, "config.yaml"), "telegram:\n  bot_token: yaml-token\n  chat_id: yaml-chat\n");
  assert.deepEqual(getTelegramConfig(), { token: "gateway-token", chatId: "gateway-chat" });
});

test("Telegram config falls back through YAML, legacy env, and process env", () => {
  clearSources();
  writeFileSync(join(phronesisHome, "config.yaml"), "telegram:\n  bot_token: yaml-token\n  chat_id: yaml-chat\n");
  assert.deepEqual(getTelegramConfig(), { token: "yaml-token", chatId: "yaml-chat" });

  rmSync(join(phronesisHome, "config.yaml"));
  writeFileSync(join(legacyHome, ".env"), "TELEGRAM_BOT_TOKEN=legacy-token\nTELEGRAM_ALLOWED_USER_ID=legacy-chat\n");
  assert.deepEqual(getTelegramConfig(), { token: "legacy-token", chatId: "legacy-chat" });

  rmSync(join(legacyHome, ".env"));
  process.env.TELEGRAM_BOT_TOKEN = "env-token";
  process.env.TELEGRAM_ALLOWED_USER_ID = "env-chat";
  assert.deepEqual(getTelegramConfig(), { token: "env-token", chatId: "env-chat" });
});

after(() => {
  rmSync(home, { recursive: true, force: true });
});
