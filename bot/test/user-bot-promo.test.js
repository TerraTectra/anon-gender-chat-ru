import test from "node:test";
import assert from "node:assert/strict";
import { isBotBlockedByUserError, postChatKeyboard } from "../src/user-bot.js";

test("completed chats prioritize finding another partner and referral sharing", () => {
  const buttons = postChatKeyboard(123, "anon_gender_chat_ru_bot").inline_keyboard.flat();
  const findAgain = buttons.find((button) => button.text === "🎲 Найти ещё");
  const invite = buttons.find((button) => button.text === "📤 Позвать друга");

  assert.equal(findAgain.callback_data, "postchat:search");
  assert.match(invite.url, /start%3Dref_123/);
  assert.ok(buttons.some((button) => button.url === "https://t.me/TectraQuizBot?start=src_anon_postchat_video"));
  assert.ok(buttons.some((button) => button.url === "https://t.me/GameMateFinderRuBot?start=src_anon_postchat_dating"));
});

test("bot-block detection only accepts Telegram explicit blocked-by-user 403", () => {
  assert.equal(isBotBlockedByUserError({ error_code: 403, description: "Forbidden: bot was blocked by the user" }), true);
  assert.equal(isBotBlockedByUserError({ error_code: 403, description: "Forbidden: user is deactivated" }), false);
  assert.equal(isBotBlockedByUserError({ error_code: 400, description: "Bad Request" }), false);
});
