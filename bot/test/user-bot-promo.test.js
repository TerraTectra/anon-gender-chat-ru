import test from "node:test";
import assert from "node:assert/strict";
import { postChatKeyboard } from "../src/user-bot.js";

test("completed chats offer tracked current products without sending a broadcast", () => {
  const buttons = postChatKeyboard().inline_keyboard.flat();
  assert.deepEqual(buttons.map(({ text, url }) => ({ text, url })), [
    { text: "📥 Скачать видео", url: "https://t.me/TectraQuizBot?start=src_anon_postchat_video" },
    { text: "💞 Знакомства 18+", url: "https://t.me/GameMateFinderRuBot?start=src_anon_postchat_dating" }
  ]);
});
