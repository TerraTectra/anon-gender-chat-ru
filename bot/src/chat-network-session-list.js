// Unified, read-only pagination across independent SQLite chat archives.
// Every source maintains its existing retention and visibility policy.
export const NETWORK_SESSION_PAGE_SIZE = 8;
const BATCH_SIZE = 32;
const MAX_OFFSET = 5000;

const rank = (session, kind) =>
  Number(kind === "a" ? session.last_activity_at_ms :
    (session.ended_at_ms ?? session.last_activity_at_ms) ?? 0);

function compareRows(left, right, kind) {
  const delta = rank(right.session, kind) - rank(left.session, kind);
  if (delta) return delta;
  if (left.brandIndex !== right.brandIndex) return left.brandIndex - right.brandIndex;
  return Number(right.session.id) - Number(left.session.id);
}

function listFor(cursor, kind, limit, offset) {
  const options = { limit, offset, ...(kind === "m" ? { onlyEnded: true } : {}) };
  return kind === "a"
    ? cursor.store.listActiveChatSessions(options)
    : cursor.store.listRetainedChatSessions(options);
}

function refill(cursor, kind, chunkSize) {
  if (cursor.total !== null && cursor.loaded >= cursor.total) {
    cursor.buffer = [];
    cursor.index = 0;
    return;
  }
  const result = listFor(cursor, kind, chunkSize, cursor.loaded);
  cursor.total = Number(result.total || 0);
  cursor.buffer = result.items || [];
  cursor.loaded += cursor.buffer.length;
  cursor.index = 0;
}

export function aggregateNetworkSessions(sources, kind, {
  limit = NETWORK_SESSION_PAGE_SIZE,
  offset = 0,
  chunkSize = BATCH_SIZE
} = {}) {
  if (kind !== "a" && kind !== "m") throw new TypeError("Invalid session category");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    throw new RangeError("Session offset exceeds safety limit");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError("Invalid session page size");
  }
  const cursors = sources.map((source, brandIndex) => ({
    id: source.id, store: source.store, brandIndex,
    buffer: [], index: 0, loaded: 0, total: null
  }));
  for (const cursor of cursors) refill(cursor, kind, chunkSize);
  const total = cursors.reduce((sum, cursor) => sum + cursor.total, 0);
  const items = [];
  for (let index = 0; index < offset + limit && index < total; index += 1) {
    let winner = null;
    for (const cursor of cursors) {
      if (cursor.index >= cursor.buffer.length) continue;
      if (winner === null || compareRows(
        { session: cursor.buffer[cursor.index], brandIndex: cursor.brandIndex },
        { session: winner.buffer[winner.index], brandIndex: winner.brandIndex }, kind
      ) < 0) winner = cursor;
    }
    if (!winner) break;
    const session = winner.buffer[winner.index++];
    if (index >= offset) items.push({ ...session, brandId: winner.id });
    if (winner.index >= winner.buffer.length) refill(winner, kind, chunkSize);
  }
  return { items, total, limit, offset };
}

// Only ended, non-favorited sessions can be bulk-cleared.
// Collect a fixed snapshot first, so deleting one row never shifts pagination.
export function collectClearableArchiveIds(sources, maxPerSource = 10000) {
  const selection = [];
  for (const source of sources) {
    let offset = 0;
    let total = null;
    while (total === null || offset < total) {
      const result = source.store.listRetainedChatSessions({
        limit: 50, offset, onlyEnded: true
      });
      total = Number(result.total || 0);
      if (total > maxPerSource) throw new RangeError("Archive too large for bulk clearing");
      if (!result.items.length) break;
      for (const session of result.items) {
        if (session.status === "ended" && !Number(session.is_favorite)) {
          selection.push({ brandId: source.id, sessionId: Number(session.id) });
        }
      }
      offset += result.items.length;
    }
  }
  return selection;
}
