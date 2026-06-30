import { tool } from "@opencode-ai/plugin";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getTelegramConfig, sendTelegramNotification } from "../shared/telegram.js";

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------
const CONFIG_PATH = path.join(
  process.env.HOME || "/root",
  ".config/opencode/remote-execution-targets.json"
);

function loadTargets() {
  const targets = new Map();

  // Always include local
  targets.set("local", { label: "local", type: "local" });

  // Load from config file if it exists
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      if (Array.isArray(raw.targets)) {
        for (const t of raw.targets) {
          if (t.label && t.type) {
            targets.set(t.label, t);
          }
        }
      }
    } catch (e) {
      console.error("[remote-execution] failed to load targets:", e.message);
    }
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Execution helpers
// ---------------------------------------------------------------------------
function executeLocal(command, timeout) {
  const start = Date.now();
  try {
    const stdout = execSync(command, {
      encoding: "utf-8",
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout.trimEnd(), stderr: "", exitCode: 0, duration: Date.now() - start };
  } catch (e) {
    return {
      stdout: e.stdout?.toString().trimEnd() || "",
      stderr: e.stderr?.toString().trimEnd() || e.message,
      exitCode: e.status ?? 1,
      duration: Date.now() - start,
    };
  }
}

function executeContainer(target, command, timeout) {
  const runtime = target.runtime || "docker";
  const container = target.address;

  if (!container) {
    return { stdout: "", stderr: "No container address specified in target config", exitCode: 1, duration: 0 };
  }

  // Build the exec command — quote the remote command safely
  const fullCmd = `${runtime} exec ${container} sh -c ${JSON.stringify(command)}`;
  const start = Date.now();

  try {
    const stdout = execSync(fullCmd, {
      encoding: "utf-8",
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout.trimEnd(), stderr: "", exitCode: 0, duration: Date.now() - start };
  } catch (e) {
    return {
      stdout: e.stdout?.toString().trimEnd() || "",
      stderr: e.stderr?.toString().trimEnd() || e.message,
      exitCode: e.status ?? 1,
      duration: Date.now() - start,
    };
  }
}

function executeSSH(target, command, timeout) {
  const userHost = target.address;

  if (!userHost) {
    return { stdout: "", stderr: "No SSH address specified in target config", exitCode: 1, duration: 0 };
  }

  const fullCmd = `ssh -o ConnectTimeout=10 -o BatchMode=yes ${userHost} ${JSON.stringify(command)}`;
  const start = Date.now();

  try {
    const stdout = execSync(fullCmd, {
      encoding: "utf-8",
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout.trimEnd(), stderr: "", exitCode: 0, duration: Date.now() - start };
  } catch (e) {
    return {
      stdout: e.stdout?.toString().trimEnd() || "",
      stderr: e.stderr?.toString().trimEnd() || e.message,
      exitCode: e.status ?? 1,
      duration: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Plugin entrypoint
// ---------------------------------------------------------------------------
export default async function plugin(ctx) {
  const targets = loadTargets();
  const tgConfig = getTelegramConfig(ctx?.config);

  return {
    tool: {
      "run-on": tool({
        description:
          "Execute a shell command on a remote or local target. " +
          "Supports local shell, Docker/Podman containers, and SSH hosts. " +
          "Configure additional targets in ~/.config/opencode/remote-execution-targets.json",
        args: {
          target: tool.schema
            .string()
            .describe(
              `Target label. Built-in: "local". ` +
              `Configure more in ~/.config/opencode/remote-execution-targets.json. ` +
              `Use list-targets to see all available.`
            ),
          command: tool.schema.string().describe("Shell command to execute on the target"),
          timeout: tool.schema
            .number()
            .optional()
            .default(30000)
            .describe("Timeout in milliseconds (default 30000)"),
        },
        async execute(args) {
          const target = targets.get(args.target);

          if (!target) {
            return JSON.stringify({
              success: false,
              error: `Unknown target '${args.target}'`,
              available: [...targets.keys()],
            });
          }

          let result;
          switch (target.type) {
            case "local":
              result = executeLocal(args.command, args.timeout);
              break;
            case "container":
              result = executeContainer(target, args.command, args.timeout);
              break;
            case "ssh":
              result = executeSSH(target, args.command, args.timeout);
              break;
            default:
              return JSON.stringify({
                success: false,
                error: `Unsupported target type '${target.type}' for '${args.target}'`,
              });
          }

          if (tgConfig && (!result.success || result.duration > 30000)) {
            const icon = result.success ? "⚡" : "❌";
            sendTelegramNotification(`<b>${icon} Remote Exec</b>\n<code>${args.target}</code>\n${args.command}\nExit: ${result.exitCode} (${result.duration}ms)`, tgConfig).catch(() => {});
          }

          return JSON.stringify({
            success: result.exitCode === 0,
            target: args.target,
            command: args.command,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.duration,
          });
        },
      }),

      "list-targets": tool({
        description: "List all configured remote execution targets.",
        args: {},
        async execute() {
          const list = [...targets.entries()].map(([label, t]) => ({
            label,
            type: t.type,
            address: t.address || null,
          }));
          return JSON.stringify({ targets: list, count: list.length });
        },
      }),
    },

    config: async (opencodeConfig) => {
      const perm = opencodeConfig.permission ?? {};
      if (typeof perm["run-on"] === "undefined") {
        opencodeConfig.permission = { ...perm, "run-on": "allow" };
      }
    },
  };
}
