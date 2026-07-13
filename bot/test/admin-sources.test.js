import test from "node:test";
import assert from "node:assert/strict";
import { aggregateSourceStats } from "../src/admin-bot.js";

function sourceStore(rows) {
  return { sourceStats: () => rows };
}

test("campaign sources are aggregated across products", () => {
  const rows = aggregateSourceStats([
    ["Hub", sourceStore([
      { source: "src_web", users: 3 },
      { source: "src_catalog", users: 1 }
    ])],
    ["Tasks", sourceStore([
      { source: "src_web", users: 2 },
      { source: "ref_10", users: 4 }
    ])]
  ]);

  assert.deepEqual(rows, [
    { source: "src_web", users: 5, products: 2 },
    { source: "ref_10", users: 4, products: 1 },
    { source: "src_catalog", users: 1, products: 1 }
  ]);
});

test("campaign source aggregation respects the requested limit", () => {
  const rows = aggregateSourceStats([
    ["Hub", sourceStore([
      { source: "src_second", users: 2 },
      { source: "src_first", users: 3 }
    ])]
  ], 1);

  assert.deepEqual(rows, [{ source: "src_first", users: 3, products: 1 }]);
});
