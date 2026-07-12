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

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 240),
  started_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS bans (
  user_id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_focus_due ON sessions(status, ends_at);
`;

export class FocusStore {
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

  startSession(userId, goal, durationMinutes, now = Math.floor(Date.now() / 1000)) {
    this.cancelSession(userId);
    const endsAt = now + durationMinutes * 60;
    const result = this.db.prepare(`
      INSERT INTO sessions (user_id, goal, duration_minutes, started_at, ends_at, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `).run(userId, goal, durationMinutes, now, endsAt);
    return this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(result.lastInsertRowid);
  }

  activeSession(userId) {
    return this.db.prepare(`
      SELECT * FROM sessions WHERE user_id = ? AND status = 'active'
      ORDER BY id DESC LIMIT 1
    `).get(userId);
  }

  cancelSession(userId) {
    const current = this.activeSession(userId);
    if (current) this.db.prepare("UPDATE sessions SET status = 'cancelled' WHERE id = ?").run(current.id);
    return current ?? null;
  }

  dueSessions(now = Math.floor(Date.now() / 1000), limit = 100) {
    return this.db.prepare(`
      SELECT * FROM sessions
      WHERE status = 'active' AND ends_at <= ?
      ORDER BY ends_at LIMIT ?
    `).all(now, limit);
  }

  completeSession(id) {
    const result = this.db.prepare("UPDATE sessions SET status = 'completed' WHERE id = ? AND status = 'active'").run(id);
    return result.changes === 1;
  }

  userStats(userId) {
    return this.db.prepare(`
      SELECT
        COUNT(*) AS sessions,
        COALESCE(SUM(duration_minutes), 0) AS minutes,
        COALESCE(SUM(CASE WHEN started_at >= unixepoch('now', 'start of day') THEN 1 ELSE 0 END), 0) AS today
      FROM sessions WHERE user_id = ? AND status = 'completed'
    `).get(userId);
  }

  stats() {
    return {
      users: this.db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
      active: this.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE status = 'active'").get().count,
      completed: this.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE status = 'completed'").get().count,
      minutes: this.db.prepare("SELECT COALESCE(SUM(duration_minutes), 0) AS count FROM sessions WHERE status = 'completed'").get().count,
      banned: this.db.prepare("SELECT COUNT(*) AS count FROM bans").get().count
    };
  }

  growthStats() {
    return {
      newToday: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= date('now')").get().count,
      new7: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now', '-7 days')").get().count,
      referred: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE source LIKE 'ref_%'").get().count,
      sessions7: this.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE started_at >= unixepoch() - 604800").get().count,
      completed7: this.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE status = 'completed' AND started_at >= unixepoch() - 604800").get().count
    };
  }

  isBanned(userId) {
    return Boolean(this.db.prepare("SELECT 1 FROM bans WHERE user_id = ?").get(userId));
  }

  banUser(userId) {
    this.cancelSession(userId);
    this.db.prepare("INSERT OR IGNORE INTO bans (user_id) VALUES (?)").run(userId);
  }

  unbanUser(userId) {
    this.db.prepare("DELETE FROM bans WHERE user_id = ?").run(userId);
  }
}
