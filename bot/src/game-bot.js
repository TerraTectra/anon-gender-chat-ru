import { Bot, InlineKeyboard, Keyboard, session } from "grammy";
import { GameStore, normalizeGame } from "./game-store.js";
import { catalogLabel, showCatalog } from "./catalog.js";
import { parseStartSource } from "./tracking.js";
import { inviteKeyboard } from "./referrals.js";

const labels = {
  search: "🎮 Найти напарника",
  next: "⏭ Следующий",
  stop: "⛔ Завершить",
  report: "🚩 Пожаловаться",
  profile: "👤 Профиль",
  stats: "📊 Статистика",
  invite: "🎁 Пригласить",
  catalog: catalogLabel
};

const menu = new Keyboard()
  .text(labels.search)
  .row()
  .text(labels.next)
  .text(labels.stop)
  .row()
  .text(labels.report)
  .text(labels.profile)
  .row()
  .text(labels.stats)
  .text(labels.invite)
  .row()
  .text(labels.catalog)
  .resized();

const ageKeyboard = new InlineKeyboard()
  .text("12-17", "game_age:minor")
  .text("18+", "game_age:adult");

const platformKeyboard = new InlineKeyboard()
  .text("PC", "game_platform:pc")
  .text("PlayStation", "game_platform:playstation")
  .row()
  .text("Xbox", "game_platform:xbox")
  .text("Mobile", "game_platform:mobile");

const games = [
  ["CS2", "cs2"],
  ["Valorant", "valorant"],
  ["Dota 2", "dota 2"],
  ["Fortnite", "fortnite"],
  ["Minecraft", "minecraft"],
  ["GTA Online", "gta online"],
  ["PUBG", "pubg"],
  ["Roblox", "roblox"],
  ["Mobile Legends", "mobile legends"]
];

const gameKeyboard = new InlineKeyboard();
for (let index = 0; index < games.length; index += 1) {
  const [label, key] = games[index];
  gameKeyboard.text(label, `game_title:${key}`);
  if (index % 2 === 1) gameKeyboard.row();
}
gameKeyboard.row().text("Другая игра", "game_title:custom");

const styleKeyboard = new InlineKeyboard()
  .text("Спокойно", "game_style:casual")
  .text("Рейтинг", "game_style:ranked")
  .row()
  .text("Не важно", "game_style:any");

const reportKeyboard = new InlineKeyboard()
  .text("Отправить жалобу", "game_report:confirm")
  .text("Отмена", "game_report:cancel");

const platformName = { pc: "PC", playstation: "PlayStation", xbox: "Xbox", mobile: "Mobile" };
const styleName = { casual: "спокойная игра", ranked: "рейтинг", any: "любой стиль" };
const profileReady = (user) => Boolean(user?.age_group && user?.platform && user?.game_key && user?.play_style);

export function createGameBot(token, dbPath) {
  const store = new GameStore(dbPath);
  const bot = new Bot(token);
  bot.use(session({ initial: () => ({ awaitingCustomGame: false, pendingReportId: null }) }));

  bot.use(async (ctx, next) => {
    if (ctx.from && store.isBanned(ctx.from.id)) {
      if (ctx.message?.text === "/start") await ctx.reply("Доступ к боту ограничен администратором.");
      return;
    }
    await next();
  });

  async function notifyPartner(ctx, partnerId, text) {
    if (!partnerId) return;
    await ctx.api.sendMessage(partnerId, text, { reply_markup: menu }).catch(() => {});
  }

  async function showMenu(ctx) {
    const user = store.getUser(ctx.from.id);
    if (!profileReady(user)) {
      await ctx.reply("Выберите возрастную группу. Пользователи младше 18 лет не встречаются в поиске со взрослыми.", { reply_markup: ageKeyboard });
      return;
    }
    await ctx.reply("Профиль готов. Можно искать напарника.", { reply_markup: menu });
  }

  async function startSearch(ctx) {
    const user = store.getUser(ctx.from.id);
    if (!profileReady(user)) return showMenu(ctx);
    store.recordEvent(ctx.from.id, "search");
    const result = store.enqueue(ctx.from.id);
    if (result.status === "matched") {
      store.recordEvent(ctx.from.id, "match");
      const message = `Напарник для ${user.game_label} найден. Договоритесь о режиме, времени и обменяйтесь игровыми никами.`;
      await ctx.reply(message, { reply_markup: menu });
      await ctx.api.sendMessage(result.partnerId, message, { reply_markup: menu }).catch(() => {});
      return;
    }
    await ctx.reply(`Ищу напарника: ${user.game_label}, ${platformName[user.platform]}, ${styleName[user.play_style]}.`, { reply_markup: menu });
  }

  async function stopChat(ctx) {
    const user = store.getUser(ctx.from.id);
    const partnerId = store.disconnect(ctx.from.id);
    const message = partnerId ? "Диалог завершён." : user?.state === "searching" ? "Поиск остановлен." : "Вы не участвуете в диалоге или поиске.";
    await ctx.reply(message, { reply_markup: menu });
    await notifyPartner(ctx, partnerId, "Напарник завершил диалог.");
  }

  async function nextPartner(ctx) {
    const partnerId = store.disconnect(ctx.from.id);
    await notifyPartner(ctx, partnerId, "Напарник переключился на следующий поиск.");
    await startSearch(ctx);
  }

  async function showProfile(ctx) {
    const user = store.getUser(ctx.from.id);
    if (!profileReady(user)) return showMenu(ctx);
    const group = user.age_group === "minor" ? "12-17" : "18+";
    await ctx.reply(`Профиль: ${group}, ${user.game_label}, ${platformName[user.platform]}, ${styleName[user.play_style]}.\nИспользуйте /reset для изменения.`, { reply_markup: menu });
  }

  async function showStats(ctx) {
    const stats = store.stats();
    await ctx.reply(`Сейчас ищут: ${stats.searching}.\nАктивных пар: ${stats.chatting}.\nИгроков: ${stats.users}.`, { reply_markup: menu });
  }

  async function showInvite(ctx) {
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.from.id}`;
    await ctx.reply(`Ваша ссылка:\n${link}\n\nПриглашено игроков: ${store.invitedCount(ctx.from.id)}.`, { reply_markup: inviteKeyboard(link, "Найди тиммейта по игре, платформе и стилю игры") });
  }

  async function beginReport(ctx) {
    const user = store.getUser(ctx.from.id);
    if (!user?.partner_id) {
      await ctx.reply("Сейчас нет активного напарника.", { reply_markup: menu });
      return;
    }
    ctx.session.pendingReportId = user.partner_id;
    await ctx.reply("Жалоба завершит диалог и навсегда исключит этого пользователя из вашего поиска.", { reply_markup: reportKeyboard });
  }

  bot.command("start", async (ctx) => {
    const source = parseStartSource(ctx.match, ctx.from.id);
    store.upsertUser(ctx.from.id, ctx.from.username, source);
    store.recordEvent(ctx.from.id, "start");
    await showMenu(ctx);
  });

  bot.command("menu", showMenu);
  bot.command("search", startSearch);
  bot.command("next", nextPartner);
  bot.command("stop", stopChat);
  bot.command("profile", showProfile);
  bot.command("stats", showStats);
  bot.command("invite", showInvite);
  bot.command("report", beginReport);
  bot.command("rules", (ctx) => ctx.reply("Без оскорблений, угроз, спама и выпрашивания личных данных. Не передавайте пароли и коды входа. Нарушения отправляйте через кнопку жалобы.", { reply_markup: menu }));
  bot.command("catalog", showCatalog);

  bot.command("reset", async (ctx) => {
    store.upsertUser(ctx.from.id, ctx.from.username);
    const partnerId = store.disconnect(ctx.from.id);
    await notifyPartner(ctx, partnerId, "Напарник завершил диалог.");
    store.setProfile(ctx.from.id, { age_group: null, platform: null, game_key: null, game_label: null, play_style: null, state: "idle" });
    ctx.session.awaitingCustomGame = false;
    await ctx.reply("Профиль сброшен. Выберите возрастную группу.", { reply_markup: ageKeyboard });
  });

  bot.callbackQuery(/^game_age:(minor|adult)$/, async (ctx) => {
    store.upsertUser(ctx.from.id, ctx.from.username);
    store.setProfile(ctx.from.id, { age_group: ctx.match[1] });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Выберите платформу.", { reply_markup: platformKeyboard });
  });

  bot.callbackQuery(/^game_platform:(pc|playstation|xbox|mobile)$/, async (ctx) => {
    store.setProfile(ctx.from.id, { platform: ctx.match[1] });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Выберите игру.", { reply_markup: gameKeyboard });
  });

  bot.callbackQuery(/^game_title:(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    await ctx.answerCallbackQuery();
    if (key === "custom") {
      ctx.session.awaitingCustomGame = true;
      await ctx.editMessageText("Напишите точное название игры одним сообщением.");
      return;
    }
    const selected = games.find(([, gameKey]) => gameKey === key);
    store.setProfile(ctx.from.id, { game_key: key, game_label: selected?.[0] ?? key });
    await ctx.editMessageText("Как хотите играть?", { reply_markup: styleKeyboard });
  });

  bot.callbackQuery(/^game_style:(casual|ranked|any)$/, async (ctx) => {
    store.setProfile(ctx.from.id, { play_style: ctx.match[1], state: "idle" });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Профиль готов.");
    await ctx.reply("Можно начинать поиск.", { reply_markup: menu });
  });

  bot.callbackQuery("game_report:cancel", async (ctx) => {
    ctx.session.pendingReportId = null;
    await ctx.answerCallbackQuery("Отменено");
    await ctx.editMessageText("Жалоба отменена.");
  });

  bot.callbackQuery("game_report:confirm", async (ctx) => {
    const reportedId = ctx.session.pendingReportId;
    if (!reportedId) {
      await ctx.answerCallbackQuery("Напарник уже отключён");
      return;
    }
    store.reportAndBlock(ctx.from.id, reportedId);
    store.recordEvent(ctx.from.id, "report");
    ctx.session.pendingReportId = null;
    await ctx.answerCallbackQuery("Жалоба отправлена");
    await ctx.editMessageText("Жалоба отправлена. Этот игрок больше не попадётся вам.");
    await notifyPartner(ctx, reportedId, "Напарник завершил диалог.");
  });

  bot.hears(labels.search, startSearch);
  bot.hears(labels.next, nextPartner);
  bot.hears(labels.stop, stopChat);
  bot.hears(labels.report, beginReport);
  bot.hears(labels.profile, showProfile);
  bot.hears(labels.stats, showStats);
  bot.hears(labels.invite, showInvite);
  bot.hears(labels.catalog, showCatalog);

  bot.on("message:text", async (ctx) => {
    if (ctx.session.awaitingCustomGame) {
      const label = ctx.message.text.trim().replace(/\s+/g, " ");
      const key = normalizeGame(label);
      if (key.length < 2 || label.length > 80) {
        await ctx.reply("Введите название игры длиной от 2 до 80 символов.");
        return;
      }
      store.setProfile(ctx.from.id, { game_key: key, game_label: label });
      ctx.session.awaitingCustomGame = false;
      await ctx.reply("Как хотите играть?", { reply_markup: styleKeyboard });
      return;
    }
    const user = store.getUser(ctx.from.id);
    if (!user?.partner_id) {
      await ctx.reply("Сначала найдите напарника.", { reply_markup: menu });
      return;
    }
    await ctx.api.copyMessage(user.partner_id, ctx.chat.id, ctx.message.message_id).catch(async () => {
      store.disconnect(ctx.from.id);
      await ctx.reply("Сообщение не доставлено. Возможно, напарник заблокировал бота.", { reply_markup: menu });
    });
  });

  bot.on(["message:photo", "message:video", "message:voice", "message:video_note", "message:document", "message:sticker", "message:animation"], async (ctx) => {
    const user = store.getUser(ctx.from.id);
    if (!user?.partner_id) {
      await ctx.reply("Сейчас нет активного напарника.", { reply_markup: menu });
      return;
    }
    await ctx.api.copyMessage(user.partner_id, ctx.chat.id, ctx.message.message_id).catch(() => store.disconnect(ctx.from.id));
  });

  bot.catch((error) => console.error("Game bot error", error.error));
  return bot;
}
