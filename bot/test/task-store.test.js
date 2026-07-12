import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TaskStore } from "../src/task-store.js";

function createStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "task-pulse-"));
  const store = new TaskStore(path.join(directory, "tasks.db"));
  return { store, cleanup: () => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test("tasks become due, can be snoozed and completed", () => {
  const { store, cleanup } = createStore();
  store.upsertUser(1, "tester", "src_test");
  const task = store.addTask(1, "Позвонить клиенту", 100);
  assert.equal(store.dueTasks(99).length, 0);
  assert.equal(store.dueTasks(100)[0].id, task.id);
  assert.equal(store.markNotified(task.id), true);
  assert.equal(store.snoozeTask(task.id, 1, 600, 100), true);
  assert.equal(store.dueTasks(699).length, 0);
  assert.equal(store.dueTasks(700).length, 1);
  assert.equal(store.completeTask(task.id, 1), true);
  assert.deepEqual(store.userStats(1), { active: 0, done: 1 });
  cleanup();
});

test("users cannot modify another user's task", () => {
  const { store, cleanup } = createStore();
  store.upsertUser(1, "owner");
  store.upsertUser(2, "other");
  const task = store.addTask(1, "Секретная задача", 100);
  assert.equal(store.completeTask(task.id, 2), false);
  assert.equal(store.cancelTask(task.id, 2), false);
  assert.equal(store.snoozeTask(task.id, 2, 600, 100), false);
  cleanup();
});
