import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HubStore } from "../src/hub-store.js";

test("hub stores users, product opens and suggestions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-hub-"));
  const store = new HubStore(path.join(directory, "hub.db"));

  store.upsertUser(10, "tester", "src_launch");
  store.recordOpen(10, "focus");
  store.addSuggestion(10, "Бот для планирования питания");

  assert.deepEqual(store.stats(), { users: 1, opens: 1, suggestions: 1 });
  const [source] = store.sourceStats();
  assert.equal(source.source, "src_launch");
  assert.equal(source.users, 1);

  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
