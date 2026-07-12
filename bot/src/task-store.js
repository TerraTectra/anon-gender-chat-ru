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

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'notified', 'done', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS bans (
  user_id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, status, due_at);
`;

export class TaskStore {
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

  addTask(userId, text, dueAt) {
    const result = this.db.prepare(`
      INSERT INTO tasks (user_id, text, due_at, status) VALUES (?, ?, ?, 'pending')
    `).run(userId, text, dueAt);
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(result.lastInsertRowid);
  }

  activeTasks(userId, limit = 10) {
    return this.db.prepare(`
      SELECT * FROM tasks WHERE user_id = ? AND status IN ('pending', 'notified')
      ORDER BY due_at, id LIMIT ?
    `).all(userId, limit);
  }

  dueTasks(now = Math.floor(Date.now() / 1000), limit = 100) {
    return this.db.prepare(`
      SELECT * FROM tasks WHERE status = 'pending' AND due_at <= ? ORDER BY due_at LIMIT ?
    `).all(now, limit);
  }

  markNotified(id) {
    return this.db.prepare("UPDATE tasks SET status = 'notified' WHERE id = ? AND status = 'pending'")
      .run(id).changes === 1;
  }

  completeTask(id, userId) {
    return this.db.prepare(`
      UPDATE tasks SET status = 'done', completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND status IN ('pending', 'notified')
    `).run(id, userId).changes === 1;
  }

  cancelTask(id, userId) {
    return this.db.prepare(`
      UPDATE tasks SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status IN ('pending', 'notified')
    `).run(id, userId).changes === 1;
  }

  snoozeTask(id, userId, seconds, now = Math.floor(Date.now() / 1000)) {
    return this.db.prepare(`
      UPDATE tasks SET status = 'pending', due_at = ?
      WHERE id = ? AND user_id = ? AND status IN ('pending', 'notified')
    `).run(now + seconds, id, userId).changes === 1;
  }

  invitedCount(id) {
    return this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE source = ?").get(`ref_${id}`).count;
  }

  sourceStats(limit = 10) {
    return this.db.prepare(`
      SELECT source, COUNT(*) AS users FROM users
      WHERE source IS NOT NULL GROUP BY source ORDER BY users DESC, source LIMIT ?
    `).all(limit);
  }

  userStats(userId) {
    return {
      active: this.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status IN ('pending', 'notified')").get(userId).count,
      done: this.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status = 'done'").get(userId).count
    };
  }

  stats() {
    return {
      users: this.db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
      active: this.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status IN ('pending', 'notified')").get().count,
      done: this.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = 'done'").get().count,
      banned: this.db.prepare("SELECT COUNT(*) AS count FROM bans").get().count
    };
  }

  growthStats() {
    return {
      newToday: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= date('now')").get().count,
      new7: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now', '-7 days')").get().count,
      referred: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE source LIKE 'ref_%'").get().count,
      tasks7: this.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE created_at >= datetime('now', '-7 days')").get().count,
      done7: this.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE completed_at >= datetime('now', '-7 days')").get().count
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
