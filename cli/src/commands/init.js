import { createInterface } from "node:readline";
import { DEFAULT_RUNTIME_ROOT, initializeRuntime } from "../lib/runtime.js";

export const command = "init";
export const describe = "Initialize an isolated Phronesis OpenCode runtime";

export function builder(yargs) {
  return yargs
    .option("mode", {
      describe: "When managed files exist: abort, missing, or reset",
      choices: ["abort", "missing", "reset"],
    })
    .option("root", {
      describe: "Runtime root (default: ~/.phronesis)",
      type: "string",
      default: DEFAULT_RUNTIME_ROOT,
    });
}

function ask(query) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (answer) => {
    rl.close();
    resolve(answer.trim().toLowerCase());
  }));
}

async function chooseMode(root) {
  console.log(`[phronesis] Managed files already exist under ${root}.`);
  console.log("Choose: [m] initialize missing files only, [r] reset to defaults (backups created), [a] abort");
  const answer = await ask("Choice [a]: ");
  if (answer === "m" || answer === "missing") return "missing";
  if (answer === "r" || answer === "reset") return "reset";
  return "abort";
}

export async function handler(argv) {
  let mode = argv.mode;
  if (!mode) {
    const probe = initializeRuntime({ root: argv.root, mode: "abort" });
    if (probe.status === "aborted") {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error("[phronesis] Existing runtime files found; pass --mode=missing, --mode=reset, or --mode=abort.");
        process.exitCode = 2;
        return;
      }
      mode = await chooseMode(argv.root);
    } else {
      console.log(`[phronesis] Runtime created: ${probe.root}`);
      for (const file of probe.created ?? []) console.log(`  created ${file}`);
      console.log("[phronesis] OpenCode will use this runtime when launched by Phronesis.");
      return;
    }
  }

  const result = initializeRuntime({ root: argv.root, mode });
  if (result.status === "aborted") {
    console.log("[phronesis] Initialization aborted; no managed files were changed.");
    return;
  }

  console.log(`[phronesis] Runtime ${result.status}: ${result.root}`);
  if (result.created?.length) {
    for (const file of result.created) console.log(`  created ${file}`);
  }
  if (result.backupDir) console.log(`  backup: ${result.backupDir}`);
  console.log("[phronesis] OpenCode will use this runtime when launched by Phronesis.");
}
