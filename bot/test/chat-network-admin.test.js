import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/store.js";
import { installChatNetworkAdmin, splitTelegramText } from "../src/chat-network-admin.js";

test("single admin entry, chronological mixed chat transcript, and per-bot session ban", async () => {
  const originalCwd = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terra-multichat-test-"));
  let adminNetwork, original, guest;
  try {
    process.chdir(root);
    original = new Store(path.join(root, "original.db"), { sessionArchiveRoot: path.join(root, "original-archive") });
    const commands = new Map(), handlers = [];
    const bot = {
      command: (name, fn) => commands.set(name, fn),
      hears: () => {},
      callbackQuery: (matcher, fn) => handlers.push({ matcher, fn })
    };
    const emitted = [];
    adminNetwork = installChatNetworkAdmin(bot, original, {
      sourceArchiveSender: async (chatId, message, brandId, caption) => {
        assert.equal(brandId, "english");
        emitted.push({ kind: "media", caption, fileId: message.file_id });
      }
    });
    const send = async (data) => {
      const handler = handlers.find(item => item.matcher === data || (item.matcher instanceof RegExp && item.matcher.test(data)));
      assert.ok(handler, "Callback exists: " + data);
      const match = handler.matcher instanceof RegExp ? data.match(handler.matcher) : data;
      const ctx = {
        match, chat: { type: "private", id: 90000 }, from: { id: 90000 },
        answerCallbackQuery: async () => {},
        editMessageText: async (text, options) => emitted.push({ kind: "edit", text, options }),
        reply: async (text, options) => emitted.push({ kind: "text", text, options }),
        api: {}
      };
      await handler.fn(ctx);
      return ctx;
    };
    await commands.get("chats")({
      chat: { type: "private", id: 90000 },
      reply: async (text, options) => {
        assert.match(text, /Все анонимные чаты \(9\)/);
        assert.equal(options.reply_markup.inline_keyboard.length, 10);
        assert.ok(options.reply_markup.inline_keyboard[0].some(button => button.callback_data === "multi_all:a:0"));
        assert.ok(options.reply_markup.inline_keyboard[0].some(button => button.callback_data === "multi_all:m:0"));
      }
    });
    const archiveRoot = path.join(root, "data", "anon-variants", "session-archive", "english");
    const dataFile = path.join(root, "data", "anon-variants", "english.db");
    guest = new Store(dataFile, { sessionArchiveRoot: archiveRoot });
    guest.upsertUser(111, "alice");
    guest.upsertUser(222, "bob");
    const db = new DatabaseSync(path.join(archiveRoot, "sessions.sqlite"));
    const t = Date.now();
    db.prepare("INSERT INTO chat_sessions(user_a_id,user_b_id,status,started_at_ms,last_activity_at_ms) VALUES(111,222,'active',?,?)").run(t-3000,t);
    const base = "INSERT INTO chat_session_messages(session_id,sender_id,source_chat_id,source_message_id,kind,text,file_id,created_at_ms) VALUES(1,?,?,?,?,?,?,?)";
    db.prepare(base).run(111,111,1,"text","До фото",null,t-2000);
    db.prepare(base).run(222,222,2,"photo",null,"FILE_PHOTO",t-1000);
    db.prepare(base).run(111,111,3,"text","После фото",null,t);
    db.close();

    await send("multi_timeline:english:1:0");
    const sequence = emitted.filter(e=>e.kind==="text"||e.kind==="media");
    assert.match(sequence[0].text,/До фото/);
    assert.equal(sequence[1].kind,"media");
    assert.match(sequence[1].caption,/Фото/);
    assert.match(sequence[2].text,/После фото/);
    assert.match(sequence[3].text,/Просмотр 1–3 из 3/);

    await send("multi_all:a:0");
    assert.match(emitted.at(-1).text, /Все активные сессии/);
    assert.match(emitted.at(-1).text, /Искра/);
    await send("multi_session:english:1:ga:0");
    assert.match(emitted.at(-1).text, /@EnglishTalkMatchBot/);
    const detail = emitted.at(-1);
    assert.equal(detail.kind,"edit");
    const buttons = detail.options.reply_markup.inline_keyboard.flat().map(b=>b.text);
    assert.ok(buttons.some(text=>text.includes("Бан участника 1")));
    assert.ok(buttons.some(text=>text.includes("Бан участника 2")));
    assert.ok(buttons.some(text=>text.includes("Удалить активную сессию")));

    await send("multi_ban:english:1:0:ga:0");
    assert.match(emitted.at(-1).text,/Заблокировать @alice/);
    assert.equal(guest.isBanned(111),false);
    await send("multi_ban_confirm:english:1:0");
    assert.equal(guest.isBanned(111),true);
    assert.equal(guest.isBanned(222),false);
    assert.equal(original.isBanned(111),false);
  } finally {
    guest?.close();
    adminNetwork?.close();
    original?.close();
    process.chdir(originalCwd);
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test("long Unicode messages are split without truncation or broken surrogate pairs", () => {
  const payload = "🙂".repeat(1900) + "—КОНЕЦ";
  const parts = splitTelegramText(payload);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.length <= 3600));
  assert.equal(parts.join(""), payload);
});
