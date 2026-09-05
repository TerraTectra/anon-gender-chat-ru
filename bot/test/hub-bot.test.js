import test from "node:test";
import assert from "node:assert/strict";
import { productKeyboard } from "../src/hub-bot.js";
import { products } from "../src/products.js";

test("hub product shortcuts preserve the discovery route", () => {
  const random = products.find((product) => product.id === "random");
  const buttons = productKeyboard([random], "popular").inline_keyboard.flat();
  assert.equal(buttons[0].callback_data, "hub:product:random:popular");
  assert.equal(buttons[1].url, "https://t.me/FocusSprintTimerBot?start=src_hub_popular_random");
});
