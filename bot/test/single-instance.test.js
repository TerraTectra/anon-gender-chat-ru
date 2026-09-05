import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { isTelegramPollingConflict, safeErrorSummary } from "../src/safe-error.js";
import { acquireSingleInstance, AlreadyRunningError } from "../src/single-instance.js";

test("only one local bot network can acquire the singleton", async () => {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const endpoint = process.platform === "win32"
    ? `\\\\.\\pipe\\terratectra-test-${suffix}`
    : path.join(os.tmpdir(), `terratectra-test-${suffix}.sock`);
  const first = await acquireSingleInstance(endpoint);
  try {
    await assert.rejects(() => acquireSingleInstance(endpoint), AlreadyRunningError);
  } finally {
    await first.release();
  }
  const next = await acquireSingleInstance(endpoint);
  await next.release();
});

test("Telegram polling conflicts are detected through nested errors", () => {
  assert.equal(isTelegramPollingConflict({
    error: {
      error_code: 409,
      description: "Conflict: terminated by other getUpdates request"
    }
  }), true);
  assert.equal(isTelegramPollingConflict(new Error("ordinary network failure")), false);
});

test("Telegram tokens and authenticated Bot API URLs are removed from logs", () => {
  const fakeToken = "123456789:abcdefghijklmnopqrstuvwxyzABCDE";
  const summary = safeErrorSummary(new Error(`fetch failed: https://api.telegram.org/bot${fakeToken}/getUpdates ${fakeToken}`));
  assert.equal(summary.includes(fakeToken), false);
  assert.match(summary, /REDACTED/);
});
