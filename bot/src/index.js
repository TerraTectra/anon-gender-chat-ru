import "dotenv/config";
import { Bot, session } from "grammy";
import { Store } from "./store.js";
import {
  confirmReportKeyboard,
  filterGenderKeyboard,
  genderKeyboard,
  menuKeyboard
} from "./keyboards.js";

const token = process.env.BOT_TOKEN?.trim();
if (!token) throw new Error("BOT_TOKEN is not set in bot/.env");

const admins = new Set(
  (process.env.ADMIN_IDS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter(Number.isSafeInteger)
);
const store = new Store(process.env.DB_PATH || "./data/chat.db");
const bot = new Bot(token);

bot.use(session({ initial: () => ({ step: null, pendingReportId: null }) }));

const profileReady = (user) => Boolean(user?.gender && user?.age);
const displayGender = (value) => value === "male" ? "парень" : "девушка";

async function notifyPartner(ctx, partnerId, text) {
  if (!partnerId) return;
  await ctx.api.sendMessage(partnerId, text, { reply_markup: menuKeyboard }).catch(() => {});
}

async function startSearch(ctx, mode, filter = {}) {
  const user = store.getUser(ctx.from.id);
  if (!profileReady(user)) {
    ctx.session.step = "gender";
    await ctx.reply("Сначала создадим короткий профиль. Кто вы?", { reply_markup: genderKeyboard });
    return;
  }
  const result = store.enqueue(
    ctx.from.id,
    mode,
    filter.targetGender,
    filter.minAge,
    filter.maxAge
  );
  if (result.status === "limit") {
    await ctx.reply("Сегодня использованы все 50 фильтрованных совпадений. Случайный поиск остаётся без лимита.", { reply_markup: menuKeyboard });
    return;
  }
  if (result.status === "matched") {
    await ctx.reply("Собеседник найден. Можно писать сообщение.", { reply_markup: menuKeyboard });
    await ctx.api.sendMessage(result.partnerId, "Собеседник найден. Можно писать сообщение.", { reply_markup: menuKeyboard }).catch(() => {});
    return;
  }
  await ctx.reply("Ищу собеседника. Я напишу, как только появится подходящая пара.", { reply_markup: menuKeyboard });
}

bot.command("start", async (ctx) => {
  const source = ctx.match?.trim() || null;
  const user = store.upsertUser(ctx.from.id, ctx.from.username, source);
  if (!profileReady(user)) {
    ctx.session.step = "gender";
    await ctx.reply(
      "Добро пожаловать в анонимный чат 12+. Аккаунты собеседников скрыты, а пользователи 12–17 и 18+ никогда не смешиваются.\n\nКто вы?",
      { reply_markup: genderKeyboard }
    );
    return;
  }
  await ctx.reply("Готово. Выберите поиск.", { reply_markup: menuKeyboard });
});

bot.command("stats", async (ctx) => {
  if (!admins.has(ctx.from.id)) return;
  const stats = store.stats();
  await ctx.reply(`Пользователей: ${stats.users}\nИщут: ${stats.searching}\nАктивных чатов: ${stats.chatting}\nНовых жалоб: ${stats.reports}`);
});

bot.command("reports", async (ctx) => {
  if (!admins.has(ctx.from.id)) return;
  const reports = store.recentReports();
  const text = reports.length
    ? reports.map((r) => `#${r.id}: ${r.reporter_id} → ${r.reported_id} (${r.created_at})`).join("\n")
    : "Новых жалоб нет.";
  await ctx.reply(text);
});

bot.callbackQuery(/^profile_gender:(male|female)$/, async (ctx) => {
  store.setProfile(ctx.from.id, { gender: ctx.match[1], state: "onboarding" });
  ctx.session.step = "age";
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Введите возраст числом от 12 до 99.");
});

bot.callbackQuery(/^filter_gender:(male|female|any)$/, async (ctx) => {
  store.setProfile(ctx.from.id, { filter_gender: ctx.match[1] });
  ctx.session.step = "filter_age";
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Введите диапазон возраста, например 18-25. Диапазон не может пересекать границу 18 лет.");
});

bot.callbackQuery("report:cancel", async (ctx) => {
  ctx.session.pendingReportId = null;
  await ctx.answerCallbackQuery("Отменено");
  await ctx.editMessageText("Жалоба отменена.");
});

bot.callbackQuery("report:confirm", async (ctx) => {
  const reportedId = ctx.session.pendingReportId;
  if (!reportedId) {
    await ctx.answerCallbackQuery("Собеседник уже отключён");
    return;
  }
  store.reportAndBlock(ctx.from.id, reportedId);
  ctx.session.pendingReportId = null;
  await ctx.answerCallbackQuery("Жалоба отправлена");
  await ctx.editMessageText("Жалоба отправлена. Этот пользователь больше не попадётся вам.");
  await notifyPartner(ctx, reportedId, "Собеседник завершил чат.");
});

bot.hears("🎲 Найти случайного", (ctx) => startSearch(ctx, "random"));

bot.hears("🔎 Поиск с фильтром", async (ctx) => {
  const user = store.getUser(ctx.from.id);
  if (!profileReady(user)) return startSearch(ctx, "filtered");
  ctx.session.step = "filter_gender";
  await ctx.reply(`Кого искать? Осталось фильтрованных совпадений сегодня: ${store.filteredRemaining(ctx.from.id)}.`, { reply_markup: filterGenderKeyboard });
});

bot.hears("⛔ Завершить", async (ctx) => {
  const partnerId = store.disconnect(ctx.from.id);
  await ctx.reply(partnerId ? "Чат завершён." : "Вы не участвуете в чате или поиске.", { reply_markup: menuKeyboard });
  await notifyPartner(ctx, partnerId, "Собеседник завершил чат.");
});

bot.hears("⏭ Следующий", async (ctx) => {
  const user = store.getUser(ctx.from.id);
  const partnerId = store.disconnect(ctx.from.id);
  await notifyPartner(ctx, partnerId, "Собеседник переключился на следующий чат.");
  await startSearch(ctx, user?.filter_gender && user.filter_gender !== "any" ? "filtered" : "random", {
    targetGender: user?.filter_gender ?? "any",
    minAge: user?.filter_min_age ?? 12,
    maxAge: user?.filter_max_age ?? 99
  });
});

bot.hears("🚩 Пожаловаться", async (ctx) => {
  const user = store.getUser(ctx.from.id);
  if (!user?.partner_id) {
    await ctx.reply("Сейчас нет активного собеседника.", { reply_markup: menuKeyboard });
    return;
  }
  ctx.session.pendingReportId = user.partner_id;
  await ctx.reply("Жалоба завершит чат и навсегда исключит этого пользователя из вашего поиска.", { reply_markup: confirmReportKeyboard });
});

bot.hears("👤 Профиль", async (ctx) => {
  const user = store.getUser(ctx.from.id);
  if (!profileReady(user)) {
    ctx.session.step = "gender";
    await ctx.reply("Кто вы?", { reply_markup: genderKeyboard });
    return;
  }
  await ctx.reply(`Ваш профиль: ${displayGender(user.gender)}, ${user.age}.\nФильтрованных совпадений сегодня осталось: ${store.filteredRemaining(ctx.from.id)}.\n\nЧтобы изменить профиль, отправьте /reset.`, { reply_markup: menuKeyboard });
});

bot.command("reset", async (ctx) => {
  const partnerId = store.disconnect(ctx.from.id);
  await notifyPartner(ctx, partnerId, "Собеседник завершил чат.");
  store.setProfile(ctx.from.id, { gender: null, age: null, state: "onboarding" });
  ctx.session.step = "gender";
  await ctx.reply("Профиль сброшен. Кто вы?", { reply_markup: genderKeyboard });
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (ctx.session.step === "age") {
    const age = Number(text);
    if (!Number.isInteger(age) || age < 12 || age > 99) {
      await ctx.reply("Введите возраст целым числом от 12 до 99.");
      return;
    }
    store.setProfile(ctx.from.id, { age, state: "idle" });
    ctx.session.step = null;
    await ctx.reply("Профиль готов. Выберите поиск.", { reply_markup: menuKeyboard });
    return;
  }
  if (ctx.session.step === "filter_age") {
    const match = text.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
    const minAge = Number(match?.[1]);
    const maxAge = Number(match?.[2]);
    const user = store.getUser(ctx.from.id);
    const sameGroup = user.age < 18 ? maxAge < 18 : minAge >= 18;
    if (!match || minAge < 12 || maxAge > 99 || minAge > maxAge || !sameGroup) {
      await ctx.reply(user.age < 18 ? "Введите диапазон внутри 12–17, например 14-17." : "Введите диапазон внутри 18–99, например 18-25.");
      return;
    }
    store.setProfile(ctx.from.id, { filter_min_age: minAge, filter_max_age: maxAge });
    ctx.session.step = null;
    await startSearch(ctx, "filtered", { targetGender: user.filter_gender, minAge, maxAge });
    return;
  }

  const user = store.getUser(ctx.from.id);
  if (!user?.partner_id) {
    await ctx.reply("Сначала найдите собеседника кнопкой ниже.", { reply_markup: menuKeyboard });
    return;
  }
  await ctx.api.copyMessage(user.partner_id, ctx.chat.id, ctx.message.message_id).catch(async () => {
    await ctx.reply("Не удалось доставить сообщение. Возможно, собеседник заблокировал бота.");
    store.disconnect(ctx.from.id);
  });
});

bot.on(["message:photo", "message:video", "message:voice", "message:video_note", "message:document", "message:sticker", "message:animation"], async (ctx) => {
  const user = store.getUser(ctx.from.id);
  if (!user?.partner_id) {
    await ctx.reply("Сейчас нет активного собеседника.", { reply_markup: menuKeyboard });
    return;
  }
  await ctx.api.copyMessage(user.partner_id, ctx.chat.id, ctx.message.message_id).catch(() => {});
});

bot.catch((error) => console.error("Bot error", error.error));

const shutdown = () => {
  bot.stop();
  store.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log("Anonymous chat bot is starting in long-polling mode");
await bot.start({ drop_pending_updates: false });

