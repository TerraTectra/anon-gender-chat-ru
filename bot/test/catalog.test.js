import test from "node:test";
import assert from "node:assert/strict";
import { catalogKeyboard } from "../src/catalog.js";
import { products } from "../src/products.js";

test("product catalog hides the current bot and tracks every destination", () => {
  const buttons = catalogKeyboard("random").inline_keyboard.flat();
  const urls = buttons.map((button) => button.url);
  assert.equal(buttons.length, products.length - 1);
  assert.ok(!urls.some((url) => url.includes("FocusSprintTimerBot")));
  assert.ok(urls.includes("https://t.me/TectraQuizBot?start=src_catalog_random_video"));
  assert.ok(urls.includes("https://t.me/PocketBudgetRuBot?start=src_catalog_random_moderator"));
});
