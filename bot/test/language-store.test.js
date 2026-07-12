import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { LanguageStore } from "../src/language-store.js";

function withStore(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "english-match-"));
  const store = new LanguageStore(path.join(directory, "test.db"));
  try {
    callback(store);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function addProfile(store, id, ageGroup, level) {
  store.upsertUser(id, `user-${id}`);
  store.setProfile(id, { age_group: ageGroup, level });
}

test("language partners match at the same or adjacent level", () => {
  withStore((store) => {
    addProfile(store, 1, "adult", "beginner");
    addProfile(store, 2, "adult", "intermediate");
    assert.equal(store.enqueue(1).status, "waiting");
    assert.deepEqual(store.enqueue(2), { status: "matched", partnerId: 1 });
  });
});

test("language partners never cross the minor boundary", () => {
  withStore((store) => {
    addProfile(store, 1, "minor", "intermediate");
    addProfile(store, 2, "adult", "intermediate");
    assert.equal(store.enqueue(1).status, "waiting");
    assert.equal(store.enqueue(2).status, "waiting");
  });
});

test("distant levels wait for a closer partner", () => {
  withStore((store) => {
    addProfile(store, 1, "adult", "beginner");
    addProfile(store, 2, "adult", "advanced");
    assert.equal(store.enqueue(1).status, "waiting");
    assert.equal(store.enqueue(2).status, "waiting");
  });
});

test("reports prevent future language matches", () => {
  withStore((store) => {
    addProfile(store, 1, "adult", "intermediate");
    addProfile(store, 2, "adult", "intermediate");
    store.enqueue(1);
    store.enqueue(2);
    store.reportAndBlock(1, 2);
    store.recordEvent(1, "report");
    assert.equal(store.enqueue(1).status, "waiting");
    assert.equal(store.enqueue(2).status, "waiting");
    assert.equal(store.stats().reports, 1);
    assert.equal(store.growthStats().reports7, 1);
  });
});
