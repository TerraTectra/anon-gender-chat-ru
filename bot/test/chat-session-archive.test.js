import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { MEDIA_RETENTION_MS } from "../src/chat-session-archive.js";
import { Store } from "../src/store.js";
import { retainedMediaFromMessage } from "../src/user-bot.js";

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "anon-sessions-"));
  const archiveRoot = path.join(directory, "retention");
  const store = new Store(path.join(directory, "chat.db"), { sessionArchiveRoot: archiveRoot });
  for (const [id, gender, age] of [[1, "male", 25], [2, "female", 23]]) {
    store.upsertUser(id, `user${id}`);
    store.setProfile(id, { gender, age });
  }
  store.enqueue(1, "random");
  assert.deepEqual(store.enqueue(2, "random"), { status: "matched", partnerId: 1 });
  return {
    store,
    archiveRoot,
    cleanup() {
      store.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

function addMedia(store, index, senderId = 1, now = 1_000 + index) {
  const media = store.beginChatMedia(senderId, {
    kind: index % 3 === 0 ? "video_note" : index % 2 === 0 ? "video" : "photo",
    fileId: `file-${index}`,
    fileUniqueId: `unique-${index}`,
    sourceChatId: senderId,
    sourceMessageId: index,
    fileSize: 4,
    mimeType: index % 2 === 0 ? "video/mp4" : "image/jpeg"
  }, now);
  assert.ok(media);
  if (!media.duplicate) {
    store.completeChatMedia(media.id, Buffer.from(`m${index}`), media.kind === "photo" ? ".jpg" : ".mp4", media.mime_type);
  }
  return media;
}

test("a match creates one visible active chat session without changing the match API", () => {
  const fixture = createFixture();
  try {
    const result = fixture.store.listActiveChatSessions();
    assert.equal(result.total, 1);
    assert.deepEqual(result.items[0].participants.map((participant) => participant.id), [1, 2]);
    assert.equal(result.items[0].media_count, 0);
    assert.equal(result.items[0].legacy_backfill, 0);
  } finally {
    fixture.cleanup();
  }
});

test("five retained media items are staged only while active and deleted on close", () => {
  const fixture = createFixture();
  try {
    for (let index = 1; index <= 5; index += 1) addMedia(fixture.store, index, index % 2 ? 1 : 2);
    assert.equal(fixture.store.listActiveChatSessions().items[0].media_count, 5);
    assert.equal(fs.readdirSync(path.join(fixture.archiveRoot, "files")).length, 5);

    assert.equal(fixture.store.disconnect(1, "stop", 10_000), 2);
    assert.equal(fixture.store.listActiveChatSessions().total, 0);
    assert.equal(fixture.store.listRetainedChatSessions({ now: 10_001 }).total, 0);
    assert.equal(fs.readdirSync(path.join(fixture.archiveRoot, "files")).length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("the sixth mixed media item retains the ended session for exactly seven days", () => {
  const fixture = createFixture();
  try {
    for (let index = 1; index <= 6; index += 1) addMedia(fixture.store, index, index % 2 ? 1 : 2);
    const active = fixture.store.listRetainedChatSessions({ now: 9_000 });
    assert.equal(active.total, 1);
    assert.equal(active.items[0].photo_count + active.items[0].video_count + active.items[0].video_note_count, 6);

    const endedAt = 20_000;
    fixture.store.disconnect(2, "next", endedAt);
    const retained = fixture.store.listRetainedChatSessions({ now: endedAt + MEDIA_RETENTION_MS - 1 });
    assert.equal(retained.total, 1);
    assert.equal(retained.items[0].expires_at_ms, endedAt + MEDIA_RETENTION_MS);
    assert.deepEqual(fixture.store.purgeExpiredChatSessions(endedAt + MEDIA_RETENTION_MS - 1), { sessions: 0, files: 0 });
    assert.deepEqual(fixture.store.purgeExpiredChatSessions(endedAt + MEDIA_RETENTION_MS), { sessions: 1, files: 6 });
    assert.equal(fixture.store.listRetainedChatSessions({ now: endedAt + MEDIA_RETENTION_MS }).total, 0);
    assert.equal(fs.readdirSync(path.join(fixture.archiveRoot, "files")).length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("a repeated Telegram update does not increment the media count", () => {
  const fixture = createFixture();
  try {
    const first = addMedia(fixture.store, 100);
    const duplicate = addMedia(fixture.store, 100);
    assert.equal(duplicate.id, first.id);
    assert.equal(duplicate.duplicate, true);
    assert.equal(fixture.store.listActiveChatSessions().items[0].media_count, 1);
  } finally {
    fixture.cleanup();
  }
});

test("current partner pairs are backfilled once when the session archive is missing", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "anon-backfill-"));
  const dbPath = path.join(directory, "chat.db");
  const archiveRoot = path.join(directory, "retention");
  let store = new Store(dbPath, { sessionArchiveRoot: archiveRoot });
  for (const [id, gender] of [[1, "male"], [2, "female"]]) {
    store.upsertUser(id, `user${id}`);
    store.setProfile(id, { gender, age: 30 });
  }
  store.enqueue(1, "random");
  store.enqueue(2, "random");
  store.close();
  fs.rmSync(archiveRoot, { recursive: true, force: true });

  try {
    store = new Store(dbPath, { sessionArchiveRoot: archiveRoot });
    assert.equal(store.listActiveChatSessions().total, 1);
    assert.equal(store.listActiveChatSessions().items[0].legacy_backfill, 1);
    store.close();
    store = new Store(dbPath, { sessionArchiveRoot: archiveRoot });
    assert.equal(store.listActiveChatSessions().total, 1);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("only photos, videos and video notes are selected for retention", () => {
  assert.equal(retainedMediaFromMessage({ voice: { file_id: "voice" } }), null);
  assert.equal(retainedMediaFromMessage({ document: { file_id: "document" } }), null);
  assert.equal(retainedMediaFromMessage({ photo: [
    { file_id: "small", file_unique_id: "one" },
    { file_id: "large", file_unique_id: "two", file_size: 42 }
  ] }).fileId, "large");
  assert.equal(retainedMediaFromMessage({ video: { file_id: "video", file_unique_id: "v" } }).kind, "video");
  assert.equal(retainedMediaFromMessage({ video_note: { file_id: "circle", file_unique_id: "c" } }).kind, "video_note");
});
