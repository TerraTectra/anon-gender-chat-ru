import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { MEDIA_RETENTION_MS } from "../src/chat-session-archive.js";
import { Store } from "../src/store.js";
import { archivedMessageFromMessage, retainedMediaFromMessage } from "../src/user-bot.js";

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

function addMessage(store, index, senderId = 1, overrides = {}, now = 1_000 + index) {
  return store.recordChatMessage(senderId, {
    kind: "text",
    text: `message-${index}`,
    sourceChatId: senderId,
    sourceMessageId: index,
    ...overrides
  }, now);
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

test("a single media item retains the ended session for seven days", () => {
  const fixture = createFixture();
  try {
    addMedia(fixture.store, 1);
    assert.equal(fixture.store.listActiveChatSessions().items[0].media_count, 1);
    assert.equal(fs.readdirSync(path.join(fixture.archiveRoot, "files")).length, 1);
    const endedAt = 10_000;
    assert.equal(fixture.store.disconnect(1, "stop", endedAt), 2);
    assert.equal(fixture.store.listActiveChatSessions().total, 0);
    const retained = fixture.store.listRetainedChatSessions({ now: endedAt + 1 });
    assert.equal(retained.total, 1);
    assert.equal(retained.items[0].media_count, 1);
    assert.equal(retained.items[0].expires_at_ms, endedAt + MEDIA_RETENTION_MS);
  } finally { fixture.cleanup(); }
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


test("a qualifying session retains the complete transcript in chronological order", () => {
  const fixture = createFixture();
  try {
    addMessage(fixture.store, 1, 1, { text: "first" }, 1_100);
    const voice = addMessage(fixture.store, 2, 2, {
      kind: "voice",
      text: null,
      fileId: "voice-file",
      fileUniqueId: "voice-unique",
      fileSize: 5,
      mimeType: "audio/ogg"
    }, 1_200);
    fixture.store.completeChatMessageAttachment(voice.id, Buffer.from("voice"), ".ogg", "audio/ogg");
    addMessage(fixture.store, 3, 1, { text: "third" }, 1_300);
    addMedia(fixture.store, 10, 2, 1_400);

    const active = fixture.store.listActiveChatSessions().items[0];
    assert.equal(active.message_count, 3);
    assert.equal(active.attachment_count, 1);
    assert.equal(active.media_count, 1);

    const endedAt = 2_000;
    fixture.store.disconnect(1, "stop", endedAt);
    const retained = fixture.store.listRetainedChatSessions({ now: endedAt + 1 });
    assert.equal(retained.total, 1);
    const transcript = fixture.store.listChatSessionMessages(retained.items[0].id, { limit: 10, now: endedAt + 1 });
    assert.deepEqual(transcript.items.map((row) => row.source_message_id), [1, 2, 3]);
    assert.deepEqual(transcript.items.map((row) => row.sender_id), [1, 2, 1]);
    assert.equal(fixture.store.resolveChatSessionMessageAttachment(voice.id, endedAt + 1).absolutePath.endsWith(".ogg"), true);
  } finally {
    fixture.cleanup();
  }
});

test("a non-qualifying session deletes its transcript and attachment immediately on end", () => {
  const fixture = createFixture();
  try {
    addMessage(fixture.store, 1, 1, { text: "temporary" });
    const document = addMessage(fixture.store, 2, 2, {
      kind: "document",
      text: null,
      fileId: "doc-file",
      fileUniqueId: "doc-unique",
      fileName: "note.txt",
      fileSize: 4,
      mimeType: "text/plain"
    });
    fixture.store.completeChatMessageAttachment(document.id, Buffer.from("note"), ".txt", "text/plain");
    assert.equal(fs.readdirSync(path.join(fixture.archiveRoot, "files")).length, 1);

    fixture.store.disconnect(1, "stop", 5_000);
    assert.equal(fixture.store.listActiveChatSessions().total, 0);
    assert.equal(fixture.store.listRetainedChatSessions({ now: 5_001 }).total, 0);
    assert.equal(fs.readdirSync(path.join(fixture.archiveRoot, "files")).length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("duplicate Telegram messages and media remain idempotent", () => {
  const fixture = createFixture();
  try {
    const firstMessage = addMessage(fixture.store, 50, 1, { text: "once" });
    const duplicateMessage = addMessage(fixture.store, 50, 1, { text: "once" });
    assert.equal(duplicateMessage.id, firstMessage.id);
    assert.equal(duplicateMessage.duplicate, true);
    addMedia(fixture.store, 50, 1);
    addMedia(fixture.store, 50, 1);
    const session = fixture.store.listActiveChatSessions().items[0];
    assert.equal(session.message_count, 1);
    assert.equal(session.media_count, 1);
  } finally {
    fixture.cleanup();
  }
});

test("six hours of inactivity ends the pair and retains only qualifying sessions", () => {
  const fixture = createFixture();
  try {
    addMessage(fixture.store, 1, 1, { text: "hello" }, 1_000);
    addMedia(fixture.store, 2, 2, 1_100);
    const sessionId = fixture.store.listActiveChatSessions().items[0].id;
    const now = 1_100 + 6 * 60 * 60 * 1000;
    const ended = fixture.store.expireInactiveChatSessions(now);
    assert.equal(ended.length, 1);
    assert.deepEqual(ended[0].userIds, [1, 2]);
    assert.equal(fixture.store.getUser(1).partner_id, null);
    assert.equal(fixture.store.getUser(2).partner_id, null);
    assert.equal(fixture.store.getUser(1).state, "idle");
    assert.equal(fixture.store.getUser(2).state, "idle");
    assert.equal(fixture.store.getChatSession(sessionId, now + 1).status, "ended");
  } finally {
    fixture.cleanup();
  }
});

test("manual session deletion disconnects an active pair and removes archived files", () => {
  const fixture = createFixture();
  try {
    const message = addMessage(fixture.store, 3, 1, {
      kind: "document",
      text: null,
      fileId: "document-file",
      fileUniqueId: "document-unique",
      fileName: "file.bin",
      fileSize: 4,
      mimeType: "application/octet-stream"
    });
    fixture.store.completeChatMessageAttachment(message.id, Buffer.from("data"), ".bin", "application/octet-stream");
    addMedia(fixture.store, 4, 2);
    const sessionId = fixture.store.listActiveChatSessions().items[0].id;
    const deleted = fixture.store.deleteChatSession(sessionId);
    assert.equal(deleted.deleted, true);
    assert.deepEqual(deleted.userIds, [1, 2]);
    assert.equal(fixture.store.getUser(1).partner_id, null);
    assert.equal(fixture.store.getUser(2).partner_id, null);
    assert.equal(fixture.store.listActiveChatSessions().total, 0);
    assert.equal(fs.readdirSync(path.join(fixture.archiveRoot, "files")).length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("archive message extraction covers the supported conversation payloads", () => {
  assert.deepEqual(archivedMessageFromMessage({ text: "hello" }).kind, "text");
  assert.equal(archivedMessageFromMessage({ voice: { file_id: "voice", file_unique_id: "vu" } }).kind, "voice");
  assert.equal(archivedMessageFromMessage({ document: { file_id: "doc", file_unique_id: "du", file_name: "a.txt" } }).kind, "document");
  assert.equal(archivedMessageFromMessage({ sticker: { file_id: "sticker", file_unique_id: "su", emoji: "🙂" } }).stickerEmoji, "🙂");
  assert.equal(archivedMessageFromMessage({ animation: { file_id: "gif", file_unique_id: "gu" } }).kind, "animation");
  assert.equal(archivedMessageFromMessage({ photo: [{ file_id: "photo", file_unique_id: "pu" }] }).kind, "photo");
  assert.equal(archivedMessageFromMessage({ video: { file_id: "video", file_unique_id: "vv" } }).kind, "video");
  assert.equal(archivedMessageFromMessage({ video_note: { file_id: "circle", file_unique_id: "cv" } }).kind, "video_note");
});
