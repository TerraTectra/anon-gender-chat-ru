import test from "node:test";
import assert from "node:assert/strict";
import { parseStartSource } from "../src/tracking.js";

test("campaign and referral start sources are accepted safely", () => {
  assert.equal(parseStartSource("src_network_catalog", 1), "src_network_catalog");
  assert.equal(parseStartSource("ref_2", 1), "ref_2");
  assert.equal(parseStartSource("ref_1", 1), null);
  assert.equal(parseStartSource("bad source with spaces", 1), null);
  assert.equal(parseStartSource("x".repeat(65), 1), null);
});
