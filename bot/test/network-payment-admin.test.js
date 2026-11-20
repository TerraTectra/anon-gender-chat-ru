import test from "node:test";
import assert from "node:assert/strict";
import { formatNanoStars, starNanoAmount, networkStarBalances, allTimePaymentTotals } from "../src/network-payment-admin.js";

test("aggregate Stars use live balances rather than accumulated sales", async () => {
  const brands = ["anon", "english", "focus"].map(id => ({ id, name: id }));
  const balances = {
    anon: { amount: 100, nanostar_amount: 250000000 },
    english: { amount: 5, nanostar_amount: 750000000 },
    focus: { amount: 1 }
  };
  const result = await networkStarBalances(brands, async id => balances[id]);
  assert.equal(result.complete, true);
  assert.equal(result.connected, 3);
  assert.equal(result.totalNano, 107000000000n);
  assert.equal(formatNanoStars(result.totalNano), "107");
  assert.equal(formatNanoStars(starNanoAmount({amount: 0, nanostar_amount: 125000000})), "0,125");
});

test("an unavailable Telegram bot balance never counts as a confirmed zero", async () => {
  const brands = ["anon", "english", "focus"].map(id => ({ id }));
  const result = await networkStarBalances(brands, async id => {
    if (id === "english") throw new Error("Telegram unavailable");
    return { amount: id === "anon" ? 42 : 0 };
  });
  assert.equal(result.complete, false);
  assert.equal(result.connected, 2);
  assert.equal(result.entries.find(x => x.id === "english").available, false);
  assert.equal(result.entries.find(x => x.id === "english").nano, null);
  assert.equal(result.totalNano, 42000000000n);
  await assert.rejects(async () => starNanoAmount({ amount: 2, nanostar_amount: 1e9 }), /invalid_star_balance/);
});

test("all-time receipts and refunds are distinct from Telegram wallet balance", () => {
  const premium = {
    db: { prepare(sql) {
      assert.match(sql, /FROM premium_payments/);
      return { get() { return { purchases: 3, received: 75, refunded: 25 }; } };
    } }
  };
  assert.deepEqual(allTimePaymentTotals(premium), {
    purchases: 3, received: 75, refunded: 25, net: 50
  });
});
