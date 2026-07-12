import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";

function withStore(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "anon-chat-"));
  const store = new Store(path.join(directory, "test.db"));
  try {
    callback(store);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("store matches compatible adults and disconnects both sides", () => {
  withStore((store) => {
    store.upsertUser(1, "first");
    store.upsertUser(2, "second");
    store.setProfile(1, { gender: "male", age: 25 });
    store.setProfile(2, { gender: "female", age: 23 });

    assert.equal(store.enqueue(1, "random").status, "waiting");
    const result = store.enqueue(2, "random");
    assert.deepEqual(result, { status: "matched", partnerId: 1 });
    assert.equal(store.getUser(1).partner_id, 2);
    assert.equal(store.getUser(2).partner_id, 1);

    assert.equal(store.disconnect(1), 2);
    assert.equal(store.getUser(1).partner_id, null);
    assert.equal(store.getUser(2).partner_id, null);
  });
});

test("store never matches a minor with an adult", () => {
  withStore((store) => {
    store.upsertUser(10, "minor");
    store.upsertUser(20, "adult");
    store.setProfile(10, { gender: "male", age: 17 });
    store.setProfile(20, { gender: "female", age: 18 });
    assert.equal(store.enqueue(10, "random").status, "waiting");
    assert.equal(store.enqueue(20, "random").status, "waiting");
  });
});

test("a report blocks future matches", () => {
  withStore((store) => {
    for (const [id, gender] of [[1, "male"], [2, "female"]]) {
      store.upsertUser(id, String(id));
      store.setProfile(id, { gender, age: 25 });
    }
    store.enqueue(1, "random");
    store.enqueue(2, "random");
    store.reportAndBlock(1, 2);
    assert.equal(store.enqueue(1, "random").status, "waiting");
    assert.equal(store.enqueue(2, "random").status, "waiting");
    assert.equal(store.stats().reports, 1);
  });
});

