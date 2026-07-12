import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hub_opens_product ON opens(product_id, created_at);
`;

export class HubStore {
  constructor(filename) {
    const absolute = path.resolve(filename);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    this.db = new DatabaseSync(absolute);
    this.db.exec(SCHEMA);
    const suggestionColumns = this.db.prepare("PRAGMA table_info(suggestions)").all();
    if (!suggestionColumns.some((column) => column.name === "status")) {
      this.db.exec("ALTER TABLE suggestions ADD COLUMN status TEXT NOT NULL DEFAULT 'new'");
    }
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

  recordOpen(userId, productId) {
    this.db.prepare("INSERT INTO opens (user_id, product_id) VALUES (?, ?)").run(userId, productId);
  }

  addSuggestion(userId, text) {
    this.db.prepare("INSERT INTO suggestions (user_id, text) VALUES (?, ?)").run(userId, text);
  }

  recentSuggestions(limit = 10, status = "new") {
    return this.db.prepare(`
      SELECT suggestions.id, suggestions.user_id, users.username, suggestions.text,
        suggestions.status, suggestions.created_at
      FROM suggestions LEFT JOIN users ON users.id = suggestions.user_id
      WHERE suggestions.status = ?
      ORDER BY suggestions.id DESC LIMIT ?
    `).all(status, limit);
  }

  reviewSuggestion(id, status) {
    if (!new Set(["planned", "rejected"]).has(status)) return false;
    return this.db.prepare("UPDATE suggestions SET status = ? WHERE id = ? AND status = 'new'")
      .run(status, id).changes === 1;
  }

  popularProducts(limit = 3, days = 30) {
    return this.db.prepare(`
      SELECT product_id, COUNT(*) AS opens
      FROM opens WHERE created_at >= datetime('now', ?)
      GROUP BY product_id ORDER BY opens DESC, product_id LIMIT ?
    `).all(`-${days} days`, limit);
  }

  sourceStats(limit = 10) {
    return this.db.prepare(`
      SELECT source, COUNT(*) AS users FROM users
      WHERE source IS NOT NULL GROUP BY source ORDER BY users DESC, source LIMIT ?
    `).all(limit);
  }

  stats() {
    return {
      users: this.db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
      opens: this.db.prepare("SELECT COUNT(*) AS count FROM opens").get().count,
      suggestions: this.db.prepare("SELECT COUNT(*) AS count FROM suggestions").get().count,
      pendingSuggestions: this.db.prepare("SELECT COUNT(*) AS count FROM suggestions WHERE status = 'new'").get().count
    };
  }

  growthStats() {
    return {
      newToday: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= date('now')").get().count,
      new7: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now', '-7 days')").get().count,
      opens7: this.db.prepare("SELECT COUNT(*) AS count FROM opens WHERE created_at >= datetime('now', '-7 days')").get().count,
      suggestions7: this.db.prepare("SELECT COUNT(*) AS count FROM suggestions WHERE created_at >= datetime('now', '-7 days')").get().count
    };
  }
}
