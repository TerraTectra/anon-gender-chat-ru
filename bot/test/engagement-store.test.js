import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngagementStore } from "../src/engagement-store.js";
import { PARTY_PROMPTS } from "../src/party-bot.js";
import { QUIZ_QUESTIONS } from "../src/quiz-bot.js";

test("engagement store tracks users, actions, score and referrals", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-engagement-"));
  const store = new EngagementStore(path.join(directory, "engagement.db"));
  store.upsertUser(1, "owner", "src_channel_fun");
  store.upsertUser(2, "friend", "ref_1");
  store.recordAction(1, "answer", 1);
  store.recordAction(1, "answer", 0);

  assert.deepEqual(store.userStats(1), { actions: 2, score: 1 });
  assert.equal(store.invitedCount(1), 1);
  assert.deepEqual(store.stats(), { users: 2, actions: 2, score: 1 });
  assert.deepEqual(store.sourceStats(10).map((row) => ({ ...row })), [
    { source: "ref_1", users: 1 },
    { source: "src_channel_fun", users: 1 }
  ]);

  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("entertainment content has valid questions and non-empty categories", () => {
  assert.equal(new Set(QUIZ_QUESTIONS.map((question) => question.id)).size, QUIZ_QUESTIONS.length);
  for (const question of QUIZ_QUESTIONS) {
    assert.ok(question.options.length >= 2);
    assert.ok(question.correct >= 0 && question.correct < question.options.length);
  }
  for (const prompts of Object.values(PARTY_PROMPTS)) assert.ok(prompts.length >= 5);
});
