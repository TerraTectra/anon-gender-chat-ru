import test from "node:test";
import assert from "node:assert/strict";
import { postChatKeyboard } from "../src/user-bot.js";

test("completed chats offer tracked daily activities without sending a broadcast", () => {
  const buttons = postChatKeyboard().inline_keyboard.flat();

  assert.deepEqual(buttons.map(({ text, url }) => ({ text, url })), [
    { text: "🧠 Вопрос дня", url: "https://t.me/TectraQuizBot?start=src_anon_postchat_daily" },
    { text: "🎉 Игра дня", url: "https://t.me/TectraPartyBot?start=src_anon_postchat_daily" }
  ]);
});
