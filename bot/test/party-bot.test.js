import test from "node:test";
import assert from "node:assert/strict";
import { dailyPartyPrompt, PARTY_PROMPTS } from "../src/party-bot.js";

test("party bot exposes varied non-empty prompt collections", () => {
  assert.deepEqual(Object.keys(PARTY_PROMPTS).sort(), [
    "dare",
    "icebreaker",
    "mime",
    "mostlikely",
    "story",
    "truth",
    "would"
  ]);

  for (const prompts of Object.values(PARTY_PROMPTS)) {
    assert.ok(prompts.length >= 5);
    assert.equal(new Set(prompts).size, prompts.length);
    assert.ok(prompts.every((prompt) => prompt.length >= 30));
  }
});

test("party daily prompt is stable for the same Moscow day", () => {
  const morning = dailyPartyPrompt(new Date("2026-07-17T06:00:00Z"));
  const evening = dailyPartyPrompt(new Date("2026-07-17T19:00:00Z"));
  assert.deepEqual(morning, evening);
  assert.ok(PARTY_PROMPTS[morning.category].includes(morning.prompt));
});
