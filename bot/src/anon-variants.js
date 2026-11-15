import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { InputFile } from "grammy";
import { createUserBot } from "./user-bot.js";
import { Store } from "./store.js";

export const anonVariants = Object.freeze([
  {
    "id": "english",
    "tokenEnv": "ENGLISH_BOT_TOKEN",
    "username": "EnglishTalkMatchBot",
    "name": "Искра — анонимный чат",
    "short": "Искра: случайный разговор один на один.",
    "icon": "spark",
    "description": "Искра — анонимный чат. Анонимный чат 12+: случайный поиск и фильтры пола и возраста, разделение групп 12–17 и 18+, жалобы и блокировки. Telegram-профили участников не раскрываются."
  },
  {
    "id": "focus",
    "tokenEnv": "FOCUS_BOT_TOKEN",
    "username": "FocusSprintTimerBot",
    "name": "Полночь — анонимный чат",
    "short": "Полночь: анонимное общение без знакомства.",
    "icon": "moon",
    "description": "Полночь — анонимный чат. Анонимный чат 12+: случайный поиск и фильтры пола и возраста, разделение групп 12–17 и 18+, жалобы и блокировки. Telegram-профили участников не раскрываются."
  },
  {
    "id": "game",
    "tokenEnv": "GAME_BOT_TOKEN",
    "username": "GameMateFinderRuBot",
    "name": "На волне — анонимный чат",
    "short": "На волне: случайный собеседник в Telegram.",
    "icon": "wave",
    "description": "На волне — анонимный чат. Анонимный чат 12+: случайный поиск и фильтры пола и возраста, разделение групп 12–17 и 18+, жалобы и блокировки. Telegram-профили участников не раскрываются."
  },
  {
    "id": "budget",
    "tokenEnv": "BUDGET_BOT_TOKEN",
    "username": "PocketBudgetRuBot",
    "name": "Без имени — анонимный чат",
    "short": "Разговор один на один без раскрытия своего имени.",
    "icon": "mask",
    "description": "Без имени — анонимный чат. Анонимный чат 12+: случайный поиск и фильтры пола и возраста, разделение групп 12–17 и 18+, жалобы и блокировки. Telegram-профили участников не раскрываются."
  },
  {
    "id": "hub",
    "tokenEnv": "HUB_BOT_TOKEN",
    "username": "TerraTectraBotsBot",
    "name": "Тихая комната — анонимно",
    "short": "Спокойный анонимный разговор один на один.",
    "icon": "door",
    "description": "Тихая комната — анонимно. Анонимный чат 12+: случайный поиск и фильтры пола и возраста, разделение групп 12–17 и 18+, жалобы и блокировки. Telegram-профили участников не раскрываются."
  },
  {
    "id": "task",
    "tokenEnv": "TASK_BOT_TOKEN",
    "username": "DevTaks_bot",
    "name": "Откровенно — анонимный чат",
    "short": "Разговор без раскрытия Telegram-профиля.",
    "icon": "bubble",
    "description": "Откровенно — анонимный чат. Анонимный чат 12+: случайный поиск и фильтры пола и возраста, разделение групп 12–17 и 18+, жалобы и блокировки. Telegram-профили участников не раскрываются."
  },
  {
    "id": "quiz",
    "tokenEnv": "QUIZ_BOT_TOKEN",
    "username": "TectraQuizBot",
    "name": "Диалог 24 — анонимный чат",
    "short": "Найти случайного собеседника в анонимном чате.",
    "icon": "chat",
    "description": "Диалог 24 — анонимный чат. Анонимный чат 12+: случайный поиск и фильтры пола и возраста, разделение групп 12–17 и 18+, жалобы и блокировки. Telegram-профили участников не раскрываются."
  },
  {
    "id": "party",
    "tokenEnv": "PARTY_BOT_TOKEN",
    "username": "TectraPartyBot",
    "name": "Просто поговорим — чат",
    "short": "Начать разговор один на один в Telegram.",
    "icon": "heart",
    "description": "Просто поговорим — чат. Анонимный чат 12+: случайный поиск и фильтры пола и возраста, разделение групп 12–17 и 18+, жалобы и блокировки. Telegram-профили участников не раскрываются."
  }
]);

export const anonVariantDbPath = (id) => path.resolve("./data/anon-variants/" + id + ".db");

export function createAnonVariantBot(id, token, adminIds) {
  const brand = anonVariants.find((item) => item.id === id);
  if (!brand) throw new Error("Unknown variant: " + id);
  const bot = createUserBot(token, anonVariantDbPath(id), {
    brandId: id, brandName: brand.name, isVariant: true, concurrency: 4,
    sessionArchiveRoot: path.resolve("./data/anon-variants/session-archive/" + id),
    adminIds
  });
  bot.anonVariant = brand;
  bot.syncProfile = async () => {
    const calls = [
      bot.api.setMyName(brand.name),
      bot.api.setMyDescription(brand.description),
      bot.api.setMyShortDescription(brand.short),
      bot.api.setMyCommands([
        { command: "start", description: "Начать анонимное общение" },
        { command: "search", description: "Случайный собеседник" },
        { command: "filters", description: "Поиск с фильтрами" },
        { command: "stop", description: "Завершить разговор" },
        { command: "report", description: "Пожаловаться" },
        { command: "privacy", description: "Приватность и хранение данных" }
      ])
    ];
    const results = await Promise.allSettled(calls);
    if (results.some((result) => result.status === "rejected")) throw new Error("Profile sync failed: " + id);
    const photo = path.resolve("./assets/avatars/" + id + ".png");
    if (fs.existsSync(photo)) await bot.api.setMyProfilePhoto({ type: "static", photo: new InputFile(photo) });
  };
  return bot;
}

export function anonVariantMetrics() {
  return anonVariants.map((brand) => {
    const file = anonVariantDbPath(brand.id);
    const row = { id: brand.id, name: brand.name, username: brand.username, ready: false, users: 0, starts7: 0, active7: 0, matches7: 0, searching: 0, chatting: 0, reports7: 0 };
    if (!fs.existsSync(file)) return row;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      row.users = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
      row.starts7 = db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='start' AND created_at >= datetime('now','-7 days')").get().n;
      row.active7 = db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE created_at >= datetime('now','-7 days')").get().n;
      row.matches7 = db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='match' AND created_at >= datetime('now','-7 days')").get().n;
      row.searching = db.prepare("SELECT COUNT(*) AS n FROM users WHERE state='searching'").get().n;
      row.chatting = db.prepare("SELECT COUNT(*) AS n FROM users WHERE partner_id IS NOT NULL").get().n / 2;
      row.reports7 = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE created_at >= datetime('now','-7 days')").get().n;
      row.ready = true;
    } finally {
      db.close();
    }
    return row;
  });
}

export function banAcrossAnonVariants(userId, banned) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid user id");
  for (const brand of anonVariants) {
    const filename = anonVariantDbPath(brand.id);
    if (!fs.existsSync(filename)) continue;
    const store = new Store(filename, { sessionArchiveRoot: path.resolve("./data/anon-variants/session-archive/" + brand.id) });
    try {
      if (banned) store.banUser(userId);
      else store.unbanUser(userId);
    } finally {
      store.close();
    }
  }
}

export function pendingAnonVariantReports(limit = 30) {
  const reports = [];
  for (const brand of anonVariants) {
    const filename = anonVariantDbPath(brand.id);
    if (!fs.existsSync(filename)) continue;
    const db = new DatabaseSync(filename, { readOnly: true });
    try {
      for (const item of db.prepare("SELECT id, reporter_id, reported_id, created_at FROM reports WHERE reviewed_at IS NULL ORDER BY id DESC LIMIT ?").all(limit)) {
        reports.push({ ...item, variantId: brand.id, variantName: brand.name });
      }
    } finally {
      db.close();
    }
  }
  return reports.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}

export function reviewAnonVariantReport(id, reportId) {
  if (!anonVariants.some((brand) => brand.id === id) || !Number.isSafeInteger(reportId) || reportId < 1) return false;
  const filename = anonVariantDbPath(id);
  if (!fs.existsSync(filename)) return false;
  const store = new Store(filename, { sessionArchiveRoot: path.resolve("./data/anon-variants/session-archive/" + id) });
  try {
    store.reviewReport(reportId);
    return true;
  } finally {
    store.close();
  }
}
