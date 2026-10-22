import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
test("VAPID generator writes private file without logging keys or overwriting existing credentials", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "kd-vapid-"));
  try {
    const script = fileURLToPath(
      new URL("../scripts/generate-vapid.mjs", import.meta.url),
    );
    const run = () =>
      spawnSync(process.execPath, [script, "mailto:admin@example.test"], {
        cwd,
        encoding: "utf8",
      });
    const first = run();
    assert.equal(first.status, 0);
    const path = join(cwd, ".env.vapid.local"),
      data = await readFile(path, "utf8");
    for (const line of data.trim().split("\n")) {
      const [name, value] = line.split("=");
      assert.ok(value);
      if (name !== "VAPID_SUBJECT")
        assert.equal(first.stdout.includes(value), false);
    }
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.notEqual(run().status, 0);
    assert.equal(await readFile(path, "utf8"), data);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
