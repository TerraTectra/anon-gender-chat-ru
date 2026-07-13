import { Bot, InlineKeyboard, InputFile, Keyboard, session } from "grammy";
import { BudgetStore } from "./budget-store.js";
import { catalogLabel, showCatalog } from "./catalog.js";
import { parseStartSource } from "./tracking.js";
import { inviteKeyboard } from "./referrals.js";

const labels = {
  expense: "➖ Расход",
  income: "➕ Доход",
  today: "📅 Сегодня",
  month: "📊 Месяц",
  undo: "↩ Отменить запись",
  export: "📤 Экспорт",
  limit: "🎯 Лимит месяца",
  invite: "🎁 Пригласить",
  catalog: catalogLabel
};

const menu = new Keyboard()
  .text(labels.expense)
  .text(labels.income)
  .row()
  .text(labels.today)
  .text(labels.month)
  .row()
  .text(labels.undo)
  .text(labels.export)
  .row()
  .text(labels.limit)
  .row()
  .text(labels.invite)
  .row()
  .text(labels.catalog)
  .resized();

const expenseCategories = new InlineKeyboard()
  .text("Еда", "budget_category:food")
  .text("Транспорт", "budget_category:transport")
  .row()
  .text("Дом", "budget_category:home")
  .text("Здоровье", "budget_category:health")
  .row()
  .text("Развлечения", "budget_category:fun")
  .text("Работа", "budget_category:work")
  .row()
  .text("Другое", "budget_category:other");

const incomeCategories = new InlineKeyboard()
  .text("Зарплата", "budget_category:salary")
  .text("Фриланс", "budget_category:freelance")
  .row()
  .text("Подарок", "budget_category:gift")
  .text("Другое", "budget_category:other");

const categoryNames = {
  food: "Еда",
  transport: "Транспорт",
  home: "Дом",
  health: "Здоровье",
  fun: "Развлечения",
  work: "Работа",
  other: "Другое",
  salary: "Зарплата",
  freelance: "Фриланс",
  gift: "Подарок"
};

const money = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function formatMoney(cents) {
  return `${money.format(Number(cents) / 100)} ₽`;
}

function parseEntry(text) {
  const match = text.trim().match(/^(\d+(?:[.,]\d{1,2})?)\s+(.{2,200})$/u);
  if (!match) return null;
  const amountCents = Math.round(Number(match[1].replace(",", ".")) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 100_000_000_00) return null;
  return { amountCents, note: match[2].trim().replace(/\s+/g, " ") };
}

function parseLimit(text) {
  const match = text.trim().match(/^(\d+(?:[.,]\d{1,2})?)$/);
  if (!match) return null;
  const amountCents = Math.round(Number(match[1].replace(",", ".")) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents < 10_000 || amountCents > 100_000_000_00) return null;
  return amountCents;
}

function csvEscape(value) {
  const string = String(value ?? "");
  return `"${string.replaceAll('"', '""')}"`;
}

export function createBudgetBot(token, dbPath) {
  const store = new BudgetStore(dbPath);
  const bot = new Bot(token);
  bot.use(session({ initial: () => ({ entryType: null, pendingEntry: null, waitingLimit: false }) }));

  bot.use(async (ctx, next) => {
    if (ctx.from && store.isBanned(ctx.from.id)) {
      if (ctx.message?.text === "/start") await ctx.reply("Доступ к боту ограничен администратором.");
      return;
    }
    await next();
  });

  async function showMenu(ctx) {
    store.upsertUser(ctx.from.id, ctx.from.username);
    await ctx.reply("Добавьте доход или расход либо откройте сводку.", { reply_markup: menu });
  }

  async function beginEntry(ctx, type) {
    store.upsertUser(ctx.from.id, ctx.from.username);
    ctx.session.entryType = type;
    ctx.session.pendingEntry = null;
    ctx.session.waitingLimit = false;
    const example = type === "expense" ? "350 кофе" : "5000 заказ";
    await ctx.reply(`Введите сумму и комментарий, например: ${example}`);
  }

  async function showSummary(ctx, period) {
    store.upsertUser(ctx.from.id, ctx.from.username);
    const summary = store.summary(ctx.from.id, period);
    const title = period === "today" ? "Сегодня" : "Этот месяц";
    const categoryLines = summary.categories.slice(0, 5)
      .map((row) => `${categoryNames[row.category] ?? row.category}: ${formatMoney(row.amount)}`);
    const details = categoryLines.length ? `\n\nРасходы по категориям:\n${categoryLines.join("\n")}` : "";
    const limit = period === "month" ? store.monthlyLimit(ctx.from.id) : null;
    const limitText = limit
      ? `\nЛимит: ${formatMoney(limit)}\nОсталось: ${formatMoney(Math.max(0, limit - summary.expense))}`
      : "";
    await ctx.reply(`${title}\nДоходы: ${formatMoney(summary.income)}\nРасходы: ${formatMoney(summary.expense)}\nБаланс: ${formatMoney(summary.income - summary.expense)}\nЗаписей: ${summary.entries}${limitText}${details}`, { reply_markup: menu });
  }

  async function beginLimit(ctx, raw = "") {
    store.upsertUser(ctx.from.id, ctx.from.username);
    if (/^(?:0|off|нет|отключить)$/i.test(raw.trim())) {
      store.clearMonthlyLimit(ctx.from.id);
      ctx.session.waitingLimit = false;
      await ctx.reply("Месячный лимит отключён.", { reply_markup: menu });
      return;
    }
    const parsed = parseLimit(raw);
    if (parsed) {
      store.setMonthlyLimit(ctx.from.id, parsed);
      ctx.session.waitingLimit = false;
      await ctx.reply(`Месячный лимит установлен: ${formatMoney(parsed)}.`, { reply_markup: menu });
      return;
    }
    ctx.session.entryType = null;
    ctx.session.pendingEntry = null;
    ctx.session.waitingLimit = true;
    const current = store.monthlyLimit(ctx.from.id);
    const currentText = current ? ` Сейчас установлен ${formatMoney(current)}.` : "";
    await ctx.reply(`Введите месячный лимит расходов одним числом, например: 50000.${currentText}\nЧтобы отключить лимит, отправьте 0.`);
  }

  async function undoEntry(ctx) {
    store.upsertUser(ctx.from.id, ctx.from.username);
    const entry = store.undoLast(ctx.from.id);
    if (!entry) {
      await ctx.reply("Записей пока нет.", { reply_markup: menu });
      return;
    }
    await ctx.reply(`Удалена запись: ${entry.type === "expense" ? "расход" : "доход"} ${formatMoney(entry.amount_cents)}, ${entry.note}.`, { reply_markup: menu });
  }

  async function exportEntries(ctx) {
    store.upsertUser(ctx.from.id, ctx.from.username);
    const rows = store.entriesForExport(ctx.from.id);
    if (!rows.length) {
      await ctx.reply("Для экспорта пока нет записей.", { reply_markup: menu });
      return;
    }
    const lines = ["type,amount_rub,category,note,date"];
    for (const row of rows) {
      lines.push([
        row.type,
        (row.amount_cents / 100).toFixed(2),
        categoryNames[row.category] ?? row.category,
        row.note,
        new Date(row.created_at * 1000).toISOString()
      ].map(csvEscape).join(","));
    }
    const file = new InputFile(Buffer.from(`\uFEFF${lines.join("\n")}`, "utf8"), "budget.csv");
    await ctx.replyWithDocument(file, { caption: "Экспорт доходов и расходов в CSV." });
  }

  async function showInvite(ctx) {
    store.upsertUser(ctx.from.id, ctx.from.username);
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.from.id}`;
    await ctx.reply(`Ваша ссылка:\n${link}\n\nПриглашено: ${store.invitedCount(ctx.from.id)}.`, { reply_markup: inviteKeyboard(link, "Простой учёт доходов и расходов прямо в Telegram") });
  }

  bot.command("start", async (ctx) => {
    const source = parseStartSource(ctx.match, ctx.from.id);
    store.upsertUser(ctx.from.id, ctx.from.username, source);
    await showMenu(ctx);
  });

  bot.command("expense", async (ctx) => {
    store.upsertUser(ctx.from.id, ctx.from.username);
    const parsed = parseEntry(ctx.match ?? "");
    if (!parsed) return beginEntry(ctx, "expense");
    ctx.session.pendingEntry = { type: "expense", ...parsed };
    await ctx.reply("Выберите категорию расхода.", { reply_markup: expenseCategories });
  });

  bot.command("income", async (ctx) => {
    store.upsertUser(ctx.from.id, ctx.from.username);
    const parsed = parseEntry(ctx.match ?? "");
    if (!parsed) return beginEntry(ctx, "income");
    ctx.session.pendingEntry = { type: "income", ...parsed };
    await ctx.reply("Выберите категорию дохода.", { reply_markup: incomeCategories });
  });

  bot.command("today", (ctx) => showSummary(ctx, "today"));
  bot.command("month", (ctx) => showSummary(ctx, "month"));
  bot.command("undo", undoEntry);
  bot.command("export", exportEntries);
  bot.command("limit", (ctx) => beginLimit(ctx, ctx.match ?? ""));
  bot.command("invite", showInvite);
  bot.command("privacy", (ctx) => ctx.reply("Записи хранятся локально в базе бота и не отправляются банкам, рекламным системам или сторонним сервисам. Не вводите номера карт, пароли и другие секреты.", { reply_markup: menu }));
  bot.command("catalog", showCatalog);

  bot.hears(labels.expense, (ctx) => beginEntry(ctx, "expense"));
  bot.hears(labels.income, (ctx) => beginEntry(ctx, "income"));
  bot.hears(labels.today, (ctx) => showSummary(ctx, "today"));
  bot.hears(labels.month, (ctx) => showSummary(ctx, "month"));
  bot.hears(labels.undo, undoEntry);
  bot.hears(labels.export, exportEntries);
  bot.hears(labels.limit, beginLimit);
  bot.hears(labels.invite, showInvite);
  bot.hears(labels.catalog, showCatalog);

  bot.callbackQuery(/^budget_category:(\w+)$/, async (ctx) => {
    const pending = ctx.session.pendingEntry;
    if (!pending) {
      await ctx.answerCallbackQuery("Запись уже обработана");
      return;
    }
    store.upsertUser(ctx.from.id, ctx.from.username);
    const category = ctx.match[1];
    const entry = store.addEntry(ctx.from.id, pending.type, pending.amountCents, category, pending.note);
    ctx.session.pendingEntry = null;
    ctx.session.entryType = null;
    await ctx.answerCallbackQuery("Сохранено");
    await ctx.editMessageText(`${entry.type === "expense" ? "Расход" : "Доход"}: ${formatMoney(entry.amount_cents)}\n${categoryNames[entry.category] ?? entry.category}: ${entry.note}`);
    let notice = "Запись сохранена.";
    if (entry.type === "expense") {
      const limit = store.monthlyLimit(ctx.from.id);
      if (limit) {
        const spent = store.summary(ctx.from.id, "month").expense;
        const percent = Math.round((spent / limit) * 100);
        if (spent >= limit) notice += `\n\nЛимит месяца исчерпан: ${formatMoney(spent)} из ${formatMoney(limit)}.`;
        else if (percent >= 80) notice += `\n\nИспользовано ${percent}% месячного лимита.`;
      }
    }
    await ctx.reply(notice, { reply_markup: menu });
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.session.waitingLimit) {
      if (/^(?:0|off|нет|отключить)$/i.test(ctx.message.text.trim())) {
        store.clearMonthlyLimit(ctx.from.id);
        ctx.session.waitingLimit = false;
        await ctx.reply("Месячный лимит отключён.", { reply_markup: menu });
        return;
      }
      const limit = parseLimit(ctx.message.text);
      if (!limit) return ctx.reply("Введите сумму от 100 до 100 000 000 ₽ одним числом.");
      store.setMonthlyLimit(ctx.from.id, limit);
      ctx.session.waitingLimit = false;
      await ctx.reply(`Месячный лимит установлен: ${formatMoney(limit)}.`, { reply_markup: menu });
      return;
    }
    if (!ctx.session.entryType) {
      await showMenu(ctx);
      return;
    }
    const parsed = parseEntry(ctx.message.text);
    if (!parsed) {
      await ctx.reply("Формат: сумма и комментарий. Например: 350 кофе");
      return;
    }
    ctx.session.pendingEntry = { type: ctx.session.entryType, ...parsed };
    const keyboard = ctx.session.entryType === "expense" ? expenseCategories : incomeCategories;
    await ctx.reply("Выберите категорию.", { reply_markup: keyboard });
  });

  bot.catch((error) => console.error("Budget bot error", error.error));
  return bot;
}

export { formatMoney, parseEntry, parseLimit };
