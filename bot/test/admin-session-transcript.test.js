import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSessionTranscriptChunks,
  readFullSessionTranscript
} from "../src/admin-bot.js";

test("full archived transcript is loaded beyond the 50-message archive page size", () => {
  const source = Array.from({ length: 123 }, (_, index) => ({
    id: index + 1,
    sender_id: index % 2 ? 200 : 100,
    kind: "text",
    text: `message-${index + 1}`,
    created_at_ms: 1_700_000_000_000 + index
  }));
  const offsets = [];
  const store = {
    listChatSessionMessages(_sessionId, { limit, offset }) {
      offsets.push(offset);
      return {
        items: source.slice(offset, offset + limit),
        total: source.length
      };
    }
  };

  const result = readFullSessionTranscript(store, 77);

  assert.equal(result.total, 123);
  assert.equal(result.items.length, 123);
  assert.deepEqual(offsets, [0, 50, 100]);
  assert.equal(result.items[122].text, "message-123");
});

test("full archived transcript is split into Telegram-safe chunks without losing messages", () => {
  const messages = Array.from({ length: 80 }, (_, index) => ({
    id: index + 1,
    sender_id: index % 2 ? 200 : 100,
    kind: "text",
    text: `payload-${index + 1}-${"x".repeat(90)}`,
    created_at_ms: 1_700_000_000_000 + index
  }));

  const chunks = buildSessionTranscriptChunks(88, messages);
  const transcript = chunks.join("\n");

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 3600));
  assert.match(transcript, /Сессия #88 · вся переписка \(80 сообщ\.\)/);
  assert.match(transcript, /1\/80 · Отправитель: ID 100/);
  assert.match(transcript, /80\/80 · Отправитель: ID 200/);
  assert.match(transcript, /payload-1-/);
  assert.match(transcript, /payload-80-/);
});


test("long archived message text is preserved instead of clipped", () => {
  const payload = `${"🙂".repeat(1900)}-END`;
  const chunks = buildSessionTranscriptChunks(99, [{
    id: 1,
    sender_id: 100,
    kind: "text",
    text: payload,
    created_at_ms: 1_700_000_000_000
  }]);

  assert.ok(chunks.every((chunk) => chunk.length <= 3600));
  assert.ok(chunks.join("").includes(payload));
});
