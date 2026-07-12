import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  category TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bans (
  user_id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_budget_user_date ON entries(user_id, created_at);
`;

function periodBounds(period, now = new Date()) {
  const start = new Date(now);
  if (period === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setHours(0, 0, 0, 0);
  }
  const end = new Date(start);
  if (period === "month") end.setMonth(end.getMonth() + 1);
  else end.setDate(end.getDate() + 1);
  return [Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000)];
}

export class BudgetStore {
  constructor(filename) {
    const absolute = path.resolve(filename);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    this.db = new DatabaseSync(absolute);
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  upsertUser(id, username, source = null) {
    this.db.prepare(`
      INSERT INTO users (id, username, source) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        source = COALESCE(users.source, excluded.source),
        updated_at = CURRENT_TIMESTAMP
    `).run(id, username ?? null, source);
  }

  invitedCount(id) {
    return this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE source = ?")
      .get(`ref_${id}`).count;
  }

  addEntry(userId, type, amountCents, category, note, createdAt = Math.floor(Date.now() / 1000)) {
    const result = this.db.prepare(`
      INSERT INTO entries (user_id, type, amount_cents, category, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, type, amountCents, category, note, createdAt);
    return this.db.prepare("SELECT * FROM entries WHERE id = ?").get(result.lastInsertRowid);
  }

  undoLast(userId) {
    const entry = this.db.prepare("SELECT * FROM entries WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(userId);
    if (entry) this.db.prepare("DELETE FROM entries WHERE id = ?").run(entry.id);
    return entry ?? null;
  }

  summary(userId, period, now = new Date()) {
    const [from, to] = periodBounds(period, now);
    const totals = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents ELSE 0 END), 0) AS expense,
        COUNT(*) AS entries
      FROM entries WHERE user_id = ? AND created_at >= ? AND created_at < ?
    `).get(userId, from, to);
    const categories = this.db.prepare(`
      SELECT category, SUM(amount_cents) AS amount
      FROM entries
      WHERE user_id = ? AND type = 'expense' AND created_at >= ? AND created_at < ?
      GROUP BY category ORDER BY amount DESC
    `).all(userId, from, to);
    return { ...totals, categories };
  }

  entriesForExport(userId) {
    return this.db.prepare(`
      SELECT type, amount_cents, category, note, created_at
      FROM entries WHERE user_id = ? ORDER BY created_at, id
    `).all(userId);
  }

  stats() {
    return {
      users: this.db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
      entries: this.db.prepare("SELECT COUNT(*) AS count FROM entries").get().count,
      active30: this.db.prepare("SELECT COUNT(DISTINCT user_id) AS count FROM entries WHERE created_at >= unixepoch() - 2592000").get().count,
      banned: this.db.prepare("SELECT COUNT(*) AS count FROM bans").get().count
    };
  }

  growthStats() {
    return {
      newToday: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= date('now')").get().count,
      new7: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now', '-7 days')").get().count,
      referred: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE source LIKE 'ref_%'").get().count,
      entries7: this.db.prepare("SELECT COUNT(*) AS count FROM entries WHERE created_at >= unixepoch() - 604800").get().count,
      active7: this.db.prepare("SELECT COUNT(DISTINCT user_id) AS count FROM entries WHERE created_at >= unixepoch() - 604800").get().count
    };
  }

  isBanned(userId) {
    return Boolean(this.db.prepare("SELECT 1 FROM bans WHERE user_id = ?").get(userId));
  }

  banUser(userId) {
    this.db.prepare("INSERT OR IGNORE INTO bans (user_id) VALUES (?)").run(userId);
  }

  unbanUser(userId) {
    this.db.prepare("DELETE FROM bans WHERE user_id = ?").run(userId);
  }
}

export { periodBounds };
