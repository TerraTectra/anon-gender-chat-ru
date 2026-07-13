import test from "node:test";
import assert from "node:assert/strict";
import { productLink, products, productsByCategory, searchProducts } from "../src/products.js";

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
