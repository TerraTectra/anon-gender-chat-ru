import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { GameStore, normalizeGame } from "../src/game-store.js";

function withStore(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "game-mate-"));
  const store = new GameStore(path.join(directory, "test.db"));
  try {
    callback(store);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function addProfile(store, id, overrides = {}) {
  store.upsertUser(id, `player-${id}`);
  store.setProfile(id, {
    age_group: "adult",
    platform: "pc",
    game_key: "cs2",
    game_label: "CS2",
    play_style: "casual",
    ...overrides
  });
}

test("game names are normalized for custom matchmaking", () => {
  assert.equal(normalizeGame("  Counter-Strike   2! "), "counter strike 2");
  assert.equal(normalizeGame("Мир Танков"), "мир танков");
});

test("players match by game, platform and age group", () => {
  withStore((store) => {
    addProfile(store, 1);
    addProfile(store, 2);
    assert.equal(store.enqueue(1).status, "waiting");
    assert.deepEqual(store.enqueue(2), { status: "matched", partnerId: 1 });
  });
});

test("minor and adult players never match", () => {
  withStore((store) => {
    addProfile(store, 1, { age_group: "minor" });
    addProfile(store, 2, { age_group: "adult" });
    assert.equal(store.enqueue(1).status, "waiting");
    assert.equal(store.enqueue(2).status, "waiting");
  });
});

test("ranked and casual players need an any-style participant", () => {
  withStore((store) => {
    addProfile(store, 1, { play_style: "ranked" });
    addProfile(store, 2, { play_style: "casual" });
    addProfile(store, 3, { play_style: "any" });
    assert.equal(store.enqueue(1).status, "waiting");
    assert.equal(store.enqueue(2).status, "waiting");
    const result = store.enqueue(3);
    assert.equal(result.status, "matched");
    assert.equal([1, 2].includes(result.partnerId), true);
  });
});

test("game reports block future matches", () => {
  withStore((store) => {
    addProfile(store, 1);
    addProfile(store, 2);
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
