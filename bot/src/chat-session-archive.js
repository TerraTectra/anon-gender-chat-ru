import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const MEDIA_RETENTION_THRESHOLD = 0;
export const MEDIA_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const MEDIA_KINDS = new Set(["photo", "video", "video_note"]);

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA secure_delete = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a_id INTEGER NOT NULL,
  user_b_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  started_at_ms INTEGER NOT NULL,
  last_activity_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  end_reason TEXT,
  media_count INTEGER NOT NULL DEFAULT 0 CHECK (media_count >= 0),
  qualified_at_ms INTEGER,
  expires_at_ms INTEGER,
  legacy_backfill INTEGER NOT NULL DEFAULT 0 CHECK (legacy_backfill IN (0, 1)),
  CHECK (user_a_id < user_b_id)
);

CREATE TABLE IF NOT EXISTS active_chat_session_members (
  user_id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_session_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL,
  source_chat_id INTEGER NOT NULL,
  source_message_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'video', 'video_note')),
  file_id TEXT NOT NULL,
  file_unique_id TEXT,
  media_group_id TEXT,
  file_size INTEGER,
  mime_type TEXT,
  storage_status TEXT NOT NULL DEFAULT 'pending' CHECK (storage_status IN ('pending', 'stored', 'unavailable')),
  local_path TEXT,
  storage_error TEXT,
  created_at_ms INTEGER NOT NULL,
  UNIQUE(source_chat_id, source_message_id)
);

CREATE INDEX IF NOT EXISTS idx_active_session_id
  ON active_chat_session_members(session_id);
CREATE INDEX IF NOT EXISTS idx_session_media
  ON chat_session_media(session_id, id);
CREATE INDEX IF NOT EXISTS idx_sessions_retention
  ON chat_sessions(expires_at_ms);
`;

function canonicalPair(left, right) {
  const first = Number(left);
  const second = Number(right);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(second) || first === second) {
    throw new TypeError("A chat session requires two different safe integer user IDs");
  }
  return first < second ? [first, second] : [second, first];
}

function boundedPageValue(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function safeExtension(value) {
  const normalized = String(value || "").toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(normalized) ? normalized : ".bin";
}

export class ChatSessionArchive {
  constructor(rootDirectory) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.filesDirectory = path.resolve(this.rootDirectory, "files");
    if (!this.filesDirectory.startsWith(`${this.rootDirectory}${path.sep}`)) {
      throw new Error("Session media directory escaped the archive root");
    }
    fs.mkdirSync(this.filesDirectory, { recursive: true });
    this.db = new DatabaseSync(path.join(this.rootDirectory, "sessions.sqlite"));
    this.db.exec(SCHEMA);
    this.closed = false;
  }

  close() {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  #deleteFiles(relativePaths) {
    for (const relativePath of relativePaths) {
      if (!relativePath) continue;
      const candidate = path.resolve(this.rootDirectory, relativePath);
      if (!candidate.startsWith(`${this.filesDirectory}${path.sep}`)) continue;
      fs.rmSync(candidate, { force: true });
    }
  }

  #mediaPaths(sessionId) {
    return this.db.prepare(`
      SELECT local_path FROM chat_session_media
      WHERE session_id = ? AND local_path IS NOT NULL
    `).all(sessionId).map((row) => row.local_path);
  }

  #endSessionInsideTransaction(sessionId, reason, now) {
    const session = this.db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(sessionId);
    if (!session || session.status !== "active") return { session: null, paths: [] };

    const paths = this.#mediaPaths(sessionId);
    this.db.prepare("DELETE FROM active_chat_session_members WHERE session_id = ?").run(sessionId);
    if (Number(session.media_count) <= MEDIA_RETENTION_THRESHOLD) {
      this.db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);
      return {
        session: { ...session, retained: false },
        paths
      };
    }

    const expiresAt = now + MEDIA_RETENTION_MS;
    this.db.prepare(`
      UPDATE chat_sessions
      SET status = 'ended', ended_at_ms = ?, end_reason = ?, expires_at_ms = ?
      WHERE id = ?
    `).run(now, reason, expiresAt, sessionId);
    return {
      session: { ...session, status: "ended", ended_at_ms: now, end_reason: reason, expires_at_ms: expiresAt, retained: true },
      paths: []
    };
  }

  #finishSessions(sessionIds, reason, now) {
    const uniqueIds = [...new Set(sessionIds.map(Number).filter(Number.isSafeInteger))];
    if (!uniqueIds.length) return [];
    const ended = [];
    const paths = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const sessionId of uniqueIds) {
        const result = this.#endSessionInsideTransaction(sessionId, reason, now);
        if (result.session) ended.push(result.session);
        paths.push(...result.paths);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.#deleteFiles(paths);
    return ended;
  }

  ensureActiveSession(leftUserId, rightUserId, now = Date.now(), legacyBackfill = false) {
    const [userAId, userBId] = canonicalPair(leftUserId, rightUserId);
    const staleRows = this.db.prepare(`
      SELECT DISTINCT session_id FROM active_chat_session_members
      WHERE user_id IN (?, ?)
    `).all(userAId, userBId);
    const exact = this.db.prepare(`
      SELECT * FROM chat_sessions
      WHERE status = 'active' AND user_a_id = ? AND user_b_id = ?
      LIMIT 1
    `).get(userAId, userBId);
    const staleIds = staleRows
      .map((row) => Number(row.session_id))
      .filter((sessionId) => sessionId !== Number(exact?.id));
    this.#finishSessions(staleIds, "replaced", now);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare(`
        SELECT * FROM chat_sessions
        WHERE status = 'active' AND user_a_id = ? AND user_b_id = ?
        LIMIT 1
      `).get(userAId, userBId);
      if (existing) {
        this.db.prepare("INSERT OR REPLACE INTO active_chat_session_members (user_id, session_id) VALUES (?, ?)")
          .run(userAId, existing.id);
        this.db.prepare("INSERT OR REPLACE INTO active_chat_session_members (user_id, session_id) VALUES (?, ?)")
          .run(userBId, existing.id);
        this.db.exec("COMMIT");
        return existing;
      }

      const inserted = this.db.prepare(`
        INSERT INTO chat_sessions (
          user_a_id, user_b_id, started_at_ms, last_activity_at_ms, legacy_backfill
        ) VALUES (?, ?, ?, ?, ?)
      `).run(userAId, userBId, now, now, legacyBackfill ? 1 : 0);
      const sessionId = Number(inserted.lastInsertRowid);
      this.db.prepare("INSERT INTO active_chat_session_members (user_id, session_id) VALUES (?, ?)")
        .run(userAId, sessionId);
      this.db.prepare("INSERT INTO active_chat_session_members (user_id, session_id) VALUES (?, ?)")
        .run(userBId, sessionId);
      this.db.exec("COMMIT");
      return this.db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(sessionId);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  endByUser(userId, reason = "ended", now = Date.now()) {
    const row = this.db.prepare(`
      SELECT session_id FROM active_chat_session_members WHERE user_id = ?
    `).get(userId);
    if (!row) return null;
    return this.#finishSessions([row.session_id], reason, now)[0] || null;
  }

  touchByUser(userId, now = Date.now()) {
    const result = this.db.prepare(`
      UPDATE chat_sessions
      SET last_activity_at_ms = ?
      WHERE id = (
        SELECT session_id FROM active_chat_session_members WHERE user_id = ?
      ) AND status = 'active'
    `).run(now, userId);
    return Number(result.changes) > 0;
  }

  beginMedia(userId, media, now = Date.now()) {
    if (!MEDIA_KINDS.has(media?.kind)) throw new TypeError("Unsupported retained media kind");
    const sourceChatId = Number(media.sourceChatId);
    const sourceMessageId = Number(media.sourceMessageId);
    if (!Number.isSafeInteger(sourceChatId) || !Number.isSafeInteger(sourceMessageId)) {
      throw new TypeError("Media source IDs must be safe integers");
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const active = this.db.prepare(`
        SELECT s.id FROM active_chat_session_members m
        JOIN chat_sessions s ON s.id = m.session_id
        WHERE m.user_id = ? AND s.status = 'active'
      `).get(userId);
      if (!active) {
        this.db.exec("COMMIT");
        return null;
      }

      const inserted = this.db.prepare(`
        INSERT OR IGNORE INTO chat_session_media (
          session_id, sender_id, source_chat_id, source_message_id, kind,
          file_id, file_unique_id, media_group_id, file_size, mime_type, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        active.id,
        userId,
        sourceChatId,
        sourceMessageId,
        media.kind,
        media.fileId,
        media.fileUniqueId ?? null,
        media.mediaGroupId ?? null,
        Number.isSafeInteger(media.fileSize) ? media.fileSize : null,
        media.mimeType ?? null,
        now
      );

      if (Number(inserted.changes) === 0) {
        const duplicate = this.db.prepare(`
          SELECT * FROM chat_session_media
          WHERE source_chat_id = ? AND source_message_id = ?
        `).get(sourceChatId, sourceMessageId);
        this.db.exec("COMMIT");
        return duplicate ? { ...duplicate, duplicate: true } : null;
      }

      const mediaId = Number(inserted.lastInsertRowid);
      const count = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM chat_session_media WHERE session_id = ?
      `).get(active.id).count);
      this.db.prepare(`
        UPDATE chat_sessions
        SET media_count = ?, last_activity_at_ms = ?,
            qualified_at_ms = CASE
              WHEN ? > ? THEN COALESCE(qualified_at_ms, ?)
              ELSE qualified_at_ms
            END
        WHERE id = ?
      `).run(count, now, count, MEDIA_RETENTION_THRESHOLD, now, active.id);
      this.db.exec("COMMIT");
      return this.db.prepare("SELECT * FROM chat_session_media WHERE id = ?").get(mediaId);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  completeMedia(mediaId, bytes, extension, mimeType = null) {
    const media = this.db.prepare("SELECT * FROM chat_session_media WHERE id = ?").get(mediaId);
    if (!media || media.storage_status === "stored") return media || null;
    const candidate = path.resolve(this.filesDirectory, `${media.id}${safeExtension(extension)}`);
    if (!candidate.startsWith(`${this.filesDirectory}${path.sep}`)) {
      throw new Error("Session media path escaped the archive directory");
    }
    const temporary = `${candidate}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, Buffer.from(bytes));
    try {
      fs.renameSync(temporary, candidate);
      const relativePath = path.relative(this.rootDirectory, candidate);
      const result = this.db.prepare(`
        UPDATE chat_session_media
        SET storage_status = 'stored', local_path = ?, mime_type = COALESCE(?, mime_type),
            file_size = ?, storage_error = NULL
        WHERE id = ?
      `).run(relativePath, mimeType, fs.statSync(candidate).size, media.id);
      if (Number(result.changes) === 0) fs.rmSync(candidate, { force: true });
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      fs.rmSync(candidate, { force: true });
      throw error;
    }
    return this.db.prepare("SELECT * FROM chat_session_media WHERE id = ?").get(media.id);
  }

  failMedia(mediaId, errorCode) {
    this.db.prepare(`
      UPDATE chat_session_media
      SET storage_status = 'unavailable', storage_error = ?
      WHERE id = ? AND storage_status != 'stored'
    `).run(String(errorCode || "archive_failed").slice(0, 160), mediaId);
  }

  #sessionSelect(whereClause) {
    return `
      SELECT s.*,
        COALESCE(SUM(CASE WHEN m.kind = 'photo' THEN 1 ELSE 0 END), 0) AS photo_count,
        COALESCE(SUM(CASE WHEN m.kind = 'video' THEN 1 ELSE 0 END), 0) AS video_count,
        COALESCE(SUM(CASE WHEN m.kind = 'video_note' THEN 1 ELSE 0 END), 0) AS video_note_count,
        COALESCE(SUM(CASE WHEN m.storage_status = 'stored' THEN 1 ELSE 0 END), 0) AS stored_count,
        COALESCE(SUM(CASE WHEN m.storage_status = 'unavailable' THEN 1 ELSE 0 END), 0) AS unavailable_count
      FROM chat_sessions s
      LEFT JOIN chat_session_media m ON m.session_id = s.id
      WHERE ${whereClause}
      GROUP BY s.id
    `;
  }

  listActive({ limit = 10, offset = 0 } = {}) {
    const safeLimit = boundedPageValue(limit, 10, 1, 50);
    const safeOffset = boundedPageValue(offset, 0, 0, 1_000_000);
    const total = Number(this.db.prepare("SELECT COUNT(*) AS count FROM chat_sessions WHERE status = 'active'").get().count);
    const items = this.db.prepare(`${this.#sessionSelect("s.status = 'active'")}
      ORDER BY s.last_activity_at_ms DESC, s.id DESC LIMIT ? OFFSET ?
    `).all(safeLimit, safeOffset);
    return { items, total, limit: safeLimit, offset: safeOffset };
  }

  listRetained({ limit = 10, offset = 0, now = Date.now() } = {}) {
    const safeLimit = boundedPageValue(limit, 10, 1, 50);
    const safeOffset = boundedPageValue(offset, 0, 0, 1_000_000);
    const visible = "s.media_count > ? AND (s.status = 'active' OR s.expires_at_ms > ?)";
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM chat_sessions s WHERE ${visible}`)
      .get(MEDIA_RETENTION_THRESHOLD, now).count);
    const items = this.db.prepare(`${this.#sessionSelect(visible)}
      ORDER BY CASE WHEN s.status = 'active' THEN 0 ELSE 1 END,
               COALESCE(s.ended_at_ms, s.last_activity_at_ms) DESC, s.id DESC
      LIMIT ? OFFSET ?
    `).all(MEDIA_RETENTION_THRESHOLD, now, safeLimit, safeOffset);
    return { items, total, limit: safeLimit, offset: safeOffset };
  }

  getSession(sessionId, now = Date.now()) {
    return this.db.prepare(`${this.#sessionSelect(`
      s.id = ? AND (s.status = 'active' OR (s.media_count > ? AND s.expires_at_ms > ?))
    `)}`).get(sessionId, MEDIA_RETENTION_THRESHOLD, now) || null;
  }

  listMedia(sessionId, { limit = 1, offset = 0, now = Date.now() } = {}) {
    if (!this.getSession(sessionId, now)) return { items: [], total: 0, limit: 1, offset: 0 };
    const safeLimit = boundedPageValue(limit, 1, 1, 20);
    const safeOffset = boundedPageValue(offset, 0, 0, 1_000_000);
    const total = Number(this.db.prepare("SELECT COUNT(*) AS count FROM chat_session_media WHERE session_id = ?")
      .get(sessionId).count);
    const items = this.db.prepare(`
      SELECT * FROM chat_session_media
      WHERE session_id = ? ORDER BY id LIMIT ? OFFSET ?
    `).all(sessionId, safeLimit, safeOffset);
    return { items, total, limit: safeLimit, offset: safeOffset };
  }

  resolveMediaPath(mediaId, now = Date.now()) {
    const media = this.db.prepare(`
      SELECT m.* FROM chat_session_media m
      JOIN chat_sessions s ON s.id = m.session_id
      WHERE m.id = ?
        AND (s.status = 'active' OR (s.media_count > ? AND s.expires_at_ms > ?))
    `).get(mediaId, MEDIA_RETENTION_THRESHOLD, now);
    if (!media) return null;
    if (!media.local_path || media.storage_status !== "stored") return { ...media, absolutePath: null };
    const candidate = path.resolve(this.rootDirectory, media.local_path);
    if (!candidate.startsWith(`${this.filesDirectory}${path.sep}`) || !fs.existsSync(candidate)) {
      return { ...media, absolutePath: null };
    }
    return { ...media, absolutePath: candidate };
  }

  purgeExpired(now = Date.now()) {
    const expired = this.db.prepare(`
      SELECT id FROM chat_sessions
      WHERE status = 'ended' AND expires_at_ms IS NOT NULL AND expires_at_ms <= ?
    `).all(now);
    if (!expired.length) return { sessions: 0, files: 0 };
    const paths = expired.flatMap((row) => this.#mediaPaths(row.id));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const remove = this.db.prepare("DELETE FROM chat_sessions WHERE id = ?");
      for (const row of expired) remove.run(row.id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.#deleteFiles(paths);
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return { sessions: expired.length, files: paths.length };
  }

  reconcileActivePairs(pairs, now = Date.now()) {
    const normalized = new Map();
    for (const pair of pairs) {
      const [userAId, userBId] = canonicalPair(pair.userAId, pair.userBId);
      normalized.set(`${userAId}:${userBId}`, { userAId, userBId });
    }

    const active = this.db.prepare("SELECT id, user_a_id, user_b_id FROM chat_sessions WHERE status = 'active'").all();
    const staleIds = active
      .filter((session) => !normalized.has(`${session.user_a_id}:${session.user_b_id}`))
      .map((session) => session.id);
    this.#finishSessions(staleIds, "recovered_disconnect", now);

    let created = 0;
    for (const pair of normalized.values()) {
      const existing = this.db.prepare(`
        SELECT id FROM chat_sessions
        WHERE status = 'active' AND user_a_id = ? AND user_b_id = ?
      `).get(pair.userAId, pair.userBId);
      this.ensureActiveSession(pair.userAId, pair.userBId, now, true);
      if (!existing) created += 1;
    }
    return { active: normalized.size, created, ended: staleIds.length };
  }
}
