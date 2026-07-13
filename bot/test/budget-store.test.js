import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { BudgetStore } from "../src/budget-store.js";
import { formatMoney, parseEntry, parseLimit } from "../src/budget-bot.js";

function withStore(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "budget-bot-"));
  const store = new BudgetStore(path.join(directory, "test.db"));
  try {
    callback(store);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("budget input accepts decimal commas and a note", () => {
  assert.deepEqual(parseEntry("350,50 кофе"), { amountCents: 35050, note: "кофе" });
  assert.equal(parseEntry("кофе 350"), null);
  assert.equal(formatMoney(35050).includes("350,5"), true);
  assert.equal(parseLimit("50000"), 5_000_000);
  assert.equal(parseLimit("99"), null);
});

test("monthly spending limit is stored per user", () => {
  withStore((store) => {
    store.upsertUser(1, "first");
    assert.equal(store.monthlyLimit(1), null);
    store.setMonthlyLimit(1, 5_000_000);
    assert.equal(store.monthlyLimit(1), 5_000_000);
    store.setMonthlyLimit(1, 6_000_000);
    assert.equal(store.monthlyLimit(1), 6_000_000);
    assert.equal(store.clearMonthlyLimit(1), true);
    assert.equal(store.monthlyLimit(1), null);
  });
});

test("daily summary separates income and expenses", () => {
  withStore((store) => {
    const now = new Date(2026, 6, 12, 12, 0, 0);
    const epoch = Math.floor(now.getTime() / 1000);
    store.upsertUser(1, "first");
    store.addEntry(1, "income", 100_000, "freelance", "Заказ", epoch);
    store.addEntry(1, "expense", 35_050, "food", "Кафе", epoch);
    const summary = store.summary(1, "today", now);
    assert.equal(summary.income, 100_000);
    assert.equal(summary.expense, 35_050);
    assert.equal(summary.entries, 2);
    assert.equal(summary.categories.length, 1);
    assert.equal(summary.categories[0].category, "food");
    assert.equal(summary.categories[0].amount, 35_050);
  });
});

test("monthly summary excludes entries from another month", () => {
  withStore((store) => {
    const now = new Date(2026, 6, 12, 12, 0, 0);
    store.upsertUser(1, "first");
    store.addEntry(1, "expense", 10_000, "other", "Июль", Math.floor(new Date(2026, 6, 2).getTime() / 1000));
    store.addEntry(1, "expense", 20_000, "other", "Июнь", Math.floor(new Date(2026, 5, 30).getTime() / 1000));
    assert.equal(store.summary(1, "month", now).expense, 10_000);
  });
});

test("undo removes only the latest budget entry", () => {
  withStore((store) => {
    store.upsertUser(1, "first");
    store.addEntry(1, "expense", 10_000, "food", "Первое", 1_000);
    store.addEntry(1, "expense", 20_000, "home", "Второе", 2_000);
    assert.equal(store.undoLast(1).note, "Второе");
    assert.equal(store.entriesForExport(1).length, 1);
  });
});

test("budget bans do not delete financial history", () => {
  withStore((store) => {
    store.upsertUser(1, "first");
    store.addEntry(1, "expense", 10_000, "food", "Кафе", 1_000);
    store.banUser(1);
    assert.equal(store.isBanned(1), true);
    assert.equal(store.entriesForExport(1).length, 1);
  });
});

test("budget growth tracks recent active users", () => {
  withStore((store) => {
    store.upsertUser(1, "first", "ref_2");
    store.addEntry(1, "expense", 10_000, "food", "Кафе");
    const growth = store.growthStats();
    assert.equal(growth.referred, 1);
    assert.equal(growth.entries7, 1);
    assert.equal(growth.active7, 1);
  });
});
