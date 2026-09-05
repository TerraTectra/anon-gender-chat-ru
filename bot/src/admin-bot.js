import fs from "node:fs";
import path from "node:path";
import { Bot, InlineKeyboard, InputFile } from "grammy";
import { adminKeyboard } from "./keyboards.js";
import { BudgetStore } from "./budget-store.js";
import { EngagementStore } from "./engagement-store.js";
import { FocusStore } from "./focus-store.js";
import { GameStore } from "./game-store.js";
import { LanguageStore } from "./language-store.js";
import { HubStore } from "./hub-store.js";
import { products as catalogProducts } from "./products.js";
import { safeErrorSummary } from "./safe-error.js";
import { TaskStore } from "./task-store.js";
import { Store } from "./store.js";

function parseAdmins(value = "") {
  return new Set(value.split(",").map((item) => Number(item.trim())).filter(Number.isSafeInteger));
}

function statsText(stats) {
  return `Пользователей: ${stats.users}\nИщут: ${stats.searching}\nАктивных чатов: ${stats.chatting}\nНовых жалоб: ${stats.reports}\nЗаблокировано: ${stats.banned}`;
}

const SESSION_PAGE_SIZE = 8;

function moscowDateTime(timestamp) {
  if (!timestamp) return "неизвестно";
  return new Date(Number(timestamp)).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function elapsedText(milliseconds) {
  const totalMinutes = Math.max(0, Math.floor(Number(milliseconds || 0) / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} мин.`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours} ч ${minutes} мин.` : `${hours} ч`;
  const days = Math.floor(hours / 24);
  return `${days} дн. ${hours % 24} ч`;
}

function participantText(participant) {
  const username = participant.username ? `@${participant.username}` : "без username";
  const gender = participant.gender === "male" ? "м" : participant.gender === "female" ? "ж" : "—";
  return `${username} · ID ${participant.id} · ${gender}, ${participant.age ?? "—"}`;
}

export function chatSessionText(session, now = Date.now()) {
  const active = session.status === "active";
  const until = active ? now : session.ended_at_ms;
  const status = active ? "активна" : "завершена";
  const recovered = session.legacy_backfill ? "\nНачало восстановлено после перезапуска и может быть неточным." : "";
  const expiry = session.expires_at_ms ? `\nУдаление архива: ${moscowDateTime(session.expires_at_ms)} МСК` : "";
  const unavailable = Number(session.unavailable_count || 0)
    ? `\nНедоступно локально: ${session.unavailable_count}`
    : "";
  return `Сессия #${session.id}\nСтатус: ${status}\nУчастники:\n1. ${participantText(session.participants[0])}\n2. ${participantText(session.participants[1])}\n\nНачало: ${moscowDateTime(session.started_at_ms)} МСК\nПоследняя активность: ${moscowDateTime(session.last_activity_at_ms)} МСК\nДлительность: ${elapsedText(Number(until) - Number(session.started_at_ms))}\n\nВложения: ${session.media_count}\nФото: ${session.photo_count} · видео: ${session.video_count} · кружки: ${session.video_note_count}\nСохранено локально: ${session.stored_count}${unavailable}${expiry}${recovered}`;
}

export function aggregateSourceStats(products, limit = 15) {
  const campaigns = new Map();
  for (const [product, productStore] of products) {
    if (!productStore) continue;
    for (const row of productStore.sourceStats(100)) {
      const current = campaigns.get(row.source) || { source: row.source, users: 0, products: new Set() };
      current.users += Number(row.users || 0);
      current.products.add(product);
      campaigns.set(row.source, current);
    }
  }
  return [...campaigns.values()]
    .sort((left, right) => right.users - left.users || left.source.localeCompare(right.source))
    .slice(0, limit)
    .map((row) => ({ source: row.source, users: row.users, products: row.products.size }));
}

export function aggregateCampaignPerformance(products, limit = 15) {
  const campaigns = new Map();
  for (const [product, productStore] of products) {
    if (!productStore) continue;
    const rows = productStore.sourcePerformanceStats?.(100) || productStore.sourceStats(100);
    for (const row of rows) {
      const current = campaigns.get(row.source) || {
        source: row.source,
        users: 0,
        activeUsers: 0,
        actions: 0,
        products: new Set()
      };
      current.users += Number(row.users || 0);
      current.activeUsers += Number(row.active_users || 0);
      current.actions += Number(row.actions || 0);
      current.products.add(product);
      campaigns.set(row.source, current);
    }
  }
  return [...campaigns.values()]
    .sort((left, right) => right.users - left.users
      || right.activeUsers - left.activeUsers
      || right.actions - left.actions
      || left.source.localeCompare(right.source))
    .slice(0, limit)
    .map((row) => ({
      source: row.source,
      users: row.users,
      activeUsers: row.activeUsers,
      actions: row.actions,
      products: row.products.size
    }));
}

export function createAdminBot(token, dbPath, adminIds, options = {}) {
  const store = new Store(dbPath, { sessionArchiveRoot: options.sessionArchiveRoot });
  const englishStore = options.englishDbPath ? new LanguageStore(options.englishDbPath) : null;
  const focusStore = options.focusDbPath ? new FocusStore(options.focusDbPath) : null;
  const gameStore = options.gameDbPath ? new GameStore(options.gameDbPath) : null;
  const budgetStore = options.budgetDbPath ? new BudgetStore(options.budgetDbPath) : null;
  const hubStore = options.hubDbPath ? new HubStore(options.hubDbPath) : null;
  const taskStore = options.taskDbPath ? new TaskStore(options.taskDbPath) : null;
  const quizStore = options.quizDbPath ? new EngagementStore(options.quizDbPath) : null;
  const partyStore = options.partyDbPath ? new EngagementStore(options.partyDbPath) : null;
  const admins = parseAdmins(adminIds);
  const bot = new Bot(token);
  const healthPath = path.resolve(options.healthPath || "./data/health.json");
  const reportStatePath = path.resolve(options.reportStatePath || "./data/admin-report-state.json");
  const reportHour = Number.isInteger(options.reportHour) ? options.reportHour : 10;
  let reportTimer = null;
  bot.closeStore = () => store.close();

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
    .text("Tectra Quiz", "admin_product:quiz")
    .text("Tectra Party", "admin_product:party")
    .row()
    .text("TerraTectra Hub", "admin_product:hub");

  const anonProductKeyboard = new InlineKeyboard()
    .text("💬 Активные сессии", "anon_sessions:0")
    .row()
    .text("🗂 Медиа за 7 дней", "anon_retained:0")
    .row()
    .text("← Все боты", "admin_products");

  function networkOverviewText() {
    const chat = store.stats();
    const english = englishStore?.stats();
    const focus = focusStore?.stats();
    const game = gameStore?.stats();
    const budget = budgetStore?.stats();
    const hub = hubStore?.stats();
    const tasks = taskStore?.stats();
    const quiz = quizStore?.stats();
    const party = partyStore?.stats();
    const productStats = [chat, english, focus, game, budget, hub, tasks, quiz, party].filter(Boolean);
    const registrations = productStats.reduce((sum, item) => sum + (item.users || 0), 0);
    const activeNow = (chat.chatting || 0) + (english?.chatting || 0) + (game?.chatting || 0)
      + (focus?.active || 0) + (tasks?.active || 0);
    const usefulActions = (focus?.completed || 0) + (budget?.entries || 0) + (tasks?.done || 0)
      + (hub?.opens || 0) + (quiz?.actions || 0) + (party?.actions || 0);
    const reports = (chat.reports || 0) + (english?.reports || 0) + (game?.reports || 0);

    return `TerraTectra Admin Hub\n\nПродуктов: ${productStats.length}\nРегистраций в продуктах: ${registrations}\nАктивно сейчас: ${activeNow}\nПолезных действий: ${usefulActions}\n\nНовых лидов: ${hub?.pendingLeads || 0}\nНовых идей: ${hub?.pendingSuggestions || 0}\nНовых жалоб: ${reports}`;
  }

  function productStatsText(product) {
    if (product === "anon") {
      const activeSessions = store.listActiveChatSessions({ limit: 1 }).total;
      const retainedSessions = store.listRetainedChatSessions({ limit: 1 }).total;
      return `Анонимный чат\n\n${statsText(store.stats())}\nСессий в журнале: ${activeSessions}\nМедиасессий за 7 дней: ${retainedSessions}\n\n${pairGrowthText("За 7 дней", store.growthStats())}`;
    }
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
      const discovery = hubStore.openSourceStats(5).map((row) => `${row.source}: ${row.opens} (${row.users} чел.)`).join("\n");
      return `TerraTectra Bots\n\nПользователей: ${current.users}\nПереходов к ботам: ${current.opens}\nИзбранных: ${current.favorites}\nЛидов: ${current.leads}\nНовых лидов: ${current.pendingLeads}\nПредложений: ${current.suggestions}\nНовых идей: ${current.pendingSuggestions}\n\nЗа 7 дней\nНовые: ${growth.new7}\nПереходы к ботам: ${growth.opens7}\nЛиды: ${growth.leads7}\nПредложения: ${growth.suggestions7}\n\nОткуда открывают ботов\n${discovery || "данных пока нет"}`;
    }
    if ((product === "quiz" && quizStore) || (product === "party" && partyStore)) {
      const productStore = product === "quiz" ? quizStore : partyStore;
      const name = product === "quiz" ? "Tectra Quiz" : "Tectra Party";
      const current = productStore.stats();
      const growth = productStore.growthStats();
      return `${name}\n\nПользователей: ${current.users}\nДействий: ${current.actions}\nБаллов: ${current.score}\n\nЗа 7 дней\nНовые: ${growth.new7}\nПо приглашениям: ${growth.referred}\nДействий: ${growth.actions7}\nАктивных пользователей: ${growth.active7}`;
    }
    return "Этот продукт пока не подключён к админ-хабу.";
  }

  function healthText() {
    try {
      const health = JSON.parse(fs.readFileSync(healthPath, "utf8"));
      const updated = health.updated_at ? new Date(health.updated_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : "нет данных";
      const statuses = {
        running: "работает",
        starting: "запускается",
        conflict: "остановлена: обнаружена вторая система polling",
        failed: "остановлена из-за ошибки",
        stopped: "остановлена"
      };
      const detail = health.error ? `\nПричина: ${health.error}` : "";
      return `Состояние системы\n\nСтатус: ${statuses[health.status] || health.status}\nЗапущено ботов: ${health.bots ?? "нет данных"}\nПоследний сигнал: ${updated} МСК${detail}`;
    } catch {
      return "Состояние системы недоступно: файл health.json ещё не создан.";
    }
  }

  function moscowTimeParts(date = new Date()) {
    const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date).map((part) => [part.type, part.value]));
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      hour: Number(values.hour),
      minute: Number(values.minute)
    };
  }

  function dailyReportText() {
    const products = [
      ["Анонимный чат", store],
      ["English Talk Match", englishStore],
      ["Focus Sprint", focusStore],
      ["Game Mate", gameStore],
      ["Карманный бюджет", budgetStore],
      ["TerraTectra Hub", hubStore],
      ["Task Pulse", taskStore],
      ["Tectra Quiz", quizStore],
      ["Tectra Party", partyStore]
    ].filter(([, productStore]) => productStore);
    const growth = products.map(([name, productStore]) => [name, productStore.growthStats()]);
    const newToday = growth.reduce((sum, [, item]) => sum + (item.newToday || 0), 0);
    const new7 = growth.reduce((sum, [, item]) => sum + (item.new7 || 0), 0);
    const referrals = growth.reduce((sum, [, item]) => sum + (item.referred || 0), 0);
    const actions7 = growth.reduce((sum, [, item]) => sum
      + (item.matches7 || 0)
      + (item.completed7 || 0)
      + (item.entries7 || 0)
      + (item.done7 || 0)
      + (item.opens7 || 0)
      + (item.actions7 || 0), 0);
    const productLines = growth
      .sort((left, right) => (right[1].new7 || 0) - (left[1].new7 || 0))
      .map(([name, item]) => `${name}: +${item.new7 || 0}`)
      .join("\n");
    const sourceLines = products.flatMap(([name, productStore]) => productStore.sourceStats(1)
      .map((row) => `${name}: ${row.source} (${row.users})`));
    const hub = hubStore?.stats();
    const date = moscowTimeParts().date.split("-").reverse().join(".");

    return `Ежедневный отчёт TerraTectra • ${date}\n\nНовых регистраций сегодня: ${newToday}\nРегистраций за 7 дней: ${new7}\nПо приглашениям: ${referrals}\nПолезных действий за 7 дней: ${actions7}\n\nРост по продуктам за 7 дней\n${productLines}\n\nИсточники-лидеры\n${sourceLines.length ? sourceLines.join("\n") : "Данных пока нет"}\n\nТребуют внимания\nЛиды: ${hub?.pendingLeads || 0}\nИдеи: ${hub?.pendingSuggestions || 0}`;
  }

  function readLastReportDate() {
    try {
      return JSON.parse(fs.readFileSync(reportStatePath, "utf8")).lastDate || null;
    } catch {
      return null;
    }
  }

  function saveLastReportDate(date) {
    fs.mkdirSync(path.dirname(reportStatePath), { recursive: true });
    const temporary = `${reportStatePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ lastDate: date }, null, 2));
    fs.renameSync(temporary, reportStatePath);
  }

  async function sendDailyReport() {
    const message = dailyReportText();
    await Promise.all([...admins].map((adminId) => bot.api.sendMessage(adminId, message, { reply_markup: adminKeyboard })));
  }

  bot.startDailyReportScheduler = () => {
    if (reportTimer) return;
    reportTimer = setInterval(async () => {
      const now = moscowTimeParts();
      if (now.hour !== reportHour || now.minute !== 0 || readLastReportDate() === now.date) return;
      try {
        await sendDailyReport();
        saveLastReportDate(now.date);
      } catch (error) {
        console.error("Daily admin report error", safeErrorSummary(error));
      }
    }, 30_000);
  };

  bot.stopDailyReportScheduler = () => {
    if (reportTimer) clearInterval(reportTimer);
    reportTimer = null;
  };

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
    if (quizStore) {
      const quiz = quizStore.stats();
      parts.push(`Tectra Quiz\nПользователей: ${quiz.users}\nОтветов: ${quiz.actions}\nПравильных: ${quiz.score}`);
    }
    if (partyStore) {
      const party = partyStore.stats();
      parts.push(`Tectra Party\nПользователей: ${party.users}\nОткрыто карточек: ${party.actions}`);
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
    for (const [name, productStore] of [["Tectra Quiz", quizStore], ["Tectra Party", partyStore]]) {
      if (!productStore) continue;
      const growth = productStore.growthStats();
      parts.push(`${name}\nНовые сегодня: ${growth.newToday}\nНовые за 7 дней: ${growth.new7}\nПо приглашениям: ${growth.referred}\nДействий: ${growth.actions7}\nАктивных пользователей: ${growth.active7}`);
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
      ["Task Pulse", taskStore],
      ["Tectra Quiz", quizStore],
      ["Tectra Party", partyStore]
    ];
    const parts = products.filter(([, productStore]) => productStore).map(([name, productStore]) => {
      const rows = productStore.sourceStats(10);
      const lines = rows.length ? rows.map((row) => `${row.source}: ${row.users}`) : ["источников пока нет"];
      return `${name}\n${lines.join("\n")}`;
    });
    return `Источники пользователей\n\n${parts.join("\n\n")}`;
  }

  function campaignStatsText() {
    const products = [
      ["Анонимный чат", store],
      ["English Talk Match", englishStore],
      ["Focus Sprint", focusStore],
      ["Game Mate", gameStore],
      ["Карманный бюджет", budgetStore],
      ["TerraTectra Bots", hubStore],
      ["Task Pulse", taskStore],
      ["Tectra Quiz", quizStore],
      ["Tectra Party", partyStore]
    ];
    const rows = aggregateCampaignPerformance(products);
    const percent = (value, total) => total ? Math.round(value * 100 / total) : 0;
    const lines = rows.map((row, index) => `${index + 1}. ${row.source}\n${row.users} пришли · ${row.activeUsers} активны (${percent(row.activeUsers, row.users)}%) · ${row.actions} действий · продуктов: ${row.products}`);
    return `Кампании по всему семейству\n\n${lines.length ? lines.join("\n\n") : "Данных пока нет"}`;
  }

  function hubFunnelText() {
    if (!hubStore) return "Хаб не подключён.";
    const funnel = hubStore.funnelStats(30);
    const percent = (value, total) => total ? Math.round(value * 100 / total) : 0;
    const productNames = new Map(catalogProducts.map((product) => [product.id, product.name]));
    const productLines = hubStore.productPerformance(30).slice(0, 6).map((row, index) =>
      `${index + 1}. ${productNames.get(row.product_id) || row.product_id}: ${row.opens} переходов · ${row.users} чел. · ${row.favorites} в избранном`);
    return `Воронка TerraTectra Hub · 30 дней\n\nПользователи: ${funnel.users}\nОткрыли хотя бы один бот: ${funnel.engaged} (${percent(funnel.engaged, funnel.users)}%)\nДобавили в избранное: ${funnel.favorited} (${percent(funnel.favorited, funnel.engaged)}% от открывших)\nОставили заявку: ${funnel.leads} (${percent(funnel.leads, funnel.users)}%)\nВсего переходов: ${funnel.opens}\n\nИнтерес к продуктам\n${productLines.length ? productLines.join("\n") : "Данных пока нет"}`;
  }

  function channelStatusText() {
    const channels = options.channelStatusProvider?.() || [];
    if (!channels.length) return "Контентные каналы пока не настроены.";
    const lines = channels.map((channel) => {
      const state = channel.enabled ? "включён" : "подготовлен";
      const last = channel.lastPublishedAt
        ? new Date(channel.lastPublishedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
        : "публикаций ещё не было";
      const promotion = channel.promotionEvery ? ` · переход: каждый ${channel.promotionEvery}-й пост` : "";
      return `${channel.title}\n${state} · ${channel.schedule} МСК · в очереди: ${channel.queued}${promotion}\nОпубликовано: ${channel.sent} · последнее: ${last}`;
    });
    return `Контентная сеть TerraTectra\n\n${lines.join("\n\n")}`;
  }

  function requirePrivateSessionArchive(ctx) {
    return ctx.chat?.type === "private";
  }

  function sessionListKeyboard(result, kind, page) {
    const keyboard = new InlineKeyboard();
    for (const session of result.items) {
      const media = Number(session.media_count || 0);
      const marker = session.status === "active" ? "🟢" : "🗂";
      keyboard.text(`${marker} #${session.id} · ${media} медиа`, `anon_session:${session.id}:${kind}:${page}`).row();
    }
    if (page > 0) keyboard.text("← Назад", `${kind === "a" ? "anon_sessions" : "anon_retained"}:${page - 1}`);
    if ((page + 1) * SESSION_PAGE_SIZE < result.total) {
      keyboard.text("Дальше →", `${kind === "a" ? "anon_sessions" : "anon_retained"}:${page + 1}`);
    }
    if (page > 0 || (page + 1) * SESSION_PAGE_SIZE < result.total) keyboard.row();
    keyboard.text("← Анонимный чат", "admin_product:anon");
    return keyboard;
  }

  async function showSessionList(ctx, kind, requestedPage = 0, edit = false) {
    if (!requirePrivateSessionArchive(ctx)) {
      const message = "Журнал сессий доступен только в личном чате с админ-ботом.";
      await ctx.reply(message);
      return;
    }
    store.purgeExpiredChatSessions();
    const page = Math.max(0, Number(requestedPage) || 0);
    const options = { limit: SESSION_PAGE_SIZE, offset: page * SESSION_PAGE_SIZE };
    const result = kind === "a"
      ? store.listActiveChatSessions(options)
      : store.listRetainedChatSessions(options);
    const title = kind === "a" ? "Активные сессии анонимного чата" : "Медиасессии: активные и завершённые за 7 дней";
    const lines = result.items.map((session, index) => {
      const number = page * SESSION_PAGE_SIZE + index + 1;
      const time = session.status === "active" ? session.last_activity_at_ms : session.ended_at_ms;
      return `${number}. #${session.id} · ${session.status === "active" ? "активна" : "завершена"} · ${session.media_count} медиа\n${moscowDateTime(time)} МСК`;
    });
    const text = `${title}\nВсего: ${result.total}\n\n${lines.length ? lines.join("\n\n") : "Сессий нет."}`;
    const replyMarkup = sessionListKeyboard(result, kind, page);
    if (edit) await ctx.editMessageText(text, { reply_markup: replyMarkup });
    else await ctx.reply(text, { reply_markup: replyMarkup });
  }

  function sessionDetailKeyboard(session, listKind, page) {
    const keyboard = new InlineKeyboard();
    if (Number(session.media_count) > 0) keyboard.text("📎 Открыть вложения", `anon_attachment:${session.id}:0`).row();
    keyboard.text("← К списку", `${listKind === "a" ? "anon_sessions" : "anon_retained"}:${page}`);
    return keyboard;
  }

  function mediaNavigationKeyboard(sessionId, offset, total) {
    const keyboard = new InlineKeyboard();
    if (offset > 0) keyboard.text("← Предыдущее", `anon_attachment:${sessionId}:${offset - 1}`);
    if (offset + 1 < total) keyboard.text("Следующее →", `anon_attachment:${sessionId}:${offset + 1}`);
    if (offset > 0 || offset + 1 < total) keyboard.row();
    keyboard.text("Сессия", `anon_session:${sessionId}:m:0`);
    return keyboard;
  }

  async function sendLocalMedia(ctx, media, input, caption, replyMarkup) {
    const common = { protect_content: true, reply_markup: replyMarkup };
    if (media.kind === "photo") {
      await ctx.api.sendPhoto(ctx.chat.id, input, { ...common, caption });
    } else if (media.kind === "video") {
      await ctx.api.sendVideo(ctx.chat.id, input, { ...common, caption });
    } else {
      await ctx.reply(caption);
      await ctx.api.sendVideoNote(ctx.chat.id, input, common);
    }
  }

  async function sendSessionMedia(ctx, sessionId, requestedOffset) {
    if (!requirePrivateSessionArchive(ctx)) {
      await ctx.answerCallbackQuery({ text: "Архив доступен только в личном чате.", show_alert: true });
      return;
    }
    store.purgeExpiredChatSessions();
    const offset = Math.max(0, Number(requestedOffset) || 0);
    const result = store.listChatSessionMedia(sessionId, { limit: 1, offset });
    const media = result.items[0];
    if (!media) {
      await ctx.answerCallbackQuery({ text: "Вложение удалено или сессия уже истекла.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery(`Вложение ${offset + 1} из ${result.total}`);
    const resolved = store.resolveChatSessionMedia(media.id);
    const kind = media.kind === "photo" ? "фото" : media.kind === "video" ? "видео" : "кружок";
    const caption = `Сессия #${sessionId} · ${kind} ${offset + 1}/${result.total}\nОтправитель: ID ${media.sender_id}\n${moscowDateTime(media.created_at_ms)} МСК`;
    const replyMarkup = mediaNavigationKeyboard(sessionId, offset, result.total);

    if (resolved?.absolutePath) {
      try {
        await sendLocalMedia(ctx, media, new InputFile(resolved.absolutePath), caption, replyMarkup);
        return;
      } catch {
        console.error(`Admin local media delivery failed for media ${media.id}`);
      }
    }

    if (options.sourceMediaSender) {
      try {
        await options.sourceMediaSender(ctx.chat.id, media, caption);
        await ctx.reply("Файл больше локального лимита или локальная копия недоступна. Он отправлен основным анон-ботом.", { reply_markup: replyMarkup });
        return;
      } catch {
        console.error(`Admin source media delivery failed for media ${media.id}`);
      }
    }
    await ctx.reply("Это вложение сейчас недоступно для просмотра. Метаданные сессии сохранены.", { reply_markup: replyMarkup });
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
  bot.callbackQuery("admin_products", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Выберите продукт:", { reply_markup: productKeyboard });
  });
  bot.callbackQuery("admin_product:anon", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(productStatsText("anon"), { reply_markup: anonProductKeyboard });
  });
  bot.callbackQuery(/^admin_product:(english|focus|game|budget|tasks|quiz|party|hub)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(productStatsText(ctx.match[1]), { reply_markup: productKeyboard });
  });
  bot.command("sessions", (ctx) => showSessionList(ctx, "a"));
  bot.command("media_sessions", (ctx) => showSessionList(ctx, "m"));
  bot.callbackQuery(/^anon_sessions:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showSessionList(ctx, "a", Number(ctx.match[1]), true);
  });
  bot.callbackQuery(/^anon_retained:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showSessionList(ctx, "m", Number(ctx.match[1]), true);
  });
  bot.callbackQuery(/^anon_session:(\d+):(a|m):(\d+)$/, async (ctx) => {
    if (!requirePrivateSessionArchive(ctx)) {
      await ctx.answerCallbackQuery({ text: "Журнал доступен только в личном чате.", show_alert: true });
      return;
    }
    store.purgeExpiredChatSessions();
    const sessionId = Number(ctx.match[1]);
    const session = store.getChatSession(sessionId);
    if (!session) {
      await ctx.answerCallbackQuery({ text: "Сессия уже удалена.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(chatSessionText(session), {
      reply_markup: sessionDetailKeyboard(session, ctx.match[2], Number(ctx.match[3]))
    });
  });
  bot.callbackQuery(/^anon_attachment:(\d+):(\d+)$/, (ctx) => sendSessionMedia(ctx, Number(ctx.match[1]), Number(ctx.match[2])));
  bot.command("health", (ctx) => ctx.reply(healthText(), { reply_markup: adminKeyboard }));
  bot.hears("💚 Состояние", (ctx) => ctx.reply(healthText(), { reply_markup: adminKeyboard }));
  bot.command("daily", (ctx) => ctx.reply(dailyReportText(), { reply_markup: adminKeyboard }));
  bot.command("stats", (ctx) => ctx.reply(allStatsText(), { reply_markup: adminKeyboard }));
  bot.hears("📊 Статистика", (ctx) => ctx.reply(allStatsText(), { reply_markup: adminKeyboard }));
  bot.command("growth", (ctx) => ctx.reply(allGrowthText(), { reply_markup: adminKeyboard }));
  bot.hears("📈 Рост", (ctx) => ctx.reply(allGrowthText(), { reply_markup: adminKeyboard }));
  bot.command("sources", (ctx) => ctx.reply(allSourcesText(), { reply_markup: adminKeyboard }));
  bot.hears("🧭 Источники", (ctx) => ctx.reply(allSourcesText(), { reply_markup: adminKeyboard }));
  bot.command("campaigns", (ctx) => ctx.reply(campaignStatsText(), { reply_markup: adminKeyboard }));
  bot.hears("📣 Кампании", (ctx) => ctx.reply(campaignStatsText(), { reply_markup: adminKeyboard }));
  bot.command("funnel", (ctx) => ctx.reply(hubFunnelText(), { reply_markup: adminKeyboard }));
  bot.hears("📊 Воронка", (ctx) => ctx.reply(hubFunnelText(), { reply_markup: adminKeyboard }));
  bot.command("channels", (ctx) => ctx.reply(channelStatusText(), { reply_markup: adminKeyboard }));
  bot.hears("📢 Каналы", (ctx) => ctx.reply(channelStatusText(), { reply_markup: adminKeyboard }));

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

  bot.catch((error) => console.error("Admin bot error", safeErrorSummary(error)));
  return bot;
}
