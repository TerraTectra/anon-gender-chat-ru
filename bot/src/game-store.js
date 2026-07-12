import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  age_group TEXT CHECK (age_group IN ('minor', 'adult')),
  platform TEXT CHECK (platform IN ('pc', 'playstation', 'xbox', 'mobile')),
  game_key TEXT,
  game_label TEXT,
  play_style TEXT CHECK (play_style IN ('casual', 'ranked', 'any')),
  partner_id INTEGER,
  state TEXT NOT NULL DEFAULT 'idle',
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS queue (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
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

CREATE INDEX IF NOT EXISTS idx_game_queue ON queue(created_at);
CREATE INDEX IF NOT EXISTS idx_game_match ON users(age_group, platform, game_key, play_style);
CREATE INDEX IF NOT EXISTS idx_game_events ON events(type, created_at);
`;

export function normalizeGame(value) {
  return value.toLowerCase().replace(/[^a-zа-яё0-9]+/giu, " ").trim().replace(/\s+/g, " ");
}

function stylesCompatible(left, right) {
  return left === "any" || right === "any" || left === right;
}

export class GameStore {
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
    const allowed = new Set(["age_group", "platform", "game_key", "game_label", "play_style", "state"]);
    const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
    if (!entries.length) return this.getUser(id);
    const sql = entries.map(([key]) => `${key} = ?`).join(", ");
    this.db.prepare(`UPDATE users SET ${sql}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...entries.map(([, value]) => value), id);
    return this.getUser(id);
  }

  invitedCount(id) {
    return this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE source = ?")
      .get(`ref_${id}`).count;
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

  enqueue(userId) {
    const user = this.getUser(userId);
    if (!user?.age_group || !user?.platform || !user?.game_key || !user?.play_style) return { status: "profile_required" };
    this.disconnect(userId);
    this.db.prepare("INSERT OR REPLACE INTO queue (user_id, created_at) VALUES (?, CURRENT_TIMESTAMP)").run(userId);
    this.setProfile(userId, { state: "searching" });
    return this.tryMatch(userId);
  }

  tryMatch(userId) {
    const user = this.getUser(userId);
    const candidates = this.db.prepare(`
      SELECT u.* FROM queue q JOIN users u ON u.id = q.user_id
      WHERE q.user_id != ?
        AND u.age_group = ?
        AND u.platform = ?
        AND u.game_key = ?
        AND u.partner_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM bans x WHERE x.user_id = u.id)
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.user_id = ? AND b.blocked_user_id = u.id)
             OR (b.user_id = u.id AND b.blocked_user_id = ?)
        )
      ORDER BY q.created_at
    `).all(userId, user.age_group, user.platform, user.game_key, userId, userId);
    const match = candidates.find((candidate) => stylesCompatible(user.play_style, candidate.play_style));
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
    if (user?.partner_id) this.db.prepare("UPDATE users SET partner_id = NULL, state = 'idle' WHERE id = ?").run(user.partner_id);
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
      SELECT id, reporter_id, reported_id, created_at
      FROM reports WHERE reviewed_at IS NULL
      ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  }
}
