import { Bot, Keyboard, session } from "grammy";
import { FocusStore } from "./focus-store.js";
import { catalogLabel, showCatalog } from "./catalog.js";
import { parseStartSource } from "./tracking.js";
import { inviteKeyboard } from "./referrals.js";

const labels = {
  short: "⏱ 25 минут",
  medium: "🎯 50 минут",
  deep: "🧠 90 минут",
  status: "📍 Текущая сессия",
  cancel: "⛔ Остановить",
  stats: "📊 Статистика",
  invite: "🎁 Пригласить",
  catalog: catalogLabel
};

const menu = new Keyboard()
  .text(labels.short)
  .text(labels.medium)
  .text(labels.deep)
  .row()
  .text(labels.status)
  .text(labels.cancel)
  .row()
  .text(labels.stats)
  .text(labels.invite)
  .row()
  .text(labels.catalog)
  .resized();

function formatRemaining(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} мин.`;
}

export function createFocusBot(token, dbPath) {
  const store = new FocusStore(dbPath);
  const bot = new Bot(token);
  let scheduler = null;
  bot.use(session({ initial: () => ({ pendingDuration: null }) }));

  bot.use(async (ctx, next) => {
    if (ctx.from && store.isBanned(ctx.from.id)) {
      if (ctx.message?.text === "/start") await ctx.reply("Доступ к боту ограничен администратором.");
      return;
    }
    await next();
  });

  async function showMenu(ctx) {
    store.upsertUser(ctx.from.id, ctx.from.username);
    const active = store.activeSession(ctx.from.id);
    const text = active
      ? `Сессия уже идёт: «${active.goal}». Осталось ${formatRemaining(active.ends_at - Math.floor(Date.now() / 1000))}`
      : "Выберите длительность фокус-сессии.";
    await ctx.reply(text, { reply_markup: menu });
  }

  async function prepareSession(ctx, duration) {
    store.upsertUser(ctx.from.id, ctx.from.username);
    ctx.session.pendingDuration = duration;
    await ctx.reply(`Напишите одну конкретную задачу на ближайшие ${duration} минут.`);
  }

  async function showStatus(ctx) {
    const active = store.activeSession(ctx.from.id);
    if (!active) {
      await ctx.reply("Активной сессии нет.", { reply_markup: menu });
      return;
    }
    const remaining = active.ends_at - Math.floor(Date.now() / 1000);
    await ctx.reply(`Сейчас: «${active.goal}».\nОсталось ${formatRemaining(remaining)}`, { reply_markup: menu });
  }

  async function cancelSession(ctx) {
    ctx.session.pendingDuration = null;
    const cancelled = store.cancelSession(ctx.from.id);
    await ctx.reply(cancelled ? "Сессия остановлена." : "Активной сессии нет.", { reply_markup: menu });
  }

  async function showStats(ctx) {
    const stats = store.userStats(ctx.from.id);
    await ctx.reply(`Завершено сессий: ${stats.sessions}.\nСегодня: ${stats.today}.\nФокус-время: ${stats.minutes} мин.`, { reply_markup: menu });
  }

  async function showInvite(ctx) {
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.from.id}`;
    await ctx.reply(`Ваша ссылка:\n${link}\n\nПриглашено: ${store.invitedCount(ctx.from.id)}.`, { reply_markup: inviteKeyboard(link, "Фокус-сессии на 25, 50 и 90 минут прямо в Telegram") });
  }

  bot.command("start", async (ctx) => {
    const source = parseStartSource(ctx.match, ctx.from.id);
    store.upsertUser(ctx.from.id, ctx.from.username, source);
    await showMenu(ctx);
  });

  bot.command("focus", (ctx) => showMenu(ctx));
  bot.command("status", showStatus);
  bot.command("cancel", cancelSession);
  bot.command("stats", showStats);
  bot.command("invite", showInvite);
  bot.command("help", (ctx) => ctx.reply("Выберите длительность, сформулируйте одну задачу и не переключайтесь до сигнала. Таймер продолжит работать после перезапуска бота.", { reply_markup: menu }));
  bot.command("catalog", showCatalog);

  bot.hears(labels.short, (ctx) => prepareSession(ctx, 25));
  bot.hears(labels.medium, (ctx) => prepareSession(ctx, 50));
  bot.hears(labels.deep, (ctx) => prepareSession(ctx, 90));
  bot.hears(labels.status, showStatus);
  bot.hears(labels.cancel, cancelSession);
  bot.hears(labels.stats, showStats);
  bot.hears(labels.invite, showInvite);
  bot.hears(labels.catalog, showCatalog);

  bot.on("message:text", async (ctx) => {
    const duration = ctx.session.pendingDuration;
    if (!duration) {
      await showMenu(ctx);
      return;
    }
    const goal = ctx.message.text.trim().replace(/\s+/g, " ");
    if (goal.length < 3 || goal.length > 200) {
      await ctx.reply("Опишите задачу фразой от 3 до 200 символов.");
      return;
    }
    const active = store.startSession(ctx.from.id, goal, duration);
    ctx.session.pendingDuration = null;
    await ctx.reply(`Фокус начался: «${active.goal}».\nВернусь через ${duration} минут.`, { reply_markup: menu });
  });

  bot.startFocusScheduler = () => {
    if (scheduler) return;
    scheduler = setInterval(async () => {
      for (const due of store.dueSessions()) {
        if (!store.completeSession(due.id)) continue;
        await bot.api.sendMessage(due.user_id, `Сессия завершена.\n\nЗадача: «${due.goal}»\nФокус-время: ${due.duration_minutes} мин.`, { reply_markup: menu }).catch(() => {});
      }
    }, 10_000);
  };

  bot.stopFocusScheduler = () => {
    if (scheduler) clearInterval(scheduler);
    scheduler = null;
  };

  bot.catch((error) => console.error("Focus bot error", error.error));
  return bot;
}
