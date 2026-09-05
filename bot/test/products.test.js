import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { channelLink, contentChannels, productLink, products, productsByCategory, recommendationIntents, searchProducts } from "../src/products.js";

test("product catalog exposes the market-backed niche lineup", () => {
  assert.equal(products.length, 9);
  assert.equal(new Set(products.map((item) => item.id)).size, products.length);
  assert.equal(new Set(products.map((item) => item.username)).size, products.length);
  assert.equal(products.filter((item) => item.id === "anon").length, 1);
  assert.ok(productsByCategory("social").length >= 2);
  assert.ok(productsByCategory("media").length >= 2);
  assert.ok(productsByCategory("admin").length >= 3);
  assert.match(productLink(products[0], "src_hub"), /\?start=src_hub_anon$/);
  assert.equal(searchProducts("скачать видео тикток")[0].id, "video");
  assert.equal(searchProducts("скачать музыку песню")[0].id, "music");
  assert.equal(searchProducts("рандомайзер победитель")[0].id, "random");
  assert.equal(searchProducts("антиспам модератор группы")[0].id, "moderator");
  assert.equal(searchProducts("кафе рядом")[0].id, "nearby");
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

test("stale legacy channel automation remains paused during rebrand", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../content/channels.json", import.meta.url), "utf8"));
  for (const channel of config.channels) assert.equal(channel.enabled, false);
});
