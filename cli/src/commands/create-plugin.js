import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..");

// ─── Minimal template ────────────────────────────────────────────────────────

const PLUGIN_INDEX_TPL = (name) => `import { tool } from "@opencode-ai/plugin";

/**
 * ${name} plugin
 *
 * Describe what this plugin does here.
 */
export default async function plugin(ctx) {
  // Register tools
  ctx.registerTool(
    tool("${name}-hello", "A friendly greeting tool", async (input, context) => {
      return { message: "Hello from the ${name} plugin!" };
    })
  );

  // Register hooks
  ctx.on("tool.execute.after", async (event) => {
    // React to tool executions
  });

  console.error("[${name}] plugin loaded");
}
`;

const README_MINIMAL_TPL = (name, targetDir) => `# ${name}

OpenCode plugin: ${name}

## Quick start

\`\`\`json
{
  "plugins": ["file://${targetDir}"]
}
\`\`\`

## Structure

- \`index.js\` — Plugin entry point
- \`package.json\` — Dependencies and metadata
- \`tests/test.mjs\` — Unit tests
`;

// ─── Full template ───────────────────────────────────────────────────────────

const PLUGIN_INDEX_FULL_TPL = (name) => `import { tool } from "@opencode-ai/plugin";

/**
 * ${name} plugin
 *
 * Full-featured plugin with multiple tools, configuration, and lifecycle hooks.
 *
 * Config schema (add to opencode.json profile config):
 * {
 *   "${name}": {
 *     "enabled": true,
 *     "logLevel": "info",
 *     "settings": {}
 *   }
 * }
 */
export default async function plugin(ctx) {
  const pluginName = "${name}";
  const logLevel = ctx.config?.${name}?.logLevel || "info";
  const enabled = ctx.config?.${name}?.enabled !== false;

  if (!enabled) {
    console.error(\`[\${pluginName}] plugin disabled via config\`);
    return;
  }

  const log = (level, ...args) => {
    const levels = ["debug", "info", "warn", "error"];
    if (levels.indexOf(level) >= levels.indexOf(logLevel)) {
      console.error(\`[\${pluginName}] [\${level.toUpperCase()}]\`, ...args);
    }
  };

  log("info", "plugin initializing");

  // ── Tool: Greet ──────────────────────────────────────────────────────────
  ctx.registerTool(
    tool(
      "${name}-greet",
      "Generate a personalized greeting",
      {
        type: "object",
        properties: {
          name: { type: "string", description: "Name to greet" },
          style: {
            type: "string",
            enum: ["formal", "casual", "enthusiastic"],
            description: "Greeting style",
          },
        },
        required: ["name"],
      },
      async (input, context) => {
        const styles = {
          formal: \`Greetings, \${input.name}. It is a pleasure to connect with you.\`,
          casual: \`Hey \${input.name}! How's it going?\`,
          enthusiastic: \`Hey \${input.name}! So great to see you!! 🎉\`,
        };
        const greeting = styles[input.style] || styles.casual;
        log("info", \`greeted \${input.name} in \${input.style || "casual"} style\`);
        return {
          greeting,
          style: input.style || "casual",
          timestamp: new Date().toISOString(),
        };
      }
    )
  );

  // ── Tool: Echo ───────────────────────────────────────────────────────────
  ctx.registerTool(
    tool(
      "${name}-echo",
      "Echo back any input for testing",
      {
        type: "object",
        properties: {
          message: { type: "string", description: "Message to echo" },
          uppercase: { type: "boolean", description: "Convert to uppercase" },
        },
        required: ["message"],
      },
      async (input, context) => {
        let msg = input.message;
        if (input.uppercase) msg = msg.toUpperCase();
        return {
          original: input.message,
          echoed: msg,
          length: msg.length,
        };
      }
    )
  );

  // ── Tool: Stats ──────────────────────────────────────────────────────────
  ctx.registerTool(
    tool(
      "${name}-stats",
      "Return plugin runtime statistics",
      {
        type: "object",
        properties: {
          includeConfig: { type: "boolean", description: "Include config dump" },
        },
      },
      async (input, context) => {
        return {
          plugin: pluginName,
          version: process.env.PLUGIN_VERSION || "0.1.0",
          nodeVersion: process.version,
          platform: process.platform,
          uptime: process.uptime(),
          config: input.includeConfig ? ctx.config : undefined,
        };
      }
    )
  );

  // ── Hooks ────────────────────────────────────────────────────────────────
  ctx.on("tool.execute.before", async (event) => {
    log("debug", \`tool \${event.toolName} starting\`);
  });

  ctx.on("tool.execute.after", async (event) => {
    log("debug", \`tool \${event.toolName} completed in \${event.duration}ms\`);
  });

  log("info", \`plugin initialized with \${ctx.config ? "config" : "no config"}\`);
}
`;

const TEST_FULL_TPL = (name) => `import { describe, it, before } from "node:test";
import assert from "node:assert";
import plugin from "../index.js";

function createContext(config = {}) {
  const tools = [];
  const hooks = {};
  return {
    config,
    registerTool: (t) => tools.push(t),
    on: (event, fn) => {
      if (!hooks[event]) hooks[event] = [];
      hooks[event].push(fn);
    },
    getTools: () => tools,
    getHooks: () => hooks,
  };
}

describe("${name} plugin (full)", () => {
  let ctx;

  before(async () => {
    ctx = createContext({ ${name}: { enabled: true, logLevel: "debug" } });
    await plugin(ctx);
  });

  it("should export a default async function", () => {
    assert.strictEqual(typeof plugin, "function");
  });

  it("should register exactly 3 tools", () => {
    const tools = ctx.getTools();
    assert.strictEqual(tools.length, 3);
    const names = tools.map((t) => t.name);
    assert(names.includes("${name}-greet"));
    assert(names.includes("${name}-echo"));
    assert(names.includes("${name}-stats"));
  });

  it("should register before/after hooks", () => {
    const hooks = ctx.getHooks();
    assert.ok(hooks["tool.execute.before"], "before hook");
    assert.ok(hooks["tool.execute.after"], "after hook");
  });

  it("${name}-greet should produce a greeting", async () => {
    const [greet] = ctx.getTools();
    const result = await greet.handler(
      { name: "Test", style: "formal" },
      {}
    );
    assert.ok(result.greeting.includes("Test"));
    assert.strictEqual(result.style, "formal");
    assert.ok(result.timestamp);
  });

  it("${name}-greet should default to casual style", async () => {
    const [greet] = ctx.getTools();
    const result = await greet.handler({ name: "World" }, {});
    assert.strictEqual(result.style, "casual");
  });

  it("${name}-echo should echo messages", async () => {
    const [, echo] = ctx.getTools();
    const result = await echo.handler({ message: "hello world" }, {});
    assert.strictEqual(result.echoed, "hello world");
    assert.strictEqual(result.length, 11);
  });

  it("${name}-echo should support uppercase", async () => {
    const [, echo] = ctx.getTools();
    const result = await echo.handler(
      { message: "hello", uppercase: true },
      {}
    );
    assert.strictEqual(result.echoed, "HELLO");
  });

  it("${name}-stats should return system info", async () => {
    const [, , stats] = ctx.getTools();
    const result = await stats.handler({}, {});
    assert.strictEqual(result.plugin, "${name}");
    assert.ok(result.nodeVersion);
    assert.ok(result.platform);
  });
});
`;

const README_FULL_TPL = (name, targetDir) => `# ${name}

OpenCode plugin: ${name}

## Overview

This plugin provides ${name} functionality through the Phronesis/OpenCode system.

## Tools

| Tool | Description |
|------|-------------|
| \`${name}-greet\` | Generate personalized greetings in formal, casual, or enthusiastic styles |
| \`${name}-echo\` | Echo back messages (useful for testing) |
| \`${name}-stats\` | Return plugin runtime statistics |

## Hooks

- \`tool.execute.before\` — Logs tool execution start
- \`tool.execute.after\` — Logs tool completion

## Configuration

Add to your opencode.json profile config:

\`\`\`json
{
  "${name}": {
    "enabled": true,
    "logLevel": "info"
  }
}
\`\`\`

\`enabled\`: Set to \`false\` to disable the plugin without removing it.
\`logLevel\`: One of \`debug\`, \`info\` (default), \`warn\`, \`error\`.

## Development

\`\`\`bash
npm test          # Run unit tests
npm install       # Install dependencies
\`\`\`

## Registration

\`\`\`json
{
  "plugins": ["file://${targetDir}"]
}
\`\`\`
`;

// ─── Shared templates ───────────────────────────────────────────────────────

const PACKAGE_TPL = (name) => `{
  "name": "opencode-${name}",
  "version": "0.1.0",
  "description": "OpenCode plugin: ${name}",
  "type": "module",
  "main": "index.js",
  "opencode": {
    "type": "plugin",
    "hooks": ["tool.execute.after"]
  },
  "scripts": {
    "test": "node --test tests/test.mjs"
  },
  "dependencies": {
    "@opencode-ai/plugin": "^1.14.19"
  }
}
`;

const TEST_TPL = (name) => `import { describe, it } from "node:test";
import assert from "node:assert";

// The plugin entry point
import plugin from "../index.js";

describe("${name} plugin", () => {
  it("should export a default function", () => {
    assert.strictEqual(typeof plugin, "function", "plugin should be a function");
  });

  it("should register tools on load", async () => {
    const registered = [];
    const ctx = {
      registerTool: (t) => registered.push(t),
      on: () => {},
    };
    await plugin(ctx);
    assert.ok(registered.length >= 1, "should register at least one tool");
    assert.strictEqual(registered[0].name, "${name}-hello");
  });

  it("should expose a runnable tool", async () => {
    const registered = [];
    const ctx = {
      registerTool: (t) => registered.push(t),
      on: () => {},
    };
    await plugin(ctx);
    const tool = registered[0];
    const result = await tool.handler({}, {});
    assert.ok(result.message, "tool should return a message");
    assert.ok(result.message.includes("Hello from the ${name} plugin"));
  });
});
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
    .option("template", {
      describe: "Plugin template",
      choices: ["minimal", "full"],
      default: "minimal",
    })
    .option("skip-install", {
      describe: "Skip npm install after scaffolding",
      type: "boolean",
      default: false,
    });
}

const templates = {
  minimal: ({ name, targetDir, indexFile, pkgFile, testDir }) => {
    const files = [
      { path: indexFile, content: PLUGIN_INDEX_TPL(name) },
      { path: pkgFile, content: PACKAGE_TPL(name) },
      { path: join(testDir, "test.mjs"), content: TEST_TPL(name) },
      { path: join(targetDir, "README.md"), content: README_MINIMAL_TPL(name, targetDir) },
    ];
    return files;
  },
  full: ({ name, targetDir, indexFile, pkgFile, testDir }) => {
    const files = [
      { path: indexFile, content: PLUGIN_INDEX_FULL_TPL(name) },
      { path: pkgFile, content: PACKAGE_TPL(name) },
      { path: join(testDir, "test.mjs"), content: TEST_FULL_TPL(name) },
      { path: join(targetDir, "README.md"), content: README_FULL_TPL(name, targetDir) },
    ];
    return files;
  },
};

export function handler(argv) {
  const name = argv.name;
  const templateName = argv.template || "minimal";

  // Validate plugin name
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(`[phronesis] Invalid plugin name "${name}". Use kebab-case: letters, numbers, and hyphens only.`);
    process.exit(1);
  }

  const targetDir = argv.dir || join(PROJECT_ROOT, "src", name);
  const indexFile = join(targetDir, "index.js");
  const pkgFile = join(targetDir, "package.json");
  const testDir = join(targetDir, "tests");

  // Check for conflicts
  if (existsSync(targetDir)) {
    console.error(`[phronesis] Directory already exists: ${targetDir}`);
    console.error(`  Use --dir to specify a different target.`);
    process.exit(1);
  }

  // Resolve template
  const gen = templates[templateName];
  if (!gen) {
    console.error(`[phronesis] Unknown template "${templateName}". Use "minimal" or "full".`);
    process.exit(1);
  }

  // Create directory tree
  mkdirSync(targetDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });

  // Write files
  const files = gen({ name, targetDir, indexFile, pkgFile, testDir });
  for (const f of files) {
    writeFileSync(f.path, f.content, "utf8");
    console.log(`  ${f.path}`);
  }

  console.log(`\n[phronesis] Plugin "${name}" scaffolded (template: ${templateName}):`);

  // npm install
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

  // Registration instructions
  console.log(`\n  Next steps:`);
  console.log(`  1. Register the plugin in your opencode.json:`);
  console.log(`     {`);
  console.log(`       "plugins": ["file://${targetDir}"]`);
  console.log(`     }`);
  console.log(`  2. Edit ${indexFile} to add your plugin logic`);
  console.log(`  3. Reload the opencode server to pick up changes\n`);
}
