import test from "node:test";
import assert from "node:assert/strict";
import { parseTaskDue } from "../src/task-bot.js";

const now = Date.UTC(2026, 6, 13, 7, 0, 0); // 10:00 Moscow

test("custom task time supports Moscow-relative dates", () => {
  assert.equal(parseTaskDue("сегодня 18:30", now), Date.UTC(2026, 6, 13, 15, 30) / 1000);
  assert.equal(parseTaskDue("завтра в 09:00", now), Date.UTC(2026, 6, 14, 6, 0) / 1000);
});

test("custom task time supports calendar dates and rejects invalid input", () => {
  assert.equal(parseTaskDue("25.07 14:00", now), Date.UTC(2026, 6, 25, 11, 0) / 1000);
  assert.equal(parseTaskDue("31.02 12:00", now), null);
  assert.equal(parseTaskDue("сегодня 09:00", now), null);
  assert.equal(parseTaskDue("когда-нибудь вечером", now), null);
});
