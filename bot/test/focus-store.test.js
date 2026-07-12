import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { FocusStore } from "../src/focus-store.js";

function withStore(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "focus-sprint-"));
  const store = new FocusStore(path.join(directory, "test.db"));
  try {
    callback(store);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("focus sessions persist their goal and deadline", () => {
  withStore((store) => {
    store.upsertUser(1, "first");
    const session = store.startSession(1, "Finish the report", 25, 1_000);
    assert.equal(session.goal, "Finish the report");
    assert.equal(session.ends_at, 2_500);
    assert.equal(store.activeSession(1).id, session.id);
  });
});

test("starting a new session cancels the previous one", () => {
  withStore((store) => {
    store.upsertUser(1, "first");
    const first = store.startSession(1, "First", 25, 1_000);
    const second = store.startSession(1, "Second", 50, 2_000);
    assert.equal(store.activeSession(1).id, second.id);
    assert.equal(store.db.prepare("SELECT status FROM sessions WHERE id = ?").get(first.id).status, "cancelled");
  });
});

test("due sessions complete only once and update statistics", () => {
  withStore((store) => {
    store.upsertUser(1, "first");
    const session = store.startSession(1, "Deep work", 25, 1_000);
    assert.equal(store.dueSessions(2_499).length, 0);
    assert.equal(store.dueSessions(2_500).length, 1);
    assert.equal(store.completeSession(session.id), true);
    assert.equal(store.completeSession(session.id), false);
    assert.equal(store.userStats(1).sessions, 1);
    assert.equal(store.stats().minutes, 25);
  });
});

test("banning a focus user cancels the active timer", () => {
  withStore((store) => {
    store.upsertUser(1, "first");
    store.startSession(1, "Task", 25, 1_000);
    store.banUser(1);
    assert.equal(store.isBanned(1), true);
    assert.equal(store.activeSession(1), undefined);
  });
});

test("focus growth tracks recent sessions", () => {
  withStore((store) => {
    store.upsertUser(1, "first", "ref_2");
    const session = store.startSession(1, "Task", 25);
    store.completeSession(session.id);
    const growth = store.growthStats();
    assert.equal(growth.referred, 1);
    assert.equal(growth.sessions7, 1);
    assert.equal(growth.completed7, 1);
  });
});
