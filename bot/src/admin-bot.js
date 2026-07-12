import { Bot, InlineKeyboard } from "grammy";
import { adminKeyboard } from "./keyboards.js";
import { BudgetStore } from "./budget-store.js";
import { FocusStore } from "./focus-store.js";
import { GameStore } from "./game-store.js";
import { LanguageStore } from "./language-store.js";
import { HubStore } from "./hub-store.js";
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
  const admins = parseAdmins(adminIds);
  const bot = new Bot(token);

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
      parts.push(`TerraTectra Bots\nПользователей: ${hub.users}\nПереходов к ботам: ${hub.opens}\nПредложений: ${hub.suggestions}`);
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
      parts.push(`TerraTectra Bots\nНовые сегодня: ${growth.newToday}\nНовые за 7 дней: ${growth.new7}\nПереходы к ботам: ${growth.opens7}\nПредложения: ${growth.suggestions7}`);
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
      ["TerraTectra Bots", hubStore]
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

  bot.command("start", (ctx) => ctx.reply("Админ-панель анонимного чата готова.", { reply_markup: adminKeyboard }));
  bot.command("stats", (ctx) => ctx.reply(allStatsText(), { reply_markup: adminKeyboard }));
  bot.hears(["📊 Статистика", "🔄 Обновить"], (ctx) => ctx.reply(allStatsText(), { reply_markup: adminKeyboard }));
  bot.command("growth", (ctx) => ctx.reply(allGrowthText(), { reply_markup: adminKeyboard }));
  bot.hears("📈 Рост", (ctx) => ctx.reply(allGrowthText(), { reply_markup: adminKeyboard }));
  bot.command("sources", (ctx) => ctx.reply(allSourcesText(), { reply_markup: adminKeyboard }));

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
