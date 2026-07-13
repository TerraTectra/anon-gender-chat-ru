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
  source TEXT NOT NULL DEFAULT 'catalog',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT,
  request TEXT NOT NULL,
  budget TEXT NOT NULL,
  deadline TEXT NOT NULL,
  source TEXT,
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
    const openColumns = this.db.prepare("PRAGMA table_info(opens)").all();
    if (!openColumns.some((column) => column.name === "source")) {
      this.db.exec("ALTER TABLE opens ADD COLUMN source TEXT NOT NULL DEFAULT 'catalog'");
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

  recordOpen(userId, productId, source = "catalog") {
    this.db.prepare("INSERT INTO opens (user_id, product_id, source) VALUES (?, ?, ?)").run(userId, productId, source);
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

  openSourceStats(limit = 10, days = 30) {
    return this.db.prepare(`
      SELECT source, COUNT(*) AS opens, COUNT(DISTINCT user_id) AS users
      FROM opens WHERE created_at >= datetime('now', ?)
      GROUP BY source ORDER BY opens DESC, source LIMIT ?
    `).all(`-${days} days`, limit);
  }

  funnelStats(days = 30) {
    const since = `-${days} days`;
    return {
      users: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now', ?)").get(since).count,
      engaged: this.db.prepare("SELECT COUNT(DISTINCT user_id) AS count FROM opens WHERE created_at >= datetime('now', ?)").get(since).count,
      favorited: this.db.prepare("SELECT COUNT(DISTINCT user_id) AS count FROM favorites WHERE created_at >= datetime('now', ?)").get(since).count,
      leads: this.db.prepare("SELECT COUNT(DISTINCT user_id) AS count FROM leads WHERE created_at >= datetime('now', ?)").get(since).count,
      opens: this.db.prepare("SELECT COUNT(*) AS count FROM opens WHERE created_at >= datetime('now', ?)").get(since).count
    };
  }

  productPerformance(days = 30) {
    const since = `-${days} days`;
    const rows = new Map();
    for (const row of this.db.prepare(`
      SELECT product_id, COUNT(*) AS opens, COUNT(DISTINCT user_id) AS users
      FROM opens WHERE created_at >= datetime('now', ?)
      GROUP BY product_id
    `).all(since)) {
      rows.set(row.product_id, { product_id: row.product_id, opens: row.opens, users: row.users, favorites: 0 });
    }
    for (const row of this.db.prepare(`
      SELECT product_id, COUNT(*) AS favorites
      FROM favorites WHERE created_at >= datetime('now', ?)
      GROUP BY product_id
    `).all(since)) {
      const current = rows.get(row.product_id) || { product_id: row.product_id, opens: 0, users: 0, favorites: 0 };
      current.favorites = row.favorites;
      rows.set(row.product_id, current);
    }
    return [...rows.values()].sort((left, right) =>
      right.users - left.users || right.opens - left.opens || right.favorites - left.favorites || left.product_id.localeCompare(right.product_id));
  }

  recentProductIds(userId, limit = 5) {
    return this.db.prepare(`
      SELECT product_id, MAX(id) AS last_open
      FROM opens WHERE user_id = ?
      GROUP BY product_id ORDER BY last_open DESC LIMIT ?
    `).all(userId, limit).map((row) => row.product_id);
  }

  favoriteIds(userId) {
    return this.db.prepare("SELECT product_id FROM favorites WHERE user_id = ? ORDER BY created_at")
      .all(userId).map((row) => row.product_id);
  }

  isFavorite(userId, productId) {
    return Boolean(this.db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ?").get(userId, productId));
  }

  toggleFavorite(userId, productId) {
    if (this.isFavorite(userId, productId)) {
      this.db.prepare("DELETE FROM favorites WHERE user_id = ? AND product_id = ?").run(userId, productId);
      return false;
    }
    this.db.prepare("INSERT INTO favorites (user_id, product_id) VALUES (?, ?)").run(userId, productId);
    return true;
  }

  addLead(userId, username, request, budget, deadline, source = null) {
    const result = this.db.prepare(`
      INSERT INTO leads (user_id, username, request, budget, deadline, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, username ?? null, request, budget, deadline, source);
    return this.db.prepare("SELECT * FROM leads WHERE id = ?").get(result.lastInsertRowid);
  }

  recentLeads(limit = 10, status = "new") {
    return this.db.prepare("SELECT * FROM leads WHERE status = ? ORDER BY id DESC LIMIT ?").all(status, limit);
  }

  reviewLead(id, status) {
    if (!new Set(["contacted", "won", "rejected"]).has(status)) return false;
    return this.db.prepare("UPDATE leads SET status = ? WHERE id = ? AND status = 'new'").run(status, id).changes === 1;
  }

  sourceStats(limit = 10) {
    return this.db.prepare(`
      SELECT source, COUNT(*) AS users FROM users
      WHERE source IS NOT NULL GROUP BY source ORDER BY users DESC, source LIMIT ?
    `).all(limit);
  }

  invitedCount(userId) {
    return this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE source = ?").get(`ref_${userId}`).count;
  }

  stats() {
    return {
      users: this.db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
      opens: this.db.prepare("SELECT COUNT(*) AS count FROM opens").get().count,
      suggestions: this.db.prepare("SELECT COUNT(*) AS count FROM suggestions").get().count,
      pendingSuggestions: this.db.prepare("SELECT COUNT(*) AS count FROM suggestions WHERE status = 'new'").get().count,
      favorites: this.db.prepare("SELECT COUNT(*) AS count FROM favorites").get().count,
      leads: this.db.prepare("SELECT COUNT(*) AS count FROM leads").get().count,
      pendingLeads: this.db.prepare("SELECT COUNT(*) AS count FROM leads WHERE status = 'new'").get().count
    };
  }

  growthStats() {
    return {
      newToday: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= date('now')").get().count,
      new7: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now', '-7 days')").get().count,
      opens7: this.db.prepare("SELECT COUNT(*) AS count FROM opens WHERE created_at >= datetime('now', '-7 days')").get().count,
      suggestions7: this.db.prepare("SELECT COUNT(*) AS count FROM suggestions WHERE created_at >= datetime('now', '-7 days')").get().count,
      leads7: this.db.prepare("SELECT COUNT(*) AS count FROM leads WHERE created_at >= datetime('now', '-7 days')").get().count
    };
  }
}
