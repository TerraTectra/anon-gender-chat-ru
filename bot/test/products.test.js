import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { channelLink, contentChannels, productLink, products, productsByCategory, recommendationIntents, searchProducts } from "../src/products.js";

test("product catalog has unique bots and tracked links", () => {
  assert.equal(products.length, 8);
  assert.equal(new Set(products.map((item) => item.id)).size, products.length);
  assert.equal(new Set(products.map((item) => item.username)).size, products.length);
  assert.ok(productsByCategory("communication").length >= 2);
  assert.equal(productsByCategory("entertainment").length, 2);
  assert.match(productLink(products[0], "src_hub"), /\?start=src_hub_anon$/);
  assert.equal(searchProducts("напомнить о делах")[0].id, "tasks");
  assert.deepEqual(searchProducts("Мне нужно напомнить о делах").map((product) => product.id), ["tasks"]);
  assert.equal(searchProducts("практика английского")[0].id, "english");
  assert.equal(searchProducts("совсем неизвестная штука").length, 0);
});

test("content channels have unique public links", () => {
  assert.equal(contentChannels.length, 5);
  assert.equal(new Set(contentChannels.map((channel) => channel.username)).size, contentChannels.length);
  assert.equal(channelLink(contentChannels[0]), "https://t.me/TerraTectraAI");
});

test("recommendation intents point to existing products", () => {
  const productIds = new Set(products.map((product) => product.id));
  assert.equal(new Set(recommendationIntents.map((intent) => intent.id)).size, recommendationIntents.length);
  assert.ok(recommendationIntents.every((intent) => productIds.has(intent.productId)));
});

test("entertainment channels promote direct daily activities", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../content/channels.json", import.meta.url), "utf8"));
  const channels = Object.fromEntries(config.channels.map((channel) => [channel.id, channel]));

  assert.match(channels.fun.promotion.text, /TectraPartyBot\?start=src_channel_fun_daily$/);
  assert.match(channels.quiz.promotion.text, /TectraQuizBot\?start=src_channel_quiz_daily$/);
  assert.ok(channels.fun.schedule.length >= 4);
  assert.ok(channels.quiz.schedule.length >= 3);
});
