import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { collectNetworkMetrics } from "../src/network-metrics.js";

test("network metrics deduplicate registrations and count active regular users", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tectra-network-metrics-"));
  const anonPath = path.join(dir, "chat.db");
  const nichePath = path.join(dir, "niche.db");
  const anon = new DatabaseSync(anonPath);
  const niche = new DatabaseSync(nichePath);
  try {
    anon.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE events (id INTEGER PRIMARY KEY, user_id INTEGER, created_at TEXT);
      CREATE TABLE bot_access (user_id INTEGER PRIMARY KEY, status TEXT, last_inbound_at TEXT);
      CREATE TABLE user_activity_days (user_id INTEGER, activity_date TEXT, PRIMARY KEY (user_id, activity_date));
    `);
    anon.prepare("INSERT INTO users(id) VALUES (?), (?), (?)").run(1, 2, 3);
    anon.prepare("INSERT INTO bot_access(user_id,status,last_inbound_at) VALUES (?,?,?), (?,?,?)")
      .run(1, "active", "2026-09-23 11:00:00", 3, "blocked", "2026-09-23 11:30:00");
    anon.prepare("INSERT INTO events(id,user_id,created_at) VALUES (?,?,?)")
      .run(1, 2, "2026-09-23 10:00:00");
    for (const day of ["2026-09-21", "2026-09-22", "2026-09-23"]) {
      anon.prepare("INSERT INTO user_activity_days(user_id,activity_date) VALUES (?,?)").run(1, day);
      anon.prepare("INSERT INTO user_activity_days(user_id,activity_date) VALUES (?,?)").run(3, day);
    }

    niche.exec(`
      CREATE TABLE niche_users (id INTEGER PRIMARY KEY, updated_at TEXT);
      CREATE TABLE niche_actions (id INTEGER PRIMARY KEY, user_id INTEGER, created_at TEXT);
      CREATE TABLE niche_activity_days (user_id INTEGER, activity_date TEXT, PRIMARY KEY (user_id, activity_date));
    `);
    niche.prepare("INSERT INTO niche_users(id,updated_at) VALUES (?,?), (?,?)")
      .run(1, "2026-09-20 00:00:00", 4, "2026-09-23 09:00:00");
    niche.prepare("INSERT INTO niche_actions(id,user_id,created_at) VALUES (?,?,?)")
      .run(1, 4, "2026-09-23 09:30:00");
    for (const day of ["2026-09-20", "2026-09-22", "2026-09-23"]) {
      niche.prepare("INSERT INTO niche_activity_days(user_id,activity_date) VALUES (?,?)").run(4, day);
    }

    const metrics = collectNetworkMetrics({
      anonDbPath: anonPath,
      nicheDbPaths: [nichePath],
      now: Date.parse("2026-09-23T12:00:00Z")
    });

    assert.deepEqual(metrics, {
      registrations: 4,
      blocked: 1,
      active24h: 3,
      regular7d: 2
    });
  } finally {
    anon.close();
    niche.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
