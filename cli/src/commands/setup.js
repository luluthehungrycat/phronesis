import { createInterface } from "node:readline";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { opencodeAvailable } from "../lib/opencode.js";
import {
  getConfigKey,
  setConfigKey,
  getActiveProfile,
  writeProfileConfig,
  getProfileConfig,
  listProfiles,
  setActiveProfile,
} from "../lib/config.js";
import { ensureProfileDir, profileDir, profileTelegramEnvPath, profileScriptPath } from "../lib/paths.js";
import { writeFileSync as writeFile, chmodSync } from "node:fs";
import { VERSION } from "../constants.js";

function ask(query) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (a) => { rl.close(); resolve(a.trim()); }));
}

function askYesNo(query, default_ = true) {
  const hint = default_ ? "[Y/n]" : "[y/N]";
  return ask(`${query} ${hint} `).then((a) => (a ? a.toLowerCase().startsWith("y") : default_));
}

export const command = "setup";
export const describe = "Run the first-time setup wizard";
export const builder = {};

export async function handler(argv) {
  if (!process.stdout.isTTY) {
    console.log("[phronesis] non-interactive terminal — skipping setup wizard");
    return;
  }

  console.log(`
╔═══════════════════════════════╗
║       Phronesis v${VERSION.padEnd(5)}         ║
║   Hermes-inspired CLI setup   ║
╚═══════════════════════════════╝
`);

  // 1. Prerequisites
  console.log("Checking prerequisites...");
  const nodeMajor = Number(process.version.slice(1).split(".")[0]);
  if (nodeMajor < 18) {
    console.log(`  ❌ Node.js >= 18 required (found ${process.version})`);
    process.exit(1);
  }
  console.log(`  ✅ Node.js ${process.version}`);

  const ocAvailable = opencodeAvailable();
  if (!ocAvailable) {
    console.log("  ⚠️  opencode CLI not found in PATH");
    console.log("     Install OpenCode first: https://github.com/anomalyco/opencode");
    const proceed = await askYesNo("Continue without opencode?", false);
    if (!proceed) {
      console.log("[phronesis] setup cancelled");
      process.exit(1);
    }
  } else {
    console.log("  ✅ opencode CLI found");
  }

  // 2. Profile name
  const existing = listProfiles();
  const defaultName = existing.includes("default") ? "" : "default";
  let profileName = await ask(`Profile name ${defaultName ? `[${defaultName}]` : ""}: `);
  if (!profileName) profileName = defaultName || "default";

  if (existing.includes(profileName)) {
    console.log(`  ℹ️  Profile "${profileName}" already exists — updating settings`);
  }

  // 3. Create/extend profile
  ensureProfileDir(profileName);
  const existingCfg = getProfileConfig(profileName);
  const profileCfg = {
    ...existingCfg,
    name: profileName,
    description: existingCfg.description || "Created by phronesis setup",
    created: existingCfg.created || new Date().toISOString().slice(0, 10),
    server: existingCfg.server || {},
    gateways: existingCfg.gateways || {},
  };

  // 4. Server port
  const portStr = await ask(`OpenCode server port [${profileCfg.server?.port || 4097}]: `);
  const port = portStr ? parseInt(portStr, 10) : (profileCfg.server?.port || 4097);
  if (!isNaN(port) && port > 0 && port < 65536) {
    profileCfg.server.port = port;
  }

  // 5. Telegram bot
  const hasTelegram = existingCfg.gateways?.telegram?.bots?.length > 0;
  if (!hasTelegram) {
    const setupTelegram = await askYesNo("Configure a Telegram bot?", false);
    if (setupTelegram) {
      const botToken = await ask("Telegram bot token: ");
      if (botToken) {
        const userId = await ask("Your Telegram user ID (optional, for access control): ");
        const envContent = `BOT_TOKEN=${botToken}${userId ? `\nALLOWED_USER_ID=${userId}` : ""}\n`;
        writeFileSync(profileTelegramEnvPath(profileName, 1), envContent, "utf8");

        profileCfg.gateways.telegram = {
          bots: [{ id: 1, enabled: true }],
        };
        console.log("  ✅ Telegram bot configured");
      }
    }
  } else {
    console.log("  ℹ️  Telegram already configured");
  }

  // 6. Default model
  const currentModel = getConfigKey("defaults.model") || "anthropic/claude-sonnet-4";
  const model = await ask(`Default model [${currentModel}]: `);
  if (model) {
    setConfigKey("defaults.model", model);
  }

  writeProfileConfig(profileName, profileCfg);
  setActiveProfile(profileName);

  // 7. Profile shorthand
  const scriptPath = profileScriptPath(profileName);
  if (!existsSync(scriptPath)) {
    const createScript = await askYesNo(`Create "${profileName}" shortcut command?`, true);
    if (createScript) {
      const content = `#!/usr/bin/env bash
# Phronesis profile shorthand for "${profileName}"
exec phronesis "$@" --profile "${profileName}"
`;
      try {
        writeFileSync(scriptPath, content, "utf8");
        chmodSync(scriptPath, 0o755);
        console.log(`  ✅ Created shortcut at ${scriptPath}`);
        console.log(`  ℹ️  Ensure ~/.local/bin is in your PATH`);
      } catch (err) {
        console.log(`  ⚠️  Could not create shortcut: ${err.message}`);
      }
    }
  }

  console.log(`
┌─────────────────────────────────────────┐
│  ✅ Phronesis setup complete!           │
│                                         │
│  Profile:      ${profileName.padEnd(28)}│
│  Server port:  ${String(port || "").padEnd(28)}│
│  Config:       ${`~/.config/phronesis/profiles/${profileName}/`.padEnd(28)}│
└─────────────────────────────────────────┘
`);
  console.log("Next steps:");
  console.log(`  phronesis doctor          — verify everything works`);
  if (!ocAvailable) {
    console.log(`  Install OpenCode          — https://github.com/anomalyco/opencode`);
  }
  console.log(`  phronesis gateway install — set up Telegram gateway`);
  console.log("");
}
