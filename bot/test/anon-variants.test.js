import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { anonVariants } from "../src/anon-variants.js";
import { ensureVariantAvatar } from "../src/avatar-generator.js";

test("eight distinct configured chat brands exclude the original and the admin", () => {
  assert.equal(anonVariants.length, 8);
  assert.equal(new Set(anonVariants.map((b) => b.id)).size, 8);
  assert.equal(new Set(anonVariants.map((b) => b.tokenEnv)).size, 8);
  assert.equal(new Set(anonVariants.map((b) => b.username)).size, 8);
  assert.equal(new Set(anonVariants.map((b) => b.name)).size, 8);
  for (const brand of anonVariants) {
    assert.ok(brand.name.length <= 64, brand.name);
    assert.ok(brand.short.length <= 120, brand.id);
    assert.ok(brand.description.length <= 512, brand.id);
    assert.ok(!/ADMIN_BOT_TOKEN|^BOT_TOKEN$/.test(brand.tokenEnv), brand.id);
  }
});

test("avatar generator produces genuine 512x512 PNG without overwriting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anon-avatar-"));
  try {
    const filename = ensureVariantAvatar(anonVariants[0], dir);
    const bytes = fs.readFileSync(filename);
    assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    assert.equal(bytes.readUInt32BE(16), 512);
    assert.equal(bytes.readUInt32BE(20), 512);
    assert.ok(bytes.byteLength > 1024);
    fs.writeFileSync(filename, Buffer.from("owner photo"));
    ensureVariantAvatar(anonVariants[0], dir);
    assert.equal(fs.readFileSync(filename, "utf8"), "owner photo");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
