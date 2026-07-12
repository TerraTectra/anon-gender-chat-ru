import { Bot, InlineKeyboard, Keyboard, session } from "grammy";
import { catalogLabel, showCatalog } from "./catalog.js";
import { TaskStore } from "./task-store.js";
import { parseStartSource } from "./tracking.js";

const labels = {
  add: "➕ Новая задача",
  tasks: "📋 Мои задачи",
  stats: "📊 Статистика",
  invite: "🎁 Пригласить",
  catalog: catalogLabel
};

const menu = new Keyboard()
  .text(labels.add)
  .text(labels.tasks)
  .row()
  .text(labels.stats)
  .text(labels.invite)
  .row()
  .text(labels.catalog)
  .resized();

const timingKeyboard = new InlineKeyboard()
  .text("Через 15 минут", "task:when:900")
  .text("Через час", "task:when:3600")
  .row()
  .text("Через 3 часа", "task:when:10800")
  .text("Завтра в 9:00", "task:when:tomorrow")
  .row()
  .text("Отмена", "task:draft:cancel");

function tomorrowAtNine(now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function formatDue(timestamp) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow"
  }).format(new Date(timestamp * 1000));
}

export function createTaskBot(token, dbPath) {
  const store = new TaskStore(dbPath);
  const bot = new Bot(token);
  let scheduler = null;
  bot.use(session({ initial: () => ({ waitingTask: false, draftText: null }) }));

  bot.use(async (ctx, next) => {
    if (ctx.from && store.isBanned(ctx.from.id)) {
      if (ctx.message?.text === "/start") await ctx.reply("Доступ к боту ограничен администратором.");
      return;
    }
    await next();
  });

  async function showMenu(ctx) {
    store.upsertUser(ctx.from.id, ctx.from.username);
    const stats = store.userStats(ctx.from.id);
    await ctx.reply(`Task Pulse\n\nАктивных задач: ${stats.active}. Что сделаем?`, { reply_markup: menu });
  }

  async function beginTask(ctx) {
    ctx.session.waitingTask = true;
    ctx.session.draftText = null;
    await ctx.reply("Напишите задачу одним сообщением. Например: «Позвонить клиенту».");
  }

  async function showTasks(ctx) {
    const tasks = store.activeTasks(ctx.from.id);
    if (!tasks.length) return ctx.reply("Активных задач нет.", { reply_markup: menu });
    await ctx.reply(`Активные задачи: ${tasks.length}`, { reply_markup: menu });
    for (const task of tasks) {
      const keyboard = new InlineKeyboard()
        .text("Готово", `task:done:${task.id}`)
        .text("+10 минут", `task:snooze:${task.id}`)
        .text("Удалить", `task:cancel:${task.id}`);
      await ctx.reply(`#${task.id} ${task.text}\nНапоминание: ${formatDue(task.due_at)}`, { reply_markup: keyboard });
    }
  }

  bot.command("start", async (ctx) => {
    store.upsertUser(ctx.from.id, ctx.from.username, parseStartSource(ctx.match, ctx.from.id));
    await showMenu(ctx);
  });
  bot.command("add", beginTask);
  bot.command("tasks", showTasks);
  bot.command("stats", async (ctx) => {
    const stats = store.userStats(ctx.from.id);
    await ctx.reply(`Активных задач: ${stats.active}.\nВыполнено: ${stats.done}.`, { reply_markup: menu });
  });
  bot.command("invite", async (ctx) => {
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.from.id}`;
    await ctx.reply(`Ваша ссылка:\n${link}\n\nПриглашено: ${store.invitedCount(ctx.from.id)}.`, { reply_markup: menu });
  });
  bot.command("help", (ctx) => ctx.reply("Создайте задачу, выберите время напоминания, а после сигнала отметьте её выполненной или отложите на 10 минут.", { reply_markup: menu }));
  bot.command("catalog", showCatalog);

  bot.hears(labels.add, beginTask);
  bot.hears(labels.tasks, showTasks);
  bot.hears(labels.stats, async (ctx) => {
    const stats = store.userStats(ctx.from.id);
    await ctx.reply(`Активных задач: ${stats.active}.\nВыполнено: ${stats.done}.`, { reply_markup: menu });
  });
  bot.hears(labels.invite, async (ctx) => {
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.from.id}`;
    await ctx.reply(`Ваша ссылка:\n${link}\n\nПриглашено: ${store.invitedCount(ctx.from.id)}.`, { reply_markup: menu });
  });
  bot.hears(labels.catalog, showCatalog);

  bot.callbackQuery(/^task:when:(900|3600|10800|tomorrow)$/, async (ctx) => {
    if (!ctx.session.draftText) return ctx.answerCallbackQuery("Сначала напишите задачу");
    const dueAt = ctx.match[1] === "tomorrow"
      ? tomorrowAtNine()
      : Math.floor(Date.now() / 1000) + Number(ctx.match[1]);
    const task = store.addTask(ctx.from.id, ctx.session.draftText, dueAt);
    ctx.session.draftText = null;
    ctx.session.waitingTask = false;
    await ctx.answerCallbackQuery("Задача сохранена");
    await ctx.editMessageText(`Задача #${task.id} сохранена.\n\n${task.text}\nНапомню: ${formatDue(task.due_at)}`);
    await ctx.reply("Готово.", { reply_markup: menu });
  });

  bot.callbackQuery("task:draft:cancel", async (ctx) => {
    ctx.session.draftText = null;
    ctx.session.waitingTask = false;
    await ctx.answerCallbackQuery("Отменено");
    await ctx.editMessageText("Создание задачи отменено.");
  });

  bot.callbackQuery(/^task:done:(\d+)$/, async (ctx) => {
    const done = store.completeTask(Number(ctx.match[1]), ctx.from.id);
    await ctx.answerCallbackQuery(done ? "Выполнено" : "Задача уже закрыта");
    if (done) await ctx.editMessageText("Готово. Задача выполнена.");
  });

  bot.callbackQuery(/^task:snooze:(\d+)$/, async (ctx) => {
    const snoozed = store.snoozeTask(Number(ctx.match[1]), ctx.from.id, 600);
    await ctx.answerCallbackQuery(snoozed ? "Напомню через 10 минут" : "Задача уже закрыта");
    if (snoozed) await ctx.editMessageText("Задача отложена на 10 минут.");
  });

  bot.callbackQuery(/^task:cancel:(\d+)$/, async (ctx) => {
    const cancelled = store.cancelTask(Number(ctx.match[1]), ctx.from.id);
    await ctx.answerCallbackQuery(cancelled ? "Удалено" : "Задача уже закрыта");
    if (cancelled) await ctx.editMessageText("Задача удалена.");
  });

  bot.on("message:text", async (ctx) => {
    if (!ctx.session.waitingTask) return showMenu(ctx);
    const text = ctx.message.text.trim().replace(/\s+/g, " ");
    if (text.length < 3 || text.length > 300) return ctx.reply("Опишите задачу текстом от 3 до 300 символов.");
    ctx.session.waitingTask = false;
    ctx.session.draftText = text;
    await ctx.reply(`Когда напомнить о задаче «${text}»?`, { reply_markup: timingKeyboard });
  });

  bot.startTaskScheduler = () => {
    if (scheduler) return;
    scheduler = setInterval(async () => {
      for (const task of store.dueTasks()) {
        if (!store.markNotified(task.id)) continue;
        const keyboard = new InlineKeyboard()
          .text("Готово", `task:done:${task.id}`)
          .text("+10 минут", `task:snooze:${task.id}`);
        await bot.api.sendMessage(task.user_id, `Напоминание\n\n${task.text}`, { reply_markup: keyboard }).catch(() => {});
      }
    }, 10_000);
  };

  bot.stopTaskScheduler = () => {
    if (scheduler) clearInterval(scheduler);
    scheduler = null;
  };

  bot.catch((error) => console.error("Task bot error", error.error));
  return bot;
}
