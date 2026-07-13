import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelPublisher } from "../src/channel-publisher.js";

test("channel publisher sends one scheduled post per channel and day", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-channels-"));
  const configPath = path.join(directory, "channels.json");
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(configPath, JSON.stringify({
    channels: [
      {
        id: "ai",
        title: "AI",
        chatId: "@test_ai",
        enabled: true,
        schedule: "09:00",
        days: ["mon", "tue"],
        posts: ["first", "second"]
      },
      {
        id: "off",
        title: "Off",
        chatId: "@test_off",
        enabled: false,
        schedule: "09:00",
        days: ["mon"],
        posts: ["never"]
      }
    ]
  }));
  const messages = [];
  const api = { sendMessage: async (...args) => messages.push(args) };
  const publisher = new ChannelPublisher(api, configPath, statePath);

  const monday = new Date("2026-07-13T06:30:00.000Z");
  assert.deepEqual(await publisher.publishDue(monday), ["ai"]);
  assert.deepEqual(await publisher.publishDue(monday), []);
  assert.deepEqual(messages.map((message) => message.slice(0, 2)), [["@test_ai", "first"]]);

  const tuesday = new Date("2026-07-14T06:30:00.000Z");
  assert.deepEqual(await publisher.publishDue(tuesday), ["ai"]);
  assert.deepEqual(messages.map((message) => message[1]), ["first", "second"]);
  assert.deepEqual(publisher.status().map(({ id, sent }) => ({ id, sent })), [
    { id: "ai", sent: 2 },
    { id: "off", sent: 0 }
  ]);

  fs.rmSync(directory, { recursive: true, force: true });
});

test("channel publisher waits for the scheduled Moscow time", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-channels-"));
  const configPath = path.join(directory, "channels.json");
  fs.writeFileSync(configPath, JSON.stringify({
    channels: [{ id: "ai", chatId: "@test", enabled: true, schedule: "09:15", days: ["mon"], posts: ["post"] }]
  }));
  const messages = [];
  const publisher = new ChannelPublisher({ sendMessage: async (...args) => messages.push(args) }, configPath, path.join(directory, "state.json"));

  assert.deepEqual(await publisher.publishDue(new Date("2026-07-13T06:14:00.000Z")), []);
  assert.equal(messages.length, 0);

  fs.rmSync(directory, { recursive: true, force: true });
});

test("channel publisher can launch enabled channels immediately", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-channels-"));
  const configPath = path.join(directory, "channels.json");
  fs.writeFileSync(configPath, JSON.stringify({
    channels: [
      { id: "ai", chatId: "@ai", enabled: true, schedule: "23:59", posts: ["launch"] },
      { id: "off", chatId: "@off", enabled: false, schedule: "00:00", posts: ["never"] }
    ]
  }));
  const messages = [];
  const publisher = new ChannelPublisher({ sendMessage: async (...args) => messages.push(args) }, configPath, path.join(directory, "state.json"));
  const now = new Date("2026-07-13T04:00:00.000Z");

  assert.deepEqual(await publisher.publishNow(null, now), ["ai"]);
  assert.deepEqual(await publisher.publishNow(null, now), []);
  assert.equal(messages[0][1], "launch");

  fs.rmSync(directory, { recursive: true, force: true });
});
