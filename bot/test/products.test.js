import test from "node:test";
import assert from "node:assert/strict";
import { productLink, products, productsByCategory } from "../src/products.js";

test("product catalog has unique bots and tracked links", () => {
  assert.equal(products.length, 5);
  assert.equal(new Set(products.map((item) => item.id)).size, products.length);
  assert.equal(new Set(products.map((item) => item.username)).size, products.length);
  assert.ok(productsByCategory("communication").length >= 2);
  assert.match(productLink(products[0], "src_hub"), /\?start=src_hub_anon$/);
});
