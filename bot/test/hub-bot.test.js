import test from "node:test";
import assert from "node:assert/strict";
import { productKeyboard } from "../src/hub-bot.js";
import { products } from "../src/products.js";

test("hub product shortcuts preserve the discovery route", () => {
  const focus = products.find((product) => product.id === "focus");
  const buttons = productKeyboard([focus], "popular").inline_keyboard.flat();

  assert.equal(buttons[0].callback_data, "hub:product:focus:popular");
  assert.equal(buttons[1].url, "https://t.me/FocusSprintTimerBot?start=src_hub_popular_focus");
});
