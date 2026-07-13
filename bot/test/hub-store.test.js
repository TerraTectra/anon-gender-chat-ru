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

  assert.deepEqual(store.stats(), { users: 1, opens: 1, suggestions: 1, pendingSuggestions: 1, favorites: 0 });
  const [source] = store.sourceStats();
  assert.equal(source.source, "src_launch");
  assert.equal(source.users, 1);
  assert.equal(store.popularProducts()[0].product_id, "focus");
  const [idea] = store.recentSuggestions();
  assert.equal(idea.text, "Бот для планирования питания");
  assert.equal(store.reviewSuggestion(idea.id, "planned"), true);
  assert.equal(store.reviewSuggestion(idea.id, "rejected"), false);
  assert.equal(store.stats().pendingSuggestions, 0);
  assert.equal(store.toggleFavorite(10, "focus"), true);
  assert.equal(store.isFavorite(10, "focus"), true);
  assert.deepEqual(store.favoriteIds(10), ["focus"]);
  assert.equal(store.toggleFavorite(10, "focus"), false);
  assert.equal(store.favoriteIds(10).length, 0);

  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
