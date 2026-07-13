import test from "node:test";
import assert from "node:assert/strict";
import { channelLink, contentChannels, productLink, products, productsByCategory, recommendationIntents, searchProducts } from "../src/products.js";

test("product catalog has unique bots and tracked links", () => {
  assert.equal(products.length, 6);
  assert.equal(new Set(products.map((item) => item.id)).size, products.length);
  assert.equal(new Set(products.map((item) => item.username)).size, products.length);
  assert.ok(productsByCategory("communication").length >= 2);
  assert.match(productLink(products[0], "src_hub"), /\?start=src_hub_anon$/);
  assert.equal(searchProducts("напомнить о делах")[0].id, "tasks");
  assert.deepEqual(searchProducts("Мне нужно напомнить о делах").map((product) => product.id), ["tasks"]);
  assert.equal(searchProducts("практика английского")[0].id, "english");
  assert.equal(searchProducts("совсем неизвестная штука").length, 0);
});

test("content channels have unique public links", () => {
  assert.equal(contentChannels.length, 3);
  assert.equal(new Set(contentChannels.map((channel) => channel.username)).size, contentChannels.length);
  assert.equal(channelLink(contentChannels[0]), "https://t.me/TerraTectraAI");
});

test("recommendation intents point to existing products", () => {
  const productIds = new Set(products.map((product) => product.id));
  assert.equal(new Set(recommendationIntents.map((intent) => intent.id)).size, recommendationIntents.length);
  assert.ok(recommendationIntents.every((intent) => productIds.has(intent.productId)));
});
