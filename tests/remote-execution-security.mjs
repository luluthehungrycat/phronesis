import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "phronesis-remote-exec-"));
process.env.HOME = home;
// The plugin reads this path at module-load time.
const configDir = join(home, ".config", "opencode");
mkdirSync(configDir, { recursive: true });
writeFileSync(
  join(configDir, "remote-execution-targets.json"),
  JSON.stringify({
    targets: [
      { label: "unsafe-container", type: "container", runtime: "docker", address: "ok; touch /tmp/pwned" },
      { label: "unsafe-ssh", type: "ssh", address: "user@example.com; touch /tmp/pwned" },
    ],
  }),
);

try {
  const { default: plugin } = await import("../src/remote-execution/index.js");
  const hooks = await plugin({});

  const container = JSON.parse(await hooks.tool["run-on"].execute({
    target: "unsafe-container",
    command: "printf should-not-run",
    timeout: 1000,
  }, {}));
  assert.equal(container.success, false);
  assert.match(container.stderr, /Invalid container name format/);

  const ssh = JSON.parse(await hooks.tool["run-on"].execute({
    target: "unsafe-ssh",
    command: "printf should-not-run",
    timeout: 1000,
  }, {}));
  assert.equal(ssh.success, false);
  assert.match(ssh.stderr, /Invalid SSH address format/);

  console.log("remote execution target validation passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
