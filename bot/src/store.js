import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ageGroup, queuesAreCompatible } from "./matching.js";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  gender TEXT CHECK (gender IN ('male', 'female')),
  age INTEGER CHECK (age BETWEEN 12 AND 99),
  partner_id INTEGER,
  state TEXT NOT NULL DEFAULT 'idle',
  filter_gender TEXT NOT NULL DEFAULT 'any',
  filter_min_age INTEGER NOT NULL DEFAULT 12,
  filter_max_age INTEGER NOT NULL DEFAULT 99,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS queue (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('random', 'filtered')),
  target_gender TEXT NOT NULL DEFAULT 'any',
  min_age INTEGER NOT NULL,
  max_age INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blocks (
  user_id INTEGER NOT NULL,
  blocked_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, blocked_user_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  reported_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'user_report',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS filtered_usage (
  user_id INTEGER NOT NULL,
  usage_date TEXT NOT NULL,
  matches INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

CREATE TABLE IF NOT EXISTS bans (
  user_id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_queue_created ON queue(created_at);
CREATE INDEX IF NOT EXISTS idx_reports_reviewed ON reports(reviewed_at, created_at);
CREATE INDEX IF NOT EXISTS idx_events_type_date ON events(type, created_at);
`;

export class Store {
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
    return this.getUser(id);
  }

  getUser(id) {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  }

  setProfile(id, patch) {
    const allowed = new Set(["gender", "age", "state", "filter_gender", "filter_min_age", "filter_max_age"]);
    const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
    if (!entries.length) return this.getUser(id);
    const sql = entries.map(([key]) => `${key} = ?`).join(", ");
    this.db.prepare(`UPDATE users SET ${sql}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...entries.map(([, value]) => value), id);
    return this.getUser(id);
  }

  filteredRemaining(id) {
    const row = this.db.prepare(`
      SELECT matches FROM filtered_usage
      WHERE user_id = ? AND usage_date = date('now')
    `).get(id);
    return Math.max(0, 50 - Number(row?.matches ?? 0));
  }

  invitedCount(id) {
    return this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE source = ?")
      .get(`ref_${id}`).count;
  }

  sourceStats(limit = 10) {
    return this.db.prepare(`
      SELECT source, COUNT(*) AS users FROM users
      WHERE source IS NOT NULL GROUP BY source ORDER BY users DESC, source LIMIT ?
    `).all(limit);
  }

  recordEvent(userId, type) {
    this.db.prepare("INSERT INTO events (user_id, type) VALUES (?, ?)").run(userId, type);
  }

  growthStats() {
    const eventCount = (type) => this.db.prepare(`
      SELECT COUNT(*) AS count FROM events WHERE type = ? AND created_at >= datetime('now', '-7 days')
    `).get(type).count;
    return {
      newToday: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= date('now')").get().count,
      new7: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now', '-7 days')").get().count,
      referred: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE source LIKE 'ref_%'").get().count,
      starts7: eventCount("start"),
      searches7: eventCount("search"),
      matches7: eventCount("match"),
      reports7: eventCount("report")
    };
  }

  incrementFiltered(id) {
    this.db.prepare(`
      INSERT INTO filtered_usage (user_id, usage_date, matches)
      VALUES (?, date('now'), 1)
      ON CONFLICT(user_id, usage_date) DO UPDATE SET matches = matches + 1
    `).run(id);
  }

  enqueue(userId, mode, targetGender = "any", minAge = 12, maxAge = 99) {
    const current = this.getUser(userId);
    if (!current?.gender || !current?.age) return { status: "profile_required" };
    if (mode === "filtered" && this.filteredRemaining(userId) <= 0) {
      return { status: "limit" };
    }

    this.disconnect(userId);
    this.db.prepare(`
      INSERT OR REPLACE INTO queue (user_id, mode, target_gender, min_age, max_age, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(userId, mode, targetGender, minAge, maxAge);
    this.setProfile(userId, { state: "searching" });
    return this.tryMatch(userId);
  }

  tryMatch(userId) {
    const user = this.getUser(userId);
    const ownQueue = this.db.prepare("SELECT * FROM queue WHERE user_id = ?").get(userId);
    if (!ownQueue) return { status: "waiting" };

    const candidates = this.db.prepare(`
      SELECT u.*, q.mode AS q_mode, q.target_gender AS q_target_gender,
             q.min_age AS q_min_age, q.max_age AS q_max_age
      FROM queue q
      JOIN users u ON u.id = q.user_id
      WHERE q.user_id != ?
        AND u.partner_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM bans x WHERE x.user_id = u.id)
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.user_id = ? AND b.blocked_user_id = u.id)
             OR (b.user_id = u.id AND b.blocked_user_id = ?)
        )
      ORDER BY q.created_at
    `).all(userId, userId, userId);

    const leftQueue = {
      mode: ownQueue.mode,
      targetGender: ownQueue.target_gender,
      minAge: ownQueue.min_age,
      maxAge: ownQueue.max_age
    };
    const match = candidates.find((candidate) => queuesAreCompatible(
      leftQueue,
      { gender: user.gender, age: user.age },
      {
        mode: candidate.q_mode,
        targetGender: candidate.q_target_gender,
        minAge: candidate.q_min_age,
        maxAge: candidate.q_max_age
      },
      { gender: candidate.gender, age: candidate.age }
    ));

    if (!match) return { status: "waiting" };

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const stillFree = this.db.prepare(`
        SELECT COUNT(*) AS count FROM queue q JOIN users u ON u.id = q.user_id
        WHERE q.user_id IN (?, ?) AND u.partner_id IS NULL
      `).get(userId, match.id);
      if (Number(stillFree.count) !== 2) {
        this.db.exec("ROLLBACK");
        return { status: "waiting" };
      }
      this.db.prepare("DELETE FROM queue WHERE user_id IN (?, ?)").run(userId, match.id);
      this.db.prepare("UPDATE users SET partner_id = ?, state = 'chatting' WHERE id = ?").run(match.id, userId);
      this.db.prepare("UPDATE users SET partner_id = ?, state = 'chatting' WHERE id = ?").run(userId, match.id);
      if (ownQueue.mode === "filtered") this.incrementFiltered(userId);
      if (match.q_mode === "filtered") this.incrementFiltered(match.id);
      this.db.exec("COMMIT");
      return { status: "matched", partnerId: match.id };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  disconnect(userId) {
    const user = this.getUser(userId);
    this.db.prepare("DELETE FROM queue WHERE user_id = ?").run(userId);
    this.db.prepare("UPDATE users SET partner_id = NULL, state = 'idle' WHERE id = ?").run(userId);
    if (user?.partner_id) {
      this.db.prepare("UPDATE users SET partner_id = NULL, state = 'idle' WHERE id = ?").run(user.partner_id);
    }
    return user?.partner_id ?? null;
  }

  reportAndBlock(reporterId, reportedId) {
    this.db.prepare("INSERT OR IGNORE INTO blocks (user_id, blocked_user_id) VALUES (?, ?)").run(reporterId, reportedId);
    this.db.prepare("INSERT INTO reports (reporter_id, reported_id) VALUES (?, ?)").run(reporterId, reportedId);
    this.disconnect(reporterId);
  }

  isBanned(userId) {
    return Boolean(this.db.prepare("SELECT 1 FROM bans WHERE user_id = ?").get(userId));
  }

  banUser(userId) {
    this.disconnect(userId);
    this.db.prepare("INSERT OR IGNORE INTO bans (user_id) VALUES (?)").run(userId);
  }

  unbanUser(userId) {
    this.db.prepare("DELETE FROM bans WHERE user_id = ?").run(userId);
  }

  reviewReport(reportId) {
    this.db.prepare("UPDATE reports SET reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(reportId);
  }

  stats() {
    return {
      users: this.db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
      searching: this.db.prepare("SELECT COUNT(*) AS count FROM queue").get().count,
      chatting: this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE partner_id IS NOT NULL").get().count / 2,
      reports: this.db.prepare("SELECT COUNT(*) AS count FROM reports WHERE reviewed_at IS NULL").get().count,
      banned: this.db.prepare("SELECT COUNT(*) AS count FROM bans").get().count
    };
  }

  recentReports(limit = 10) {
    return this.db.prepare(`
      SELECT id, reporter_id, reported_id, reason, created_at
      FROM reports WHERE reviewed_at IS NULL
      ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  }
}
