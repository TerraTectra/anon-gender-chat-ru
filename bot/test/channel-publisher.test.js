import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelPublisher } from "../src/channel-publisher.js";

test("channel publisher sends scheduled posts without duplicates", async () => {
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
        schedule: ["09:00", "15:00"],
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

  const mondayAfternoon = new Date("2026-07-13T12:30:00.000Z");
  assert.deepEqual(await publisher.publishDue(mondayAfternoon), ["ai"]);
  assert.deepEqual(await publisher.publishDue(mondayAfternoon), []);
  assert.deepEqual(messages.map((message) => message[1]), ["first", "second"]);

  const tuesday = new Date("2026-07-14T06:30:00.000Z");
  assert.deepEqual(await publisher.publishDue(tuesday), ["ai"]);
  assert.deepEqual(messages.map((message) => message[1]), ["first", "second", "first"]);
  assert.deepEqual(publisher.status().map(({ id, sent }) => ({ id, sent })), [
    { id: "ai", sent: 3 },
    { id: "off", sent: 0 }
  ]);

  fs.rmSync(directory, { recursive: true, force: true });
});

test("channel publisher sends only the latest missed slot after downtime", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-channels-"));
  const configPath = path.join(directory, "channels.json");
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(configPath, JSON.stringify({
    channels: [{
      id: "fun",
      chatId: "@fun",
      enabled: true,
      schedule: ["09:00", "13:00", "18:00"],
      days: ["mon"],
      posts: ["one", "two"]
    }]
  }));
  const messages = [];
  const publisher = new ChannelPublisher({ sendMessage: async (...args) => messages.push(args) }, configPath, statePath);

  assert.deepEqual(await publisher.publishDue(new Date("2026-07-13T15:30:00.000Z")), ["fun"]);
  assert.deepEqual(await publisher.publishDue(new Date("2026-07-13T15:31:00.000Z")), []);
  assert.deepEqual(messages.map((message) => message[1]), ["one"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, "utf8")).publishedSlots.fun["2026-07-13"], ["09:00", "13:00", "18:00"]);

  fs.rmSync(directory, { recursive: true, force: true });
});

test("channel publisher migrates the legacy daily marker to the first slot", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-channels-"));
  const configPath = path.join(directory, "channels.json");
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(configPath, JSON.stringify({
    channels: [{ id: "ai", chatId: "@ai", enabled: true, schedule: ["09:00", "17:00"], days: ["mon"], posts: ["later"] }]
  }));
  fs.writeFileSync(statePath, JSON.stringify({ published: { ai: "2026-07-13" } }));
  const messages = [];
  const publisher = new ChannelPublisher({ sendMessage: async (...args) => messages.push(args) }, configPath, statePath);

  assert.deepEqual(await publisher.publishDue(new Date("2026-07-13T07:00:00.000Z")), []);
  assert.deepEqual(await publisher.publishDue(new Date("2026-07-13T14:00:00.000Z")), ["ai"]);
  assert.equal(messages.length, 1);

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

test("channel publisher records one failure and continues with other channels", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-channels-"));
  const configPath = path.join(directory, "channels.json");
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(configPath, JSON.stringify({
    channels: [
      { id: "broken", chatId: "@broken", enabled: true, schedule: "09:00", days: ["mon"], posts: ["fail"] },
      { id: "healthy", chatId: "@healthy", enabled: true, schedule: "09:00", days: ["mon"], posts: ["send"] }
    ]
  }));
  const messages = [];
  const api = {
    sendMessage: async (chatId, message) => {
      if (chatId === "@broken") throw new Error("Forbidden");
      messages.push([chatId, message]);
    }
  };
  const publisher = new ChannelPublisher(api, configPath, statePath);
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    assert.deepEqual(await publisher.publishDue(new Date("2026-07-13T06:30:00.000Z")), ["healthy"]);
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(messages, [["@healthy", "send"]]);
  const status = Object.fromEntries(publisher.status().map((channel) => [channel.id, channel]));
  assert.equal(status.broken.lastError.message, "Forbidden");
  assert.equal(status.healthy.sent, 1);
  assert.equal(status.healthy.lastError, null);

  fs.rmSync(directory, { recursive: true, force: true });
});

test("channel publisher can select an API per channel", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-channels-"));
  const configPath = path.join(directory, "channels.json");
  fs.writeFileSync(configPath, JSON.stringify({
    channels: [
      { id: "admin", publisher: "admin", chatId: "@admin", enabled: true, schedule: "09:00", days: ["mon"], posts: ["one"] },
      { id: "party", publisher: "party", chatId: "@party", enabled: true, schedule: "09:00", days: ["mon"], posts: ["two"] }
    ]
  }));
  const messages = [];
  const publisher = new ChannelPublisher(
    (channel) => ({ sendMessage: async (chatId, message) => messages.push([channel.publisher, chatId, message]) }),
    configPath,
    path.join(directory, "state.json")
  );

  assert.deepEqual(await publisher.publishDue(new Date("2026-07-13T06:30:00.000Z")), ["admin", "party"]);
  assert.deepEqual(messages, [
    ["admin", "@admin", "one"],
    ["party", "@party", "two"]
  ]);

  fs.rmSync(directory, { recursive: true, force: true });
});

test("channel publisher adds a tracked promotion every configured interval", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-channels-"));
  const configPath = path.join(directory, "channels.json");
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(configPath, JSON.stringify({
    channels: [{
      id: "focus",
      chatId: "@focus",
      enabled: true,
      schedule: ["09:00", "10:00", "11:00"],
      days: ["mon"],
      promotion: { every: 3, text: "Start: https://t.me/FocusBot?start=src_channel_focus_auto" },
      posts: ["one", "two", "three"]
    }]
  }));
  const messages = [];
  const publisher = new ChannelPublisher({ sendMessage: async (...args) => messages.push(args) }, configPath, statePath);

  await publisher.publishDue(new Date("2026-07-13T06:00:00.000Z"));
  await publisher.publishDue(new Date("2026-07-13T07:00:00.000Z"));
  await publisher.publishDue(new Date("2026-07-13T08:00:00.000Z"));

  assert.deepEqual(messages.map((message) => message[1]), [
    "one",
    "two",
    "three\n\nStart: https://t.me/FocusBot?start=src_channel_focus_auto"
  ]);
  assert.equal(publisher.status()[0].promotionEvery, 3);

  fs.rmSync(directory, { recursive: true, force: true });
});

test("channel publisher does not duplicate a Telegram link already in a post", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-channels-"));
  const configPath = path.join(directory, "channels.json");
  const statePath = path.join(directory, "state.json");
  const linkedPost = "Already linked: https://t.me/FocusBot?start=src_existing";
  fs.writeFileSync(configPath, JSON.stringify({
    channels: [{
      id: "focus",
      chatId: "@focus",
      enabled: true,
      schedule: "09:00",
      days: ["mon"],
      promotion: { every: 3, text: "Extra: https://t.me/FocusBot?start=src_auto" },
      posts: [linkedPost]
    }]
  }));
  fs.writeFileSync(statePath, JSON.stringify({ sent: { focus: 2 } }));
  const messages = [];
  const publisher = new ChannelPublisher({ sendMessage: async (...args) => messages.push(args) }, configPath, statePath);

  await publisher.publishDue(new Date("2026-07-13T06:00:00.000Z"));
  assert.equal(messages[0][1], linkedPost);

  fs.rmSync(directory, { recursive: true, force: true });
});
