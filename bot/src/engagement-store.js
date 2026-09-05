import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sourcePerformanceStats } from "./source-performance.js";

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_engagement_actions_user ON actions(user_id, created_at);
`;

export class EngagementStore {
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

  recordAction(userId, type, points = 0) {
    this.db.prepare("INSERT INTO actions (user_id, type, points) VALUES (?, ?, ?)").run(userId, type, points);
  }

  recordUniqueAction(userId, type, points = 0) {
    return this.db.prepare(`
      INSERT INTO actions (user_id, type, points)
      SELECT ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM actions WHERE user_id = ? AND type = ?
      )
    `).run(userId, type, points, userId, type).changes === 1;
  }

  hasAction(userId, type) {
    return Boolean(this.db.prepare("SELECT 1 FROM actions WHERE user_id = ? AND type = ?").get(userId, type));
  }

  activityStreak(userId, now = new Date()) {
    const days = this.db.prepare(`
      SELECT DISTINCT date(created_at, '+3 hours') AS day
      FROM actions WHERE user_id = ? ORDER BY day DESC
    `).all(userId).map((row) => row.day);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now);
    const before = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    let longest = 0;
    let run = 0;
    let previous = null;
    for (const day of [...days].reverse()) {
      run = previous && before(day) === previous ? run + 1 : 1;
      longest = Math.max(longest, run);
      previous = day;
    }
    const latest = days[0];
    const currentEligible = latest === today || latest === before(today);
    let current = 0;
    if (currentEligible) {
      let expected = latest;
      for (const day of days) {
        if (day !== expected) break;
        current += 1;
        expected = before(expected);
      }
    }
    return { current, longest, activeToday: latest === today };
  }

  userStats(userId) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS actions, COALESCE(SUM(points), 0) AS score
      FROM actions WHERE user_id = ?
    `).get(userId);
    return { actions: row.actions, score: row.score };
  }

  quizStats(userId) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS actions, COALESCE(SUM(points), 0) AS score
      FROM actions
      WHERE user_id = ? AND (type = 'answer' OR type LIKE 'daily_%')
    `).get(userId);
    return { actions: row.actions, score: row.score };
  }

  invitedCount(userId) {
    return this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE source = ?").get(`ref_${userId}`).count;
  }

  sourceStats(limit = 10) {
    return this.db.prepare(`
      SELECT source, COUNT(*) AS users FROM users
      WHERE source IS NOT NULL GROUP BY source ORDER BY users DESC, source LIMIT ?
    `).all(limit);
  }

  sourcePerformanceStats(limit = 10) {
    return sourcePerformanceStats(this.db, `
      SELECT user_id, COUNT(*) AS actions FROM actions GROUP BY user_id
    `, limit);
  }

  stats() {
    return {
      users: this.db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
      actions: this.db.prepare("SELECT COUNT(*) AS count FROM actions").get().count,
      score: this.db.prepare("SELECT COALESCE(SUM(points), 0) AS count FROM actions").get().count
    };
  }

  growthStats() {
    return {
      newToday: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= date('now')").get().count,
      new7: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now', '-7 days')").get().count,
      referred: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE source LIKE 'ref_%'").get().count,
      actions7: this.db.prepare("SELECT COUNT(*) AS count FROM actions WHERE created_at >= datetime('now', '-7 days')").get().count,
      active7: this.db.prepare("SELECT COUNT(DISTINCT user_id) AS count FROM actions WHERE created_at >= datetime('now', '-7 days')").get().count
    };
  }
}
