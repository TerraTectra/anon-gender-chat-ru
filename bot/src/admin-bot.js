import fs from "node:fs";
import path from "node:path";
import { Bot, InlineKeyboard } from "grammy";
import { adminKeyboard } from "./keyboards.js";
import { BudgetStore } from "./budget-store.js";
import { FocusStore } from "./focus-store.js";
import { GameStore } from "./game-store.js";
import { LanguageStore } from "./language-store.js";
import { HubStore } from "./hub-store.js";
import { TaskStore } from "./task-store.js";
import { Store } from "./store.js";

function parseAdmins(value = "") {
  return new Set(value.split(",").map((item) => Number(item.trim())).filter(Number.isSafeInteger));
}

function statsText(stats) {
  return `Пользователей: ${stats.users}\nИщут: ${stats.searching}\nАктивных чатов: ${stats.chatting}\nНовых жалоб: ${stats.reports}\nЗаблокировано: ${stats.banned}`;
}

export function createAdminBot(token, dbPath, adminIds, options = {}) {
  const store = new Store(dbPath);
  const englishStore = options.englishDbPath ? new LanguageStore(options.englishDbPath) : null;
  const focusStore = options.focusDbPath ? new FocusStore(options.focusDbPath) : null;
  const gameStore = options.gameDbPath ? new GameStore(options.gameDbPath) : null;
  const budgetStore = options.budgetDbPath ? new BudgetStore(options.budgetDbPath) : null;
  const hubStore = options.hubDbPath ? new HubStore(options.hubDbPath) : null;
  const taskStore = options.taskDbPath ? new TaskStore(options.taskDbPath) : null;
  const admins = parseAdmins(adminIds);
  const bot = new Bot(token);
  const healthPath = path.resolve(options.healthPath || "./data/health.json");

  const productKeyboard = new InlineKeyboard()
    .text("Анонимный чат", "admin_product:anon")
    .text("English", "admin_product:english")
    .row()
    .text("Focus Sprint", "admin_product:focus")
    .text("Game Mate", "admin_product:game")
    .row()
    .text("Бюджет", "admin_product:budget")
    .text("Task Pulse", "admin_product:tasks")
    .row()
    .text("TerraTectra Hub", "admin_product:hub");

  function networkOverviewText() {
    const chat = store.stats();
    const english = englishStore?.stats();
    const focus = focusStore?.stats();
    const game = gameStore?.stats();
    const budget = budgetStore?.stats();
    const hub = hubStore?.stats();
    const tasks = taskStore?.stats();
    const productStats = [chat, english, focus, game, budget, hub, tasks].filter(Boolean);
    const registrations = productStats.reduce((sum, item) => sum + (item.users || 0), 0);
    const activeNow = (chat.chatting || 0) + (english?.chatting || 0) + (game?.chatting || 0)
      + (focus?.active || 0) + (tasks?.active || 0);
    const usefulActions = (focus?.completed || 0) + (budget?.entries || 0) + (tasks?.done || 0)
      + (hub?.opens || 0);
    const reports = (chat.reports || 0) + (english?.reports || 0) + (game?.reports || 0);

    return `TerraTectra Admin Hub\n\nПродуктов: ${productStats.length}\nРегистраций в продуктах: ${registrations}\nАктивно сейчас: ${activeNow}\nПолезных действий: ${usefulActions}\n\nНовых лидов: ${hub?.pendingLeads || 0}\nНовых идей: ${hub?.pendingSuggestions || 0}\nНовых жалоб: ${reports}`;
  }

  function productStatsText(product) {
    if (product === "anon") return `Анонимный чат\n\n${statsText(store.stats())}\n\n${pairGrowthText("За 7 дней", store.growthStats())}`;
    if (product === "english" && englishStore) return `English Talk Match\n\n${statsText(englishStore.stats())}\n\n${pairGrowthText("За 7 дней", englishStore.growthStats())}`;
    if (product === "game" && gameStore) return `Game Mate\n\n${statsText(gameStore.stats())}\n\n${pairGrowthText("За 7 дней", gameStore.growthStats())}`;
    if (product === "focus" && focusStore) {
      const current = focusStore.stats();
      const growth = focusStore.growthStats();
      return `Focus Sprint\n\nПользователей: ${current.users}\nАктивных сессий: ${current.active}\nЗавершено: ${current.completed}\nФокус-время: ${current.minutes} мин.\nЗаблокировано: ${current.banned}\n\nЗа 7 дней\nНовые: ${growth.new7}\nПо приглашениям: ${growth.referred}\nСессии: ${growth.sessions7}\nЗавершено: ${growth.completed7}`;
    }
    if (product === "budget" && budgetStore) {
      const current = budgetStore.stats();
      const growth = budgetStore.growthStats();
      return `Карманный бюджет\n\nПользователей: ${current.users}\nЗаписей: ${current.entries}\nАктивны за 30 дней: ${current.active30}\nЗаблокировано: ${current.banned}\n\nЗа 7 дней\nНовые: ${growth.new7}\nПо приглашениям: ${growth.referred}\nЗаписей: ${growth.entries7}\nАктивных пользователей: ${growth.active7}`;
    }
    if (product === "tasks" && taskStore) {
      const current = taskStore.stats();
      const growth = taskStore.growthStats();
      return `Task Pulse\n\nПользователей: ${current.users}\nАктивных задач: ${current.active}\nВыполнено: ${current.done}\nЗаблокировано: ${current.banned}\n\nЗа 7 дней\nНовые: ${growth.new7}\nПо приглашениям: ${growth.referred}\nСоздано задач: ${growth.tasks7}\nВыполнено: ${growth.done7}`;
    }
    if (product === "hub" && hubStore) {
      const current = hubStore.stats();
      const growth = hubStore.growthStats();
      return `TerraTectra Bots\n\nПользователей: ${current.users}\nПереходов к ботам: ${current.opens}\nИзбранных: ${current.favorites}\nЛидов: ${current.leads}\nНовых лидов: ${current.pendingLeads}\nПредложений: ${current.suggestions}\nНовых идей: ${current.pendingSuggestions}\n\nЗа 7 дней\nНовые: ${growth.new7}\nПереходы к ботам: ${growth.opens7}\nЛиды: ${growth.leads7}\nПредложения: ${growth.suggestions7}`;
    }
    return "Этот продукт пока не подключён к админ-хабу.";
  }

  function healthText() {
    try {
      const health = JSON.parse(fs.readFileSync(healthPath, "utf8"));
      const updated = health.updated_at ? new Date(health.updated_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : "нет данных";
      return `Состояние системы\n\nСтатус: ${health.status === "running" ? "работает" : health.status}\nЗапущено ботов: ${health.bots ?? "нет данных"}\nПоследний сигнал: ${updated} МСК`;
    } catch {
      return "Состояние системы недоступно: файл health.json ещё не создан.";
    }
  }

  function allStatsText() {
    const parts = [`Анонимный чат\n${statsText(store.stats())}`];
    if (englishStore) parts.push(`English Talk Match\n${statsText(englishStore.stats())}`);
    if (focusStore) {
      const focus = focusStore.stats();
      parts.push(`Focus Sprint\nПользователей: ${focus.users}\nАктивных сессий: ${focus.active}\nЗавершено: ${focus.completed}\nФокус-время: ${focus.minutes} мин.\nЗаблокировано: ${focus.banned}`);
    }
    if (gameStore) parts.push(`Game Mate\n${statsText(gameStore.stats())}`);
    if (budgetStore) {
      const budget = budgetStore.stats();
      parts.push(`Карманный бюджет\nПользователей: ${budget.users}\nЗаписей: ${budget.entries}\nАктивны за 30 дней: ${budget.active30}\nЗаблокировано: ${budget.banned}`);
    }
    if (hubStore) {
      const hub = hubStore.stats();
      parts.push(`TerraTectra Bots\nПользователей: ${hub.users}\nПереходов к ботам: ${hub.opens}\nИзбранных ботов: ${hub.favorites}\nЛидов: ${hub.leads}\nНовых лидов: ${hub.pendingLeads}\nПредложений: ${hub.suggestions}\nНовых идей: ${hub.pendingSuggestions}`);
    }
    if (taskStore) {
      const tasks = taskStore.stats();
      parts.push(`Task Pulse\nПользователей: ${tasks.users}\nАктивных задач: ${tasks.active}\nВыполнено: ${tasks.done}\nЗаблокировано: ${tasks.banned}`);
    }
    return parts.join("\n\n");
  }

  function pairGrowthText(name, growth) {
    return `${name}\nНовые сегодня: ${growth.newToday}\nНовые за 7 дней: ${growth.new7}\nПо приглашениям: ${growth.referred}\nСтарты: ${growth.starts7}\nПоиски: ${growth.searches7}\nНайдено пар: ${growth.matches7}\nЖалобы: ${growth.reports7}`;
  }

  function allGrowthText() {
    const parts = [pairGrowthText("Анонимный чат", store.growthStats())];
    if (englishStore) parts.push(pairGrowthText("English Talk Match", englishStore.growthStats()));
    if (gameStore) parts.push(pairGrowthText("Game Mate", gameStore.growthStats()));
    if (focusStore) {
      const growth = focusStore.growthStats();
      parts.push(`Focus Sprint\nНовые сегодня: ${growth.newToday}\nНовые за 7 дней: ${growth.new7}\nПо приглашениям: ${growth.referred}\nСессии: ${growth.sessions7}\nЗавершено: ${growth.completed7}`);
    }
    if (budgetStore) {
      const growth = budgetStore.growthStats();
      parts.push(`Карманный бюджет\nНовые сегодня: ${growth.newToday}\nНовые за 7 дней: ${growth.new7}\nПо приглашениям: ${growth.referred}\nЗаписей: ${growth.entries7}\nАктивных пользователей: ${growth.active7}`);
    }
    if (hubStore) {
      const growth = hubStore.growthStats();
      parts.push(`TerraTectra Bots\nНовые сегодня: ${growth.newToday}\nНовые за 7 дней: ${growth.new7}\nПереходы к ботам: ${growth.opens7}\nЛиды: ${growth.leads7}\nПредложения: ${growth.suggestions7}`);
    }
    if (taskStore) {
      const growth = taskStore.growthStats();
      parts.push(`Task Pulse\nНовые сегодня: ${growth.newToday}\nНовые за 7 дней: ${growth.new7}\nПо приглашениям: ${growth.referred}\nСоздано задач: ${growth.tasks7}\nВыполнено: ${growth.done7}`);
    }
    return `Метрики за последние 7 дней\n\n${parts.join("\n\n")}`;
  }

  function allSourcesText() {
    const products = [
      ["Анонимный чат", store],
      ["English Talk Match", englishStore],
      ["Focus Sprint", focusStore],
      ["Game Mate", gameStore],
      ["Карманный бюджет", budgetStore],
      ["TerraTectra Bots", hubStore],
      ["Task Pulse", taskStore]
    ];
    const parts = products.filter(([, productStore]) => productStore).map(([name, productStore]) => {
      const rows = productStore.sourceStats(10);
      const lines = rows.length ? rows.map((row) => `${row.source}: ${row.users}`) : ["источников пока нет"];
      return `${name}\n${lines.join("\n")}`;
    });
    return `Источники пользователей\n\n${parts.join("\n\n")}`;
  }

  bot.use(async (ctx, next) => {
    if (!ctx.from) return;
    if (ctx.message?.text === "/id") {
      await ctx.reply(`Ваш Telegram ID: ${ctx.from.id}`);
      return;
    }
    if (!admins.has(ctx.from.id)) {
      await ctx.reply("Доступ запрещён. Отправьте /id и добавьте этот ID в ADMIN_IDS.");
      return;
    }
    await next();
  });

  bot.command("start", (ctx) => ctx.reply(networkOverviewText(), { reply_markup: adminKeyboard }));
  bot.command("overview", (ctx) => ctx.reply(networkOverviewText(), { reply_markup: adminKeyboard }));
  bot.hears(["🏠 Обзор", "🔄 Обновить"], (ctx) => ctx.reply(networkOverviewText(), { reply_markup: adminKeyboard }));
  bot.command("products", (ctx) => ctx.reply("Выберите продукт:", { reply_markup: productKeyboard }));
  bot.hears("🤖 Боты", (ctx) => ctx.reply("Выберите продукт:", { reply_markup: productKeyboard }));
  bot.callbackQuery(/^admin_product:(anon|english|focus|game|budget|tasks|hub)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(productStatsText(ctx.match[1]), { reply_markup: productKeyboard });
  });
  bot.command("health", (ctx) => ctx.reply(healthText(), { reply_markup: adminKeyboard }));
  bot.hears("💚 Состояние", (ctx) => ctx.reply(healthText(), { reply_markup: adminKeyboard }));
  bot.command("stats", (ctx) => ctx.reply(allStatsText(), { reply_markup: adminKeyboard }));
  bot.hears("📊 Статистика", (ctx) => ctx.reply(allStatsText(), { reply_markup: adminKeyboard }));
  bot.command("growth", (ctx) => ctx.reply(allGrowthText(), { reply_markup: adminKeyboard }));
  bot.hears("📈 Рост", (ctx) => ctx.reply(allGrowthText(), { reply_markup: adminKeyboard }));
  bot.command("sources", (ctx) => ctx.reply(allSourcesText(), { reply_markup: adminKeyboard }));
  bot.hears("🧭 Источники", (ctx) => ctx.reply(allSourcesText(), { reply_markup: adminKeyboard }));

  async function sendIdeas(ctx) {
    if (!hubStore) return ctx.reply("Хаб не подключён.", { reply_markup: adminKeyboard });
    const ideas = hubStore.recentSuggestions(10);
    if (!ideas.length) return ctx.reply("Новых идей для ботов нет.", { reply_markup: adminKeyboard });
    for (const idea of ideas) {
      const author = idea.username ? `@${idea.username}` : String(idea.user_id);
      const keyboard = new InlineKeyboard()
        .text("В план", `idea:planned:${idea.id}`)
        .text("Отклонить", `idea:rejected:${idea.id}`);
      await ctx.reply(`Идея #${idea.id}\nОт: ${author}\n\n${idea.text}`, { reply_markup: keyboard });
    }
  }

  bot.command("ideas", sendIdeas);
  bot.hears("💡 Идеи", sendIdeas);

  bot.callbackQuery(/^idea:(planned|rejected):(\d+)$/, async (ctx) => {
    const status = ctx.match[1];
    const id = Number(ctx.match[2]);
    const updated = hubStore?.reviewSuggestion(id, status);
    await ctx.answerCallbackQuery(updated ? "Статус сохранён" : "Идея уже обработана");
    if (updated) await ctx.editMessageText(`Идея #${id}: ${status === "planned" ? "добавлена в план" : "отклонена"}.`);
  });

  async function sendLeads(ctx) {
    if (!hubStore) return ctx.reply("Хаб не подключён.", { reply_markup: adminKeyboard });
    const leads = hubStore.recentLeads(10);
    if (!leads.length) return ctx.reply("Новых лидов нет.", { reply_markup: adminKeyboard });
    for (const lead of leads) {
      const contact = lead.username ? `@${lead.username}` : `Telegram ID ${lead.user_id}`;
      const keyboard = new InlineKeyboard()
        .text("Связались", `lead:contacted:${lead.id}`)
        .text("В работу", `lead:won:${lead.id}`)
        .text("Отклонить", `lead:rejected:${lead.id}`);
      await ctx.reply(`Лид #${lead.id}\nКонтакт: ${contact}\nБюджет: ${lead.budget}\nСрок: ${lead.deadline}\nИсточник: ${lead.source ?? "не указан"}\n\n${lead.request}`, { reply_markup: keyboard });
    }
  }

  bot.command("leads", sendLeads);
  bot.hears("💼 Лиды", sendLeads);

  bot.callbackQuery(/^lead:(contacted|won|rejected):(\d+)$/, async (ctx) => {
    const status = ctx.match[1];
    const id = Number(ctx.match[2]);
    const updated = hubStore?.reviewLead(id, status);
    await ctx.answerCallbackQuery(updated ? "Статус сохранён" : "Лид уже обработан");
    if (updated) await ctx.editMessageText(`Лид #${id}: ${status}.`);
  });

  async function sendReportsForStore(ctx, reportStore, brand, callbackPrefix) {
    const reports = reportStore.recentReports(10);
    for (const report of reports) {
      const keyboard = new InlineKeyboard()
        .text("Заблокировать", `${callbackPrefix}:ban:${report.id}:${report.reported_id}`)
        .text("Закрыть", `${callbackPrefix}:review:${report.id}`);
      await ctx.reply(`${brand}\n#${report.id}\nЖалоба от: ${report.reporter_id}\nНа пользователя: ${report.reported_id}\nДата: ${report.created_at}`, { reply_markup: keyboard });
    }
    return reports.length;
  }

  async function sendReports(ctx) {
    let count = await sendReportsForStore(ctx, store, "Анонимный чат", "admin");
    if (englishStore) count += await sendReportsForStore(ctx, englishStore, "English Talk Match", "english_admin");
    if (gameStore) count += await sendReportsForStore(ctx, gameStore, "Game Mate", "game_admin");
    if (!count) {
      await ctx.reply("Новых жалоб нет.", { reply_markup: adminKeyboard });
    }
  }

  bot.command("reports", sendReports);
  bot.hears("🚩 Жалобы", sendReports);

  bot.command("ban", async (ctx) => {
    const userId = Number(ctx.match?.trim());
    if (!Number.isSafeInteger(userId)) return ctx.reply("Формат: /ban 123456789");
    store.banUser(userId);
    englishStore?.banUser(userId);
    focusStore?.banUser(userId);
    gameStore?.banUser(userId);
    budgetStore?.banUser(userId);
    taskStore?.banUser(userId);
    await ctx.reply(`Пользователь ${userId} заблокирован.`);
  });

  bot.command("unban", async (ctx) => {
    const userId = Number(ctx.match?.trim());
    if (!Number.isSafeInteger(userId)) return ctx.reply("Формат: /unban 123456789");
    store.unbanUser(userId);
    englishStore?.unbanUser(userId);
    focusStore?.unbanUser(userId);
    gameStore?.unbanUser(userId);
    budgetStore?.unbanUser(userId);
    taskStore?.unbanUser(userId);
    await ctx.reply(`Пользователь ${userId} разблокирован.`);
  });

  bot.callbackQuery(/^admin:ban:(\d+):(\d+)$/, async (ctx) => {
    const reportId = Number(ctx.match[1]);
    const userId = Number(ctx.match[2]);
    store.banUser(userId);
    englishStore?.banUser(userId);
    focusStore?.banUser(userId);
    gameStore?.banUser(userId);
    budgetStore?.banUser(userId);
    taskStore?.banUser(userId);
    store.reviewReport(reportId);
    await ctx.answerCallbackQuery("Пользователь заблокирован во всех ботах");
    await ctx.editMessageText(`Жалоба #${reportId}: пользователь ${userId} заблокирован.`);
  });

  bot.callbackQuery(/^admin:review:(\d+)$/, async (ctx) => {
    const reportId = Number(ctx.match[1]);
    store.reviewReport(reportId);
    await ctx.answerCallbackQuery("Жалоба закрыта");
    await ctx.editMessageText(`Жалоба #${reportId} закрыта без блокировки.`);
  });

  bot.callbackQuery(/^english_admin:ban:(\d+):(\d+)$/, async (ctx) => {
    const reportId = Number(ctx.match[1]);
    const userId = Number(ctx.match[2]);
    englishStore?.banUser(userId);
    englishStore?.reviewReport(reportId);
    store.banUser(userId);
    focusStore?.banUser(userId);
    gameStore?.banUser(userId);
    budgetStore?.banUser(userId);
    taskStore?.banUser(userId);
    await ctx.answerCallbackQuery("Пользователь заблокирован во всех ботах");
    await ctx.editMessageText(`English Talk Match, жалоба #${reportId}: пользователь ${userId} заблокирован.`);
  });

  bot.callbackQuery(/^english_admin:review:(\d+)$/, async (ctx) => {
    const reportId = Number(ctx.match[1]);
    englishStore?.reviewReport(reportId);
    await ctx.answerCallbackQuery("Жалоба закрыта");
    await ctx.editMessageText(`English Talk Match, жалоба #${reportId} закрыта без блокировки.`);
  });

  bot.callbackQuery(/^game_admin:ban:(\d+):(\d+)$/, async (ctx) => {
    const reportId = Number(ctx.match[1]);
    const userId = Number(ctx.match[2]);
    gameStore?.banUser(userId);
    gameStore?.reviewReport(reportId);
    store.banUser(userId);
    englishStore?.banUser(userId);
    focusStore?.banUser(userId);
    budgetStore?.banUser(userId);
    taskStore?.banUser(userId);
    await ctx.answerCallbackQuery("Пользователь заблокирован во всех ботах");
    await ctx.editMessageText(`Game Mate, жалоба #${reportId}: пользователь ${userId} заблокирован.`);
  });

  bot.callbackQuery(/^game_admin:review:(\d+)$/, async (ctx) => {
    const reportId = Number(ctx.match[1]);
    gameStore?.reviewReport(reportId);
    await ctx.answerCallbackQuery("Жалоба закрыта");
    await ctx.editMessageText(`Game Mate, жалоба #${reportId} закрыта без блокировки.`);
  });

  bot.catch((error) => console.error("Admin bot error", error.error));
  return bot;
}
