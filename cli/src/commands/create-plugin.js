import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..");
const OPENCODE_PLUGIN_VERSION = "^1.18.31";

const PLUGIN_INDEX_TPL = (name) => `import { tool } from "@opencode-ai/plugin";

/**
 * ${name} plugin
 *
 * Describe what this plugin does here.
 */
export default async function plugin(_ctx) {
  return {
    tool: {
      "${name}-hello": tool({
        description: "A friendly greeting tool",
        args: {},
        async execute() {
          return { message: "Hello from the ${name} plugin!" };
        },
      }),
    },

    // React to tool executions when needed.
    "tool.execute.after": async (_input, _output) => {},
  };
}
`;

const TEST_TPL = (name) => `import { describe, it } from "node:test";
import assert from "node:assert/strict";
import plugin from "../index.js";

describe("${name} plugin", () => {
  it("exports an OpenCode plugin function", () => {
    assert.equal(typeof plugin, "function");
  });

  it("returns a hello tool and lifecycle hook", async () => {
    const hooks = await plugin({});
    assert.equal(typeof hooks.tool["${name}-hello"].execute, "function");
    assert.equal(typeof hooks["tool.execute.after"], "function");
  });

  it("runs the hello tool", async () => {
    const hooks = await plugin({});
    const result = await hooks.tool["${name}-hello"].execute({}, {});
    assert.deepEqual(result, { message: "Hello from the ${name} plugin!" });
  });
});
`;

const PACKAGE_TPL = (name) => `{
  "name": "opencode-${name}",
  "version": "0.1.0",
  "description": "OpenCode plugin: ${name}",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "test": "node --test tests/test.mjs"
  },
  "dependencies": {
    "@opencode-ai/plugin": "${OPENCODE_PLUGIN_VERSION}"
  }
}
`;

export const command = "create-plugin <name>";
export const describe = "Scaffold a new Phronesis plugin";

export function builder(yargs) {
  return yargs
    .positional("name", {
      describe: "Plugin name (kebab-case, e.g. 'code-review')",
      type: "string",
      demandOption: true,
    })
    .option("dir", {
      describe: "Target directory (default: src/<name>)",
      type: "string",
    })
    .option("skip-install", {
      describe: "Skip npm install after scaffolding",
      type: "boolean",
      default: false,
    });
}

export function handler(argv) {
  const name = argv.name;

  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(`[phronesis] Invalid plugin name "${name}". Use kebab-case: letters, numbers, and hyphens only.`);
    process.exit(1);
  }

  const targetDir = argv.dir || join(PROJECT_ROOT, "src", name);
  const indexFile = join(targetDir, "index.js");
  const pkgFile = join(targetDir, "package.json");
  const testDir = join(targetDir, "tests");

  if (existsSync(targetDir)) {
    console.error(`[phronesis] Directory already exists: ${targetDir}`);
    console.error("  Use --dir to specify a different target.");
    process.exit(1);
  }

  mkdirSync(testDir, { recursive: true });
  writeFileSync(indexFile, PLUGIN_INDEX_TPL(name), "utf8");
  writeFileSync(pkgFile, PACKAGE_TPL(name), "utf8");
  writeFileSync(join(testDir, "test.mjs"), TEST_TPL(name), "utf8");

  console.log(`[phronesis] Plugin "${name}" scaffolded at:`);
  console.log(`  ${indexFile}`);
  console.log(`  ${pkgFile}`);
  console.log(`  ${join(testDir, "test.mjs")}`);

  if (!argv["skip-install"]) {
    console.log(`[phronesis] Installing dependencies...`);
    const result = spawnSync("npm", ["install"], {
      cwd: targetDir,
      stdio: "inherit",
      encoding: "utf8",
      timeout: 120_000,
    });

    if (result.status === 0) {
      console.log(`[phronesis] Dependencies installed.`);
    } else {
      console.error(`[phronesis] npm install exited with code ${result.status}.`);
      console.error(`  Run "cd ${targetDir} && npm install" manually.`);
    }
  }

  console.log(`\n  Next steps:`);
  console.log(`  1. Register the plugin in your opencode.json:`);
  console.log(`     {`);
  console.log(`       "plugin": ["file://${targetDir}"]`);
  console.log(`     }`);
  console.log(`  2. Edit ${indexFile} to add your plugin logic`);
  console.log(`  3. Reload the opencode server to pick up changes\n`);
}
