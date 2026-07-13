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
  store.recordOpen(10, "focus", "recommend");
  store.recordOpen(10, "tasks", "search");
  store.addSuggestion(10, "Бот для планирования питания");

  assert.deepEqual(store.stats(), {
    users: 1,
    opens: 2,
    suggestions: 1,
    pendingSuggestions: 1,
    favorites: 0,
    leads: 0,
    pendingLeads: 0
  });
  const [source] = store.sourceStats();
  assert.equal(source.source, "src_launch");
  assert.equal(source.users, 1);
  assert.equal(store.popularProducts()[0].product_id, "focus");
  assert.deepEqual(store.openSourceStats().map((row) => ({ ...row })), [
    { source: "recommend", opens: 1, users: 1 },
    { source: "search", opens: 1, users: 1 }
  ]);
  assert.deepEqual(store.recentProductIds(10), ["tasks", "focus"]);
  assert.deepEqual(store.funnelStats(), {
    users: 1,
    engaged: 1,
    favorited: 0,
    leads: 0,
    opens: 2
  });
  const [idea] = store.recentSuggestions();
  assert.equal(idea.text, "Бот для планирования питания");
  assert.equal(store.reviewSuggestion(idea.id, "planned"), true);
  assert.equal(store.reviewSuggestion(idea.id, "rejected"), false);
  assert.equal(store.stats().pendingSuggestions, 0);
  assert.equal(store.toggleFavorite(10, "focus"), true);
  assert.equal(store.isFavorite(10, "focus"), true);
  assert.deepEqual(store.favoriteIds(10), ["focus"]);
  assert.deepEqual(store.productPerformance(), [
    { product_id: "focus", opens: 1, users: 1, favorites: 1 },
    { product_id: "tasks", opens: 1, users: 1, favorites: 0 }
  ]);
  assert.equal(store.toggleFavorite(10, "focus"), false);
  assert.equal(store.favoriteIds(10).length, 0);
  const lead = store.addLead(10, "tester", "Нужен бот для обработки заявок клиентов", "30–70 000 ₽", "до месяца", "src_test_lead");
  assert.equal(store.recentLeads()[0].id, lead.id);
  assert.equal(store.stats().pendingLeads, 1);
  assert.equal(store.reviewLead(lead.id, "contacted"), true);
  assert.equal(store.reviewLead(lead.id, "won"), false);
  store.upsertUser(11, "friend", "ref_10");
  assert.equal(store.invitedCount(10), 1);

  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
