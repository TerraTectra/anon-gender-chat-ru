import test from "node:test";
import assert from "node:assert/strict";
import { isBotBlockedByUserError, postChatKeyboard } from "../src/user-bot.js";

test("completed chats offer tracked current products without sending a broadcast", () => {
  const buttons = postChatKeyboard().inline_keyboard.flat();
  assert.deepEqual(buttons.map(({ text, url }) => ({ text, url })), [
    { text: "📥 Скачать видео", url: "https://t.me/TectraQuizBot?start=src_anon_postchat_video" },
    { text: "💞 Знакомства 18+", url: "https://t.me/GameMateFinderRuBot?start=src_anon_postchat_dating" }
  ]);
});


test("bot-block detection only accepts Telegram explicit blocked-by-user 403", () => {
  assert.equal(isBotBlockedByUserError({ error_code: 403, description: "Forbidden: bot was blocked by the user" }), true);
  assert.equal(isBotBlockedByUserError({ error_code: 403, description: "Forbidden: user is deactivated" }), false);
  assert.equal(isBotBlockedByUserError({ error_code: 400, description: "Bad Request" }), false);
});
