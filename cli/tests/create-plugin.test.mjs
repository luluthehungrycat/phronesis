import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { handler } from "../src/commands/create-plugin.js";

test("create-plugin scaffolds a current OpenCode plugin", () => {
  const root = mkdtempSync(join(tmpdir(), "phronesis-create-plugin-"));
  const target = join(root, "example-plugin");

  try {
    handler({ name: "example-plugin", dir: target, "skip-install": true });

    const index = readFileSync(join(target, "index.js"), "utf8");
    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    assert.equal(pkg.dependencies["@opencode-ai/plugin"], "^1.18.31");
    assert.match(index, /return \{\s*tool:/);
    assert.doesNotMatch(index, /registerTool|ctx\.on/);
    assert.equal(existsSync(join(target, "tests", "test.mjs")), true);

    for (const file of [join(target, "index.js"), join(target, "tests", "test.mjs")]) {
      const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
