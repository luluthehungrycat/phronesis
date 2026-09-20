import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const plugins = [
  ["skill-creator", "opencode-skill-creator"],
  ["session-search", "session-search"],
  ["persona", "opencode-persona"],
  ["memory-consolidation", "opencode-memory-consolidation"],
  ["remote-execution", "opencode-remote-execution"],
  ["skill-lifecycle", "opencode-skill-lifecycle"],
  ["user-profiling", "opencode-user-profiling"],
];

for (const [name, id] of plugins) {
  const moduleUrl = pathToFileURL(resolve(root, "src", name, "index.js"));
  const mod = await import(moduleUrl.href);
  assert.equal(typeof mod.default, "object", `${name} must default-export a module object`);
  assert.equal(mod.default.id, id, `${name} must expose the expected plugin id`);
  assert.equal(typeof mod.default.server, "function", `${name} must expose server()`);
}

console.log(`OpenCode v1 plugin contract passed for ${plugins.length} plugins`);
