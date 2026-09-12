import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrainingData } from "../src/training-data.js";

async function createTrainingDirectory(files) {
  const directory = await mkdtemp(join(tmpdir(), "assertion-creator-"));
  await Promise.all(Object.entries(files).map(([fileName, content]) =>
    writeFile(join(directory, fileName), content, "utf8")));
  return directory;
}

test("loads numbered JSON responses with JavaScript assertion files", async () => {
  const directory = await createTrainingDirectory({
    "response1.json": '{"status":"ok"}',
    "assertion1.js": 'pm.test("Positive Scenario", function () {});\n',
  });

  const examples = await loadTrainingData(directory);

  assert.deepEqual(examples, [{
    id: "1",
    response: { status: "ok" },
    assertion: 'pm.test("Positive Scenario", function () {});\n',
    responseFile: "response1.json",
    assertionFile: "assertion1.js",
  }]);
});

test("rejects a response without a matching JavaScript assertion", async () => {
  const directory = await createTrainingDirectory({
    "response7.json": '{"status":"ok"}',
  });

  await assert.rejects(
    loadTrainingData(directory),
    /Missing assertion7\.js for response7\.json/,
  );
});