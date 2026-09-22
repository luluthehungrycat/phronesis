import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import * as versionCmd from "./commands/version.js";
import * as configCmd from "./commands/config.js";
import * as profileCmd from "./commands/profile.js";
import * as migrateCmd from "./commands/migrate.js";
import * as completionCmd from "./commands/completion.js";
import * as doctorCmd from "./commands/doctor.js";
import * as setupCmd from "./commands/setup.js";
import * as sendCmd from "./commands/send.js";
import * as createPluginCmd from "./commands/create-plugin.js";
import * as pluginCmd from "./commands/plugin.js";
import * as dashboardCmd from "./commands/dashboard.js";
import { opencode, opencodeRun, systemctl, journalctl, resolveProfile, resolveOpenCodeBinary } from "./lib/opencode.js";
import { getProfileConfig } from "./lib/config.js";
import { searchSessions, listSessions, rebuildSearchIndex } from "./lib/search.js";
import { profileDir } from "./lib/paths.js";
import * as upgradeCmd from "./commands/upgrade.js";
import * as initCmd from "./commands/init.js";
import { spinner } from "./lib/spinner.js";
import { enhanceError } from "./lib/error-helpers.js";

/**
 * Build yargs-compatible options from argv for the opencode wrapper.
 * Extracts the shared --profile / --port / --url flags.
 */
function opencodeOpts(argv, extra = {}) {
  return { profile: argv.profile, port: argv.port, url: argv.url, ...extra };
}

/**
 * Configure and return the yargs CLI.
 * Does NOT parse — that's the caller's job.
 */
function buildCli() {
  return yargs(hideBin(process.argv))
    .scriptName("phronesis")
    .usage("$0 [--profile <name>] [--port <port>] [--url <url>] <command> [options]")

    // Global options
    .option("profile", {
      describe: "Use a specific profile",
      type: "string",
      alias: "p",
    })
    .option("port", {
      describe: "OpenCode server port (overrides profile config)",
      type: "number",
    })
    .option("url", {
      describe: "OpenCode server URL (overrides profile config and --port)",
      type: "string",
    })

    // Core commands
    .command(
      ["$0", "chat [query]"],
      "Start an interactive session or send a single query",
      (yargs) => {
        yargs.positional("query", {
          describe: "Optional query (non-interactive mode)",
          type: "string",
        });
      },
      async (argv) => {
        const profile = resolveProfile(argv.profile);
        const args = argv.query ? [argv.query] : [];

        console.error(`[phronesis] using profile: ${profile}`);
        try {
          await opencode(args, opencodeOpts(argv, { interactive: true }));
        } catch (err) {
          console.error(`[phronesis] opencode error: ${err.message}`);
          process.exit(1);
        }
      }
    )
    .command(
      "continue",
      "Continue the most recent session",
      () => {},
      async (argv) => {
        const profile = resolveProfile(argv.profile);
        try {
          await opencode(["continue"], opencodeOpts(argv, { interactive: true }));
        } catch (err) {
          console.error(`[phronesis] opencode error: ${err.message}`);
          process.exit(1);
        }
      }
    )
    .command(
      "fork",
      "Fork the most recent session",
      () => {},
      async (argv) => {
        const profile = resolveProfile(argv.profile);
        try {
          await opencode(["fork"], opencodeOpts(argv, { interactive: true }));
        } catch (err) {
          console.error(`[phronesis] opencode error: ${err.message}`);
          process.exit(1);
        }
      }
    )

    // Subcommand groups (module objects)
    .command(versionCmd)
    .command(configCmd)
    .command(profileCmd)
    .command(completionCmd)
    .command(doctorCmd)
    .command(setupCmd)
    .command(sendCmd)
    .command(pluginCmd)
    .command(dashboardCmd)

    // Gateway command
    .command(
      "gateway <action>",
      "Manage Telegram gateways for the active profile",
      (yargs) => {
        yargs
          .positional("action", {
            describe: "Action: status, start, stop, restart, logs, install, uninstall",
            choices: ["status", "start", "stop", "restart", "logs", "install", "uninstall"],
          })
          .option("profile", {
            describe: "Target profile",
            type: "string",
          });
      },
      (argv) => {
        const profile = resolveProfile(argv.profile);
        const profileCfg = getProfileConfig(profile);
        const bots = profileCfg?.gateways?.telegram?.bots || [
          { id: 1, enabled: true },
          { id: 2, enabled: true },
        ];

        const targetBots = bots.filter((b) => b.enabled);

        if (targetBots.length === 0) {
          console.log(`[phronesis] no enabled gateways for profile "${profile}"`);
          return;
        }

        /**
         * Resolve the systemd unit name for a bot.
         * Tries phronesis-gateway-<profile>-telegram-<id> first,
         * falls back to opencode-telegram[-2].
         */
        function unitName(botId) {
          const profileUnit = `phronesis-gateway-${profile}-telegram-${botId}`;
          const legacyUnit = botId === 1 ? "opencode-telegram" : "opencode-telegram-2";
          return { profileUnit, legacyUnit };
        }

        for (const bot of targetBots) {
          const { profileUnit, legacyUnit } = unitName(bot.id);

          switch (argv.action) {
            case "status": {
              console.log(`[phronesis] gateway "${profile}" bot ${bot.id}:`);
              try {
                const out = systemctl("status", profileUnit, { profile });
                console.log(out || "  (inactive)");
              } catch {
                try {
                  const out = systemctl("status", legacyUnit, { profile });
                  console.log(out || "  (inactive)");
                } catch {
                  console.log(`  (no systemd service found — use "phronesis gateway install")`);
                }
              }
              break;
            }

            case "start":
            case "stop":
            case "restart": {
              try {
                systemctl(argv.action, profileUnit, { profile, interactive: true });
              } catch {
                systemctl(argv.action, legacyUnit, { profile, interactive: true });
              }
              break;
            }

            case "logs": {
              function showLogs(unit) {
                const out = journalctl(["-u", unit, "-n", "50", "--no-pager"], { profile });
                if (!out || out.includes("No entries")) return null;
                console.log(out);
                return out;
              }
              const result = showLogs(profileUnit) || showLogs(legacyUnit);
              if (!result) {
                console.log(`  (no logs — gateway service not found. Use "phronesis gateway install")`);
              }
              break;
            }

            case "install": {
              const bin = resolveOpenCodeBinary();
              const pDir = profileDir(profile);
              const unitFileName = `${profileUnit}.service`;
              const unitDir = join(homedir(), ".config", "systemd", "user");
              const unitPath = join(unitDir, unitFileName);

              if (!existsSync(unitDir)) mkdirSync(unitDir, { recursive: true });

              const unitContent = [
                "[Unit]",
                `Description=Phronesis Telegram Gateway - Profile: ${profile} Bot ${bot.id}`,
                "After=network.target",
                "",
                "[Service]",
                "Type=simple",
                `ExecStart=${bin} serve --profile ${profile}`,
                "Restart=on-failure",
                `Environment=OPENCODE_HOME=${pDir}`,
                `Environment=OPENCODE_TELEGRAM_HOME=${pDir}/gateways`,
                "",
                "[Install]",
                "WantedBy=default.target",
              ].join("\n") + "\n";

              writeFileSync(unitPath, unitContent, "utf8");

              try {
                const dr = spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8", timeout: 15000 });
                if (dr.error) throw enhanceError(dr.error, { command: "systemctl daemon-reload" });
                systemctl("enable", profileUnit, { profile, interactive: true });
                systemctl("start", profileUnit, { profile, interactive: true });
                console.log(`[phronesis] Gateway "${profile}" bot ${bot.id} installed and started.`);
              } catch (err) {
                console.log(`[phronesis] Unit written to ${unitPath}`);
                const msg = err.originalError ? err.message : "";
                if (msg) console.error(`[phronesis] ${msg}`);
                console.log(`[phronesis] Run on the host (outside container) to activate:\n` +
                  `  systemctl --user daemon-reload\n` +
                  `  systemctl --user enable --now ${profileUnit}`);
              }
              break;
            }

            case "uninstall": {
              try { systemctl("stop", profileUnit, { profile }); } catch {}
              try { systemctl("disable", profileUnit, { profile }); } catch {}
              const unitFileName = `${profileUnit}.service`;
              const unitPath = join(homedir(), ".config", "systemd", "user", unitFileName);
              if (existsSync(unitPath)) {
                unlinkSync(unitPath);
                try {
                  const dr = spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8", timeout: 15000 });
                  if (dr.error) throw enhanceError(dr.error, { command: "systemctl daemon-reload" });
                } catch {}
              }
              console.log(`[phronesis] Gateway "${profile}" bot ${bot.id} uninstalled.`);
              break;
            }
          }
        }
      }
    )

    // Skills command
    .command(
      "skills <action> [name]",
      "Manage Phronesis skills",
      (yargs) => {
        yargs
          .positional("action", {
            describe: "Action: list, install, update, feedback",
            choices: ["list", "install", "update", "feedback"],
          })
          .positional("name", {
            describe: "Skill name (for install/update/feedback)",
            type: "string",
          })
          .option("score", {
            describe: "Rating 1-5 (for 'feedback')",
            type: "number",
          })
          .option("comment", {
            describe: "Optional comment (for 'feedback')",
            type: "string",
          });
      },
      (argv) => {
        const profile = resolveProfile(argv.profile);

        switch (argv.action) {
          case "list":
            try {
              const result = opencodeRun("list-skills", [], opencodeOpts(argv, { silent: true }));
              console.log(result || "(no skills found)");
            } catch {
              console.log("(opencode not available — skills list requires active opencode server)");
            }
            break;
          case "install":
            if (!argv.name) {
              console.error("Usage: phronesis skills install <name>");
              process.exit(1);
            }
            try {
              const result = opencodeRun("install-skill", [argv.name], opencodeOpts(argv, { silent: true }));
              console.log(result || `Skill "${argv.name}" installed.`);
            } catch (err) {
              console.error(`Failed to install skill: ${err.message}`);
            }
            break;

          case "update":
            if (!argv.name) {
              console.error("Usage: phronesis skills update <name>");
              process.exit(1);
            }
            try {
              const result = opencodeRun("update-skill", [argv.name], opencodeOpts(argv, { silent: true }));
              console.log(result || `Skill "${argv.name}" updated.`);
            } catch (err) {
              console.error(`Failed to update skill: ${err.message}`);
            }
            break;

          case "feedback":
            if (!argv.name || !argv.score) {
              console.error("Usage: phronesis skills feedback <name> --score <1-5> [--comment <text>]");
              process.exit(1);
            }
            try {
              const args = [argv.name, String(argv.score)];
              if (argv.comment) args.push(argv.comment);
              const result = opencodeRun("skill-feedback", args, opencodeOpts(argv, { silent: true }));
              console.log(result || `Feedback recorded for skill "${argv.name}".`);
            } catch (err) {
              console.error(`Failed to record feedback: ${err.message}`);
            }
            break;
        }
      }
    )

    // Sessions command
    .command(
      "sessions <action> [query]",
      "Browse and search sessions",
      (yargs) => {
        yargs
          .positional("action", {
            describe: "Action: list, search, rebuild",
            choices: ["list", "search", "rebuild"],
          })
          .positional("query", {
            describe: "Search query (for 'search')",
            type: "string",
          })
          .option("limit", {
            describe: "Max results (for 'search')",
            type: "number",
            default: 10,
          })
          .option("json", {
            describe: "Output as JSON",
            type: "boolean",
            default: false,
          })
          .option("overwrite", {
            describe: "Drop and rebuild the index (for 'rebuild')",
            type: "boolean",
            default: false,
          });
      },
      (argv) => {
        const profile = resolveProfile(argv.profile);

        switch (argv.action) {
          case "search":
            if (!argv.query) {
              console.error("Usage: phronesis sessions search <query>");
              process.exit(1);
            }
            try {
              const profileCfg = getProfileConfig(profile);
              const result = searchSessions(argv.query, {
                profile,
                dbPath: profileCfg?.search?.db_path,
                limit: argv.limit || 10,
                format: argv.json ? "json" : "text",
              });
              console.log(result);
            } catch (err) {
              console.error(`Search error: ${err.message}`);
            }
            break;
          case "list":
            try {
              const profileCfg = getProfileConfig(profile);
              const result = listSessions({
                profile,
                dbPath: profileCfg?.search?.db_path,
                format: argv.json ? "json" : "text",
              });
              console.log(result);
            } catch (err) {
              console.error(`List error: ${err.message}`);
            }
            break;
          case "rebuild": {
            const profileCfg = getProfileConfig(profile);
            const spin = spinner("Rebuilding search index...");
            try {
              const result = rebuildSearchIndex({
                profile,
                dbPath: profileCfg?.search?.db_path,
                overwrite: argv.overwrite,
              });
              spin.succeed("Search index rebuilt");
              console.log(result);
            } catch (err) {
              spin.fail(`Rebuild failed: ${err.message}`);
            }
            break;
          }
        }
      }
    )

    // Plugin scaffolding
    .command(createPluginCmd)

    // Migration (Phase 2)
    .command(migrateCmd)
    .command(upgradeCmd)
    .command(initCmd)

    // Error handling
    .fail((msg, err) => {
      if (err) {
        process.exit(1);
      }
      console.error(`\n${msg}`);
      console.error("\nFor help, run: phronesis --help\n");
      process.exit(1);
    })

    .help()
    .alias("help", "h")
    .version(false)
    .strict()
    .wrap(Math.min(120, process.stdout.columns || 120));
}

export const cli = buildCli();
