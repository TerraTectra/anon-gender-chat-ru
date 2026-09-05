import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDatingBot,
  createJoinGuardBot,
  createMediaBot,
  createPostBot,
  createRandomBot,
  createRatesBot,
  createStudyBot,
  createToolsBot
} from "../src/niche-bots.js";

const token = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";

function withDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tectra-niche-test-"));
  return { dir, db: path.join(dir, `${name}.db`) };
}

for (const [name, factory] of Object.entries({
  study: createStudyBot,
  random: createRandomBot,
  dating: createDatingBot,
  rates: createRatesBot,
  post: createPostBot,
  media: createMediaBot,
  join: createJoinGuardBot,
  tools: createToolsBot
})) {
  test(`niche factory ${name} creates an isolated persistent bot`, () => {
    const { dir, db } = withDb(name);
    const bot = factory(token, db, () => 0.25);
    try {
      assert.ok(bot);
      assert.equal(typeof bot.start, "function");
      assert.equal(typeof bot.syncProfile, "function");
      assert.equal(typeof bot.closeStore, "function");
      assert.ok(fs.existsSync(db));
    } finally {
      bot.closeStore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
