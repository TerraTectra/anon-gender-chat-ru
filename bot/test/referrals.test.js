import assert from "node:assert/strict";
import test from "node:test";
import { inviteKeyboard } from "../src/referrals.js";

test("invite keyboard preserves referral link and share text", () => {
  const keyboard = inviteKeyboard("https://t.me/TestBot?start=ref_42", "Полезный бот");
  const button = keyboard.inline_keyboard[0][0];

  assert.equal(button.text, "Поделиться");
  assert.equal(
    button.url,
    "https://t.me/share/url?url=https%3A%2F%2Ft.me%2FTestBot%3Fstart%3Dref_42&text=%D0%9F%D0%BE%D0%BB%D0%B5%D0%B7%D0%BD%D1%8B%D0%B9%20%D0%B1%D0%BE%D1%82"
  );
});
