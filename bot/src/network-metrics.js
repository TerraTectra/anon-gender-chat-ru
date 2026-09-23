import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function openReadOnly(filename) {
  if (!filename) return null;
  const absolute = path.resolve(filename);
  if (!fs.existsSync(absolute)) return null;
  return new DatabaseSync(absolute, { readOnly: true });
}

function utcSql(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 19).replace("T", " ");
}

function moscowDay(timestamp) {
  return new Date(Number(timestamp) + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

function addIds(target, rows, key = "user_id") {
  for (const row of rows) {
    const id = Number(row[key]);
    if (Number.isSafeInteger(id)) target.add(id);
  }
}

function addDays(target, rows) {
  for (const row of rows) {
    const id = Number(row.user_id);
    if (!Number.isSafeInteger(id) || !row.activity_date) continue;
    let days = target.get(id);
    if (!days) {
      days = new Set();
      target.set(id, days);
    }
    days.add(String(row.activity_date));
  }
}

export function collectNetworkMetrics({
  anonDbPath,
  nicheDbPaths = [],
  now = Date.now(),
  regularWindowDays = 7,
  regularMinDays = 3
} = {}) {
  const registrations = new Set();
  const active24h = new Set();
  const activityDays = new Map();
  const blockedIds = new Set();
  const activeSince = utcSql(Number(now) - 24 * 60 * 60 * 1000);
  const activitySinceDay = moscowDay(Number(now) - (Math.max(1, regularWindowDays) - 1) * 24 * 60 * 60 * 1000);

  const anonDb = openReadOnly(anonDbPath);
  if (anonDb) {
    try {
      if (tableExists(anonDb, "users")) {
        addIds(registrations, anonDb.prepare("SELECT id AS user_id FROM users").all());
      }
      if (tableExists(anonDb, "bot_access")) {
        addIds(blockedIds, anonDb.prepare("SELECT user_id FROM bot_access WHERE status = 'blocked'").all());
        addIds(active24h, anonDb.prepare(`
          SELECT user_id FROM bot_access
          WHERE status != 'blocked' AND last_inbound_at IS NOT NULL AND last_inbound_at >= ?
        `).all(activeSince));
      }
      if (tableExists(anonDb, "events")) {
        addIds(active24h, anonDb.prepare("SELECT DISTINCT user_id FROM events WHERE created_at >= ?").all(activeSince));
      }
      if (tableExists(anonDb, "user_activity_days")) {
        addDays(activityDays, anonDb.prepare(`
          SELECT user_id, activity_date FROM user_activity_days WHERE activity_date >= ?
        `).all(activitySinceDay));
      }
    } finally {
      anonDb.close();
    }
  }

  for (const filename of nicheDbPaths) {
    const db = openReadOnly(filename);
    if (!db) continue;
    try {
      if (tableExists(db, "niche_users")) {
        addIds(registrations, db.prepare("SELECT id AS user_id FROM niche_users").all());
        addIds(active24h, db.prepare("SELECT id AS user_id FROM niche_users WHERE updated_at >= ?").all(activeSince));
      }
      if (tableExists(db, "niche_actions")) {
        addIds(active24h, db.prepare("SELECT DISTINCT user_id FROM niche_actions WHERE created_at >= ?").all(activeSince));
      }
      if (tableExists(db, "niche_activity_days")) {
        addDays(activityDays, db.prepare(`
          SELECT user_id, activity_date FROM niche_activity_days WHERE activity_date >= ?
        `).all(activitySinceDay));
      }
    } finally {
      db.close();
    }
  }

  for (const id of blockedIds) active24h.delete(id);

  let regular7d = 0;
  for (const [id, days] of activityDays) {
    if (!blockedIds.has(id) && days.size >= regularMinDays) regular7d += 1;
  }

  return {
    registrations: registrations.size,
    blocked: blockedIds.size,
    active24h: active24h.size,
    regular7d
  };
}
