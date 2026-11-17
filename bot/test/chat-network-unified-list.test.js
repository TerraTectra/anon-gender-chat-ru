import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/store.js";
import { installChatNetworkAdmin } from "../src/chat-network-admin.js";
import { aggregateNetworkSessions, collectClearableArchiveIds } from "../src/chat-network-session-list.js";

function fixtureSource(id, rows, archiveRows = rows) {
  const page = (data, opts) => ({
    total: data.length, items: data.slice(opts.offset, opts.offset + opts.limit)
  });
  return {
    id,
    store: {
      listActiveChatSessions: opts => page(rows, opts),
      listRetainedChatSessions: opts => {
        assert.equal(opts.onlyEnded, true);
        return page(archiveRows, opts);
      }
    }
  };
}

test("merged pagination is globally chronological, deterministic and works beyond a source's 50-item cap", () => {
  const rows = (count, start, delta) => Array.from({ length: count }, (_, i) => ({
    id: count - i, status: "ended", last_activity_at_ms: start - i * delta,
    ended_at_ms: start - i * delta, message_count: i
  }));
  const a = fixtureSource("anon", rows(78, 9000, 7));
  const b = fixtureSource("english", rows(75, 8999, 7));
  const c = fixtureSource("focus", rows(68, 8998, 7));
  const sources = [a, b, c];
  const expected = sources.flatMap(x => x.store.listActiveChatSessions({ offset: 0, limit: 500 }).items
    .map(session => ({ ...session, brandId: x.id })))
    .sort((x, y) => y.last_activity_at_ms - x.last_activity_at_ms);
  for (const offset of [0, 8, 40, 72, 160, 210]) {
    const actual = aggregateNetworkSessions(sources, "a", { limit: 8, offset, chunkSize: 9 });
    assert.equal(actual.total, 221);
    assert.deepEqual(actual.items.map(x => [x.brandId, x.id]),
      expected.slice(offset, offset + 8).map(x => [x.brandId, x.id]));
  }
  const archived = aggregateNetworkSessions(sources, "m", { limit: 8, offset: 165, chunkSize: 8 });
  assert.equal(archived.total, 221);
  assert.deepEqual(archived.items.map(x => [x.brandId, x.id]),
    expected.slice(165, 173).map(x => [x.brandId, x.id]));
  assert.throws(() => aggregateNetworkSessions(sources, "m", { offset: 6000 }), RangeError);
});

test("bulk archive selector skips active and favorited entries and paginates without losing rows", () => {
  const rows = Array.from({ length: 112 }, (_, n) => ({
    id: n + 1, status: "ended", is_favorite: n % 9 === 0 ? 1 : 0
  }));
  const src = fixtureSource("anon", [], rows);
  const selected = collectClearableArchiveIds([src]);
  assert.equal(selected.length, rows.filter(x => !x.is_favorite).length);
  assert.ok(!selected.some(x => x.sessionId === 1));
  assert.deepEqual(selected.at(-1), { brandId: "anon", sessionId: 112 });
  assert.throws(() => collectClearableArchiveIds([src], 100), RangeError);
});

test("admin can delete one archived session and bulk-clear the rest without affecting favorites or live chats", async () => {
  const before = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terra-shared-archive-"));
  let original, adminNetwork;
  try {
    process.chdir(root);
    original = new Store(path.join(root, "base.db"), { sessionArchiveRoot: path.join(root, "base-archive") });
    const handlers = [];
    const bot = {
      command() {}, hears() {},
      callbackQuery(pattern, handler) { handlers.push({ pattern, handler }); }
    };
    const log = [];
    adminNetwork = installChatNetworkAdmin(bot, original);
    const trigger = async (payload) => {
      const found = handlers.find(x => x.pattern === payload || (x.pattern instanceof RegExp && x.pattern.test(payload)));
      assert.ok(found, "No callback for " + payload);
      const ctx = {
        chat: { id: 9000, type: "private" }, from: { id: 9000 },
        match: found.pattern instanceof RegExp ? payload.match(found.pattern) : payload,
        api: {},
        answerCallbackQuery: async () => {},
        reply: async (text, options) => { log.push({ text, options }); },
        editMessageText: async (text, options) => { log.push({ text, options }); }
      };
      await found.handler(ctx);
      return log.at(-1);
    };
    const file = path.join(root, "data", "anon-variants", "english.db");
    const archiveRoot = path.join(root, "data", "anon-variants", "session-archive", "english");
    const guest = new Store(file, { sessionArchiveRoot: archiveRoot });
    try {
      for (const [id, name] of [[101, "alpha"], [202, "beta"]]) guest.upsertUser(id, name);
      const db = new DatabaseSync(path.join(archiveRoot, "sessions.sqlite"));
      try {
        const t = Date.now();
        const statement = db.prepare("INSERT INTO chat_sessions (user_a_id,user_b_id,status,started_at_ms,last_activity_at_ms,ended_at_ms,media_count,expires_at_ms,is_favorite) VALUES (101,202,'ended',?,?,?,?,1,?,?)");
        statement.run(t-8000,t-7000,t-7000,t+60_000,0);
        statement.run(t-6000,t-5000,t-5000,t+60_000,1);
        statement.run(t-4000,t-3000,t-3000,t+60_000,0);
        const fpath = path.join(archiveRoot, "files", "example.jpg");
        fs.writeFileSync(fpath, "archived media bytes");
        db.prepare("INSERT INTO chat_session_media (session_id,sender_id,source_chat_id,source_message_id,kind,file_id,storage_status,local_path,created_at_ms) VALUES (1,101,101,1,'photo','file-id','stored','files/example.jpg',?)").run(t-7500);
        const active = db.prepare("INSERT INTO chat_sessions(user_a_id,user_b_id,status,started_at_ms,last_activity_at_ms) VALUES (101,202,'active',?,?)").run(t-1000,t);
        assert.equal(active.changes, 1);
        const list = await trigger("multi_all:m:0");
        assert.match(list.text, /Общий архив/);
        assert.match(list.text, /всего сессий: 3/);
        assert.match(list.text, /Искра/);
        const detail = await trigger("multi_session:english:1:gm:0");
        assert.match(detail.text, /@EnglishTalkMatchBot/);
        const actions = detail.options.reply_markup.inline_keyboard.flat();
        assert.ok(actions.some(x=>x.callback_data==="multi_delete:english:1:gm:0"));
        await trigger("multi_delete:english:1:gm:0");
        assert.ok(guest.getChatSession(1), "confirmation step must not delete");
        await trigger("multi_delete_confirm:english:1:gm:0");
        assert.equal(guest.getChatSession(1), null);
        assert.equal(fs.existsSync(fpath), false, "stored attachment must also be deleted");
        const proposal = await trigger("multi_clear_prepare");
        assert.match(proposal.text, /Будет удалено завершённых сессий: 1/);
        const next = proposal.options.reply_markup.inline_keyboard.flat().find(x=>x.callback_data.startsWith("multi_clear_stage2:"));
        const second = await trigger(next.callback_data);
        assert.match(second.text, /Последнее подтверждение/);
        const execute = second.options.reply_markup.inline_keyboard.flat().find(x=>x.callback_data.startsWith("multi_clear_execute:"));
        const result = await trigger(execute.callback_data);
        assert.match(result.text, /Удалено сессий: 1/);
        assert.ok(guest.getChatSession(2), "favorite must remain");
        assert.ok(guest.getChatSession(4), "active session must remain");
        assert.equal(guest.getChatSession(3), null);
      } finally { db.close(); }
    } finally { guest.close(); }
  } finally {
    adminNetwork?.close();
    original?.close();
    process.chdir(before);
    fs.rmSync(root,{recursive:true,force:true});
  }
});
