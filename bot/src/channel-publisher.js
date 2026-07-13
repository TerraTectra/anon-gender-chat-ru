import fs from "node:fs";
import path from "node:path";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function moscowParts(date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    weekday: values.weekday.toLowerCase().slice(0, 3),
    minutes: Number(values.hour) * 60 + Number(values.minute)
  };
}

function scheduleMinutes(value = "00:00") {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

export class ChannelPublisher {
  constructor(api, configPath, statePath, now = () => new Date()) {
    this.api = api;
    this.configPath = path.resolve(configPath);
    this.statePath = path.resolve(statePath);
    this.now = now;
    this.timer = null;
    this.running = false;
  }

  readConfig() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, "utf8"));
      return Array.isArray(parsed.channels) ? parsed.channels : [];
    } catch {
      return [];
    }
  }

  readState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
      return {
        published: parsed.published || {},
        cursors: parsed.cursors || {},
        sent: parsed.sent || {},
        lastPublishedAt: parsed.lastPublishedAt || {}
      };
    } catch {
      return { published: {}, cursors: {}, sent: {}, lastPublishedAt: {} };
    }
  }

  saveState(state) {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
    fs.renameSync(temporary, this.statePath);
  }

  async publishChannel(channel, state, date) {
    const cursor = Number(state.cursors[channel.id] || 0) % channel.posts.length;
    await this.api.sendMessage(channel.chatId, channel.posts[cursor], {
      link_preview_options: { is_disabled: true }
    });
    state.published[channel.id] = moscowParts(date).date;
    state.cursors[channel.id] = (cursor + 1) % channel.posts.length;
    state.sent[channel.id] = Number(state.sent[channel.id] || 0) + 1;
    state.lastPublishedAt[channel.id] = date.toISOString();
    this.saveState(state);
    return channel.id;
  }

  async publishDue(date = this.now()) {
    const current = moscowParts(date);
    const state = this.readState();
    const published = [];

    for (const channel of this.readConfig()) {
      const plannedMinutes = scheduleMinutes(channel.schedule);
      const days = channel.days?.length ? channel.days : WEEKDAYS;
      if (!channel.enabled || !channel.chatId || !channel.posts?.length) continue;
      if (!days.includes(current.weekday) || plannedMinutes === null || current.minutes < plannedMinutes) continue;
      if (state.published[channel.id] === current.date) continue;

      published.push(await this.publishChannel(channel, state, date));
    }
    return published;
  }

  async publishNow(channelIds = null, date = this.now()) {
    const current = moscowParts(date);
    const selected = channelIds ? new Set(channelIds) : null;
    const state = this.readState();
    const published = [];
    for (const channel of this.readConfig()) {
      if (!channel.enabled || !channel.chatId || !channel.posts?.length) continue;
      if (selected && !selected.has(channel.id)) continue;
      if (state.published[channel.id] === current.date) continue;
      published.push(await this.publishChannel(channel, state, date));
    }
    return published;
  }

  status() {
    const state = this.readState();
    return this.readConfig().map((channel) => ({
      id: channel.id,
      title: channel.title,
      chatId: channel.chatId,
      enabled: Boolean(channel.enabled),
      schedule: channel.schedule,
      days: channel.days || WEEKDAYS,
      queued: channel.posts?.length || 0,
      sent: Number(state.sent[channel.id] || 0),
      lastPublishedAt: state.lastPublishedAt[channel.id] || null
    }));
  }

  async tick() {
    if (this.running) return [];
    this.running = true;
    try {
      return await this.publishDue();
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 60_000) {
    if (this.timer) return;
    this.tick().catch((error) => console.error("Channel publisher error", error));
    this.timer = setInterval(() => {
      this.tick().catch((error) => console.error("Channel publisher error", error));
    }, intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
