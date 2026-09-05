import path from "node:path";
import { Bot, InlineKeyboard, session } from "grammy";
import { Store } from "./store.js";
import { createCatalogHandler } from "./catalog.js";
import { parseStartSource } from "./tracking.js";
import { inviteKeyboard } from "./referrals.js";
import { safeErrorSummary } from "./safe-error.js";
import {
  confirmReportKeyboard,
  filterGenderKeyboard,
  genderKeyboard,
  labels,
  menuKeyboard
} from "./keyboards.js";

const profileReady = (user) => Boolean(user?.gender && user?.age);
const displayGender = (value) => value === "male" ? "парень" : "девушка";
const TELEGRAM_DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
const MEDIA_RETENTION_NOTICE = "Для модерации сессии с 6 и более фото, видео или кружками сохраняют эти вложения до 7 суток после завершения. Текст переписки не сохраняется.";

export function retainedMediaFromMessage(message) {
  if (message?.photo?.length) {
    const photo = message.photo.at(-1);
    return {
      kind: "photo",
      fileId: photo.file_id,
      fileUniqueId: photo.file_unique_id,
      fileSize: photo.file_size,
      mimeType: "image/jpeg"
    };
  }
  if (message?.video) {
    return {
      kind: "video",
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
      fileSize: message.video.file_size,
      mimeType: message.video.mime_type || "video/mp4"
    };
  }
  if (message?.video_note) {
    return {
      kind: "video_note",
      fileId: message.video_note.file_id,
      fileUniqueId: message.video_note.file_unique_id,
      fileSize: message.video_note.file_size,
      mimeType: "video/mp4"
    };
  }
  return null;
}

export function postChatKeyboard() {
  return new InlineKeyboard()
    .url("🧠 Вопрос дня", "https://t.me/TectraQuizBot?start=src_anon_postchat_daily")
    .url("🎉 Игра дня", "https://t.me/TectraPartyBot?start=src_anon_postchat_daily");
}

export function createUserBot(token, dbPath, options = {}) {
  const store = options.store ?? new Store(dbPath, { sessionArchiveRoot: options.sessionArchiveRoot });
  const bot = new Bot(token);
  const showCatalog = createCatalogHandler("anon");
  // Keep button actions and slash commands routed to exactly the same handler.
  const registerAction = (label, command, handler) => {
    bot.hears(label, handler);
    bot.command(command, handler);
  };
  const retentionTimer = setInterval(() => {
    try {
      store.purgeExpiredChatSessions();
    } catch (error) {
      console.error("Session retention cleanup failed", error instanceof Error ? error.message : String(error));
    }
  }, 15 * 60 * 1000);
  retentionTimer.unref?.();
  bot.stopSessionRetention = () => clearInterval(retentionTimer);
  bot.closeStore = () => store.close();
  bot.use(session({ initial: () => ({ step: null, pendingReportId: null }) }));

  bot.use(async (ctx, next) => {
    if (ctx.from && store.isBanned(ctx.from.id)) {
      if (ctx.message?.text === "/start") {
        await ctx.reply("Ваш доступ к анонимному чату ограничен администрацией.");
      }
      return;
    }
    await next();
  });

  async function notifyPartner(ctx, partnerId, text, replyMarkup = menuKeyboard) {
    if (!partnerId) return;
    await ctx.api.sendMessage(partnerId, text, { reply_markup: replyMarkup }).catch(() => {});
  }

  async function archiveRetainedMedia(ctx, media) {
    let capture;
    try {
      capture = store.beginChatMedia(ctx.from.id, {
        ...media,
        sourceChatId: ctx.chat.id,
        sourceMessageId: ctx.message.message_id,
        mediaGroupId: ctx.message.media_group_id ?? null
      });
    } catch (error) {
      console.error("Session media registration failed", error instanceof Error ? error.message : String(error));
      return;
    }
    if (!capture || (capture.duplicate && capture.storage_status !== "pending")) return;
    if (Number(media.fileSize || 0) > TELEGRAM_DOWNLOAD_LIMIT_BYTES) {
      store.failChatMedia(capture.id, "telegram_download_limit_20mb");
      return;
    }

    let phase = "get_file";
    try {
      const remote = await ctx.api.getFile(media.fileId);
      if (!remote.file_path) throw new Error("missing_file_path");
      phase = "download";
      const encodedPath = remote.file_path.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(`https://api.telegram.org/file/bot${token}/${encodedPath}`);
      if (!response.ok) {
        store.failChatMedia(capture.id, `download_http_${response.status}`);
        return;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > TELEGRAM_DOWNLOAD_LIMIT_BYTES) {
        store.failChatMedia(capture.id, "telegram_download_limit_20mb");
        return;
      }
      phase = "store";
      const extension = path.extname(remote.file_path) || (media.kind === "photo" ? ".jpg" : ".mp4");
      store.completeChatMedia(capture.id, bytes, extension, media.mimeType);
    } catch {
      store.failChatMedia(capture.id, `${phase}_failed`);
      console.error(`Session media archive failed during ${phase}`);
    }
  }

  async function startSearch(ctx, mode, filter = {}) {
    const user = store.getUser(ctx.from.id);
    if (!profileReady(user)) {
      ctx.session.step = "gender";
      await ctx.reply("Сначала создадим короткий профиль. Кто вы?", { reply_markup: genderKeyboard });
      return;
    }
    if (user.partner_id) {
      const previous = store.disconnect(ctx.from.id, "new_search");
      await notifyPartner(ctx, previous, "\u0421\u043e\u0431\u0435\u0441\u0435\u0434\u043d\u0438\u043a \u043d\u0430\u0447\u0430\u043b \u043d\u043e\u0432\u044b\u0439 \u043f\u043e\u0438\u0441\u043a.");
    }
    ctx.session.step = null;
    store.recordEvent(ctx.from.id, "search");
    const result = store.enqueue(ctx.from.id, mode, filter.targetGender, filter.minAge, filter.maxAge);
    if (result.status === "limit") {
      await ctx.reply("Сегодня использованы все 50 фильтрованных совпадений. Случайный поиск остаётся без лимита.", { reply_markup: menuKeyboard });
    } else if (result.status === "matched") {
      store.recordEvent(ctx.from.id, "match");
      const message = "Собеседник найден. Можно писать сообщение.";
      await ctx.reply(message, { reply_markup: menuKeyboard });
      await ctx.api.sendMessage(result.partnerId, message, { reply_markup: menuKeyboard }).catch(() => {});
    } else {
      await ctx.reply("Ищу собеседника. Напишу, как только появится подходящая пара.", { reply_markup: menuKeyboard });
    }
  }

  bot.command("start", async (ctx) => {
    const source = parseStartSource(ctx.match, ctx.from.id);
    const user = store.upsertUser(ctx.from.id, ctx.from.username, source);
    store.recordEvent(ctx.from.id, "start");
    if (!profileReady(user)) {
      ctx.session.step = "gender";
      await ctx.reply(`Добро пожаловать в анонимный чат 12+. Аккаунты собеседников скрыты, а пользователи 12–17 и 18+ никогда не смешиваются.\n\n${MEDIA_RETENTION_NOTICE}\n\nКто вы?`, { reply_markup: genderKeyboard });
      return;
    }
    await ctx.reply(`Готово. Выберите поиск.\n\n${MEDIA_RETENTION_NOTICE}`, { reply_markup: menuKeyboard });
  });

  bot.command("privacy", (ctx) => ctx.reply(MEDIA_RETENTION_NOTICE, { reply_markup: menuKeyboard }));

  bot.callbackQuery(/^profile_gender:(male|female)$/, async (ctx) => {
    store.upsertUser(ctx.from.id, ctx.from.username);
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
    store.recordEvent(ctx.from.id, "report");
    ctx.session.pendingReportId = null;
    await ctx.answerCallbackQuery("Жалоба отправлена");
    await ctx.editMessageText("Жалоба отправлена. Этот пользователь больше не попадётся вам.");
    await notifyPartner(ctx, reportedId, "Собеседник завершил чат.");
  });

  registerAction(labels.random, "search", (ctx) => startSearch(ctx, "random"));
  registerAction(labels.filtered, "filters", async (ctx) => {
    const user = store.getUser(ctx.from.id);
    if (!profileReady(user)) return startSearch(ctx, "filtered");
    ctx.session.step = "filter_gender";
    await ctx.reply(`Кого искать? Осталось фильтрованных совпадений сегодня: ${store.filteredRemaining(ctx.from.id)}.`, { reply_markup: filterGenderKeyboard });
  });

  registerAction(labels.stop, "stop", async (ctx) => {
    const user = store.getUser(ctx.from.id);
    const partnerId = store.disconnect(ctx.from.id, "stop");
    ctx.session.step = null;
    ctx.session.pendingReportId = null;
    const message = partnerId ? "Чат завершён." : user?.state === "searching" ? "Поиск остановлен." : "Вы не участвуете в чате или поиске.";
    await ctx.reply(message, { reply_markup: partnerId ? postChatKeyboard() : menuKeyboard });
    await notifyPartner(ctx, partnerId, "Собеседник завершил чат.", postChatKeyboard());
  });

  registerAction(labels.next, "next", async (ctx) => {
    const user = store.getUser(ctx.from.id);
    const partnerId = store.disconnect(ctx.from.id, "next");
    await notifyPartner(ctx, partnerId, "Собеседник переключился на следующий чат.");
    await startSearch(ctx, user?.filter_gender && user.filter_gender !== "any" ? "filtered" : "random", {
      targetGender: user?.filter_gender ?? "any",
      minAge: user?.filter_min_age ?? 12,
      maxAge: user?.filter_max_age ?? 99
    });
  });

  registerAction(labels.report, "report", async (ctx) => {
    const user = store.getUser(ctx.from.id);
    if (!user?.partner_id) {
      await ctx.reply("Сейчас нет активного собеседника.", { reply_markup: menuKeyboard });
      return;
    }
    ctx.session.pendingReportId = user.partner_id;
    await ctx.reply("Жалоба завершит чат и навсегда исключит этого пользователя из вашего поиска.", { reply_markup: confirmReportKeyboard });
  });

  registerAction(labels.profile, "profile", async (ctx) => {
    const user = store.getUser(ctx.from.id);
    if (!profileReady(user)) {
      ctx.session.step = "gender";
      await ctx.reply("Кто вы?", { reply_markup: genderKeyboard });
      return;
    }
    await ctx.reply(`Ваш профиль: ${displayGender(user.gender)}, ${user.age}.\nФильтрованных совпадений сегодня осталось: ${store.filteredRemaining(ctx.from.id)}.\n\nЧтобы изменить профиль, отправьте /reset.`, { reply_markup: menuKeyboard });
  });

  async function showStats(ctx) {
    const stats = store.stats();
    await ctx.reply(
      `Сейчас в поиске: ${stats.searching}.\nАктивных чатов: ${stats.chatting}.\nПользователей: ${stats.users}.`,
      { reply_markup: menuKeyboard }
    );
  }

  async function showInvite(ctx) {
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.from.id}`;
    const invited = store.invitedCount(ctx.from.id);
    await ctx.reply(
      `Ваша ссылка:\n${link}\n\nПриглашено друзей: ${invited}. Чем больше людей онлайн, тем быстрее находится собеседник.`,
      { reply_markup: inviteKeyboard(link, "Анонимный чат один на один с безопасным разделением 12-17 и 18+") }
    );
  }

  bot.hears(labels.stats, showStats);
  bot.hears(labels.invite, showInvite);
  bot.hears(labels.catalog, showCatalog);
  bot.command("stats", showStats);
  bot.command("invite", showInvite);
  bot.command("catalog", showCatalog);

  bot.command("reset", async (ctx) => {
    store.upsertUser(ctx.from.id, ctx.from.username);
    const partnerId = store.disconnect(ctx.from.id, "profile_reset");
    await notifyPartner(ctx, partnerId, "Собеседник завершил чат.");
    store.setProfile(ctx.from.id, { gender: null, age: null, state: "onboarding" });
    ctx.session.step = "gender";
    await ctx.reply("Профиль сброшен. Кто вы?", { reply_markup: genderKeyboard });
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      await ctx.reply("Unknown command. Use /search, /filters, or /stop.", { reply_markup: menuKeyboard });
      return;
    }
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
      const sameGroup = user?.age < 18 ? maxAge < 18 : minAge >= 18;
      if (!match || minAge < 12 || maxAge > 99 || minAge > maxAge || !sameGroup) {
        await ctx.reply(user?.age < 18 ? "Введите диапазон внутри 12–17, например 14-17." : "Введите диапазон внутри 18–99, например 18-25.");
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
    try {
      await ctx.api.copyMessage(user.partner_id, ctx.chat.id, ctx.message.message_id);
    } catch {
      store.disconnect(ctx.from.id, "delivery_failed");
      await ctx.reply("Не удалось доставить сообщение. Возможно, собеседник заблокировал бота.", { reply_markup: menuKeyboard });
      return;
    }
    try {
      store.touchChatSession(ctx.from.id);
    } catch (error) {
      console.error("Chat session activity update failed", error instanceof Error ? error.message : String(error));
    }
  });

  bot.on(["message:photo", "message:video", "message:voice", "message:video_note", "message:document", "message:sticker", "message:animation"], async (ctx) => {
    const user = store.getUser(ctx.from.id);
    if (!user?.partner_id) {
      await ctx.reply("Сейчас нет активного собеседника.", { reply_markup: menuKeyboard });
      return;
    }
    try {
      await ctx.api.copyMessage(user.partner_id, ctx.chat.id, ctx.message.message_id);
    } catch {
      store.disconnect(ctx.from.id, "delivery_failed");
      await ctx.reply("Не удалось доставить сообщение.", { reply_markup: menuKeyboard });
      return;
    }
    const media = retainedMediaFromMessage(ctx.message);
    if (media) await archiveRetainedMedia(ctx, media);
    else {
      try {
        store.touchChatSession(ctx.from.id);
      } catch (error) {
        console.error("Chat session activity update failed", error instanceof Error ? error.message : String(error));
      }
    }
  });

  bot.catch((error) => console.error("User bot error", safeErrorSummary(error)));
  return bot;
}
