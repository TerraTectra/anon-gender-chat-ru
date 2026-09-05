import test from "node:test";
import assert from "node:assert/strict";
import { aggregateCampaignPerformance, aggregateSourceStats } from "../src/admin-bot.js";

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

test("campaign performance combines registrations and useful actions", () => {
  const performanceStore = (rows) => ({ sourcePerformanceStats: () => rows });
  const rows = aggregateCampaignPerformance([
    ["Quiz", performanceStore([
      { source: "src_channel_quiz_auto", users: 3, active_users: 2, actions: 7 }
    ])],
    ["Party", performanceStore([
      { source: "src_channel_quiz_auto", users: 1, active_users: 1, actions: 4 },
      { source: "src_channel_fun_auto", users: 2, active_users: 0, actions: 0 }
    ])]
  ]);

  assert.deepEqual(rows, [
    { source: "src_channel_quiz_auto", users: 4, activeUsers: 3, actions: 11, products: 2 },
    { source: "src_channel_fun_auto", users: 2, activeUsers: 0, actions: 0, products: 1 }
  ]);
});
