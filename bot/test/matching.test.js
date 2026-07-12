import test from "node:test";
import assert from "node:assert/strict";
import { ageGroup, profileMatches, queuesAreCompatible } from "../src/matching.js";

test("age groups never overlap", () => {
  assert.equal(ageGroup(17), "minor");
  assert.equal(ageGroup(18), "adult");
  assert.equal(
    queuesAreCompatible(
      { mode: "random" }, { gender: "male", age: 17 },
      { mode: "random" }, { gender: "female", age: 18 }
    ),
    false
  );
});

test("random queues accept profiles from the same age group", () => {
  assert.equal(
    queuesAreCompatible(
      { mode: "random" }, { gender: "male", age: 24 },
      { mode: "random" }, { gender: "female", age: 31 }
    ),
    true
  );
});

test("filtered queues are checked in both directions", () => {
  const manQueue = { mode: "filtered", targetGender: "female", minAge: 20, maxAge: 30 };
  const womanQueue = { mode: "filtered", targetGender: "male", minAge: 25, maxAge: 35 };
  assert.equal(
    queuesAreCompatible(
      manQueue, { gender: "male", age: 28 },
      womanQueue, { gender: "female", age: 24 }
    ),
    true
  );
  assert.equal(profileMatches(manQueue, { gender: "male", age: 24 }), false);
});
