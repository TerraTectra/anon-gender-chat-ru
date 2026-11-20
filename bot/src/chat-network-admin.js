import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { InputFile, InlineKeyboard } from "grammy";
import { Store } from "./store.js";
import { anonVariants, anonVariantDbPath } from "./anon-variants.js";
import { aggregateNetworkSessions, collectClearableArchiveIds, NETWORK_SESSION_PAGE_SIZE } from "./chat-network-session-list.js";

const PAGE_SIZE = 8;
const TIMELINE_SIZE = 8;
const BRANDS = [{ id: "anon", name: "Основной анонимный чат", username: "anon_gender_chat_ru_bot" }, ...anonVariants];
const IDS = "(anon|english|focus|game|budget|hub|task|quiz|party)";
const dateLabel = time => time ? new Date(Number(time)).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }) : "неизвестно";
const userLabel = user => (user?.username ? "@" + user.username : "ID " + user?.id);
const validPage = value => Math.max(0, Math.min(1000000, Number(value) || 0));
const kindLabel = kind => ({ text: "Текст", photo: "Фото", video: "Видео", voice: "Голосовое", video_note: "Кружок", document: "Документ", sticker: "Стикер", animation: "Анимация" })[kind] || kind;
export function splitTelegramText(value, maxLength = 3600) {
  const parts = [];
  let remaining = String(value ?? "");
  while (remaining.length > maxLength) {
    let end = maxLength;
    const last = remaining.charCodeAt(end - 1);
    if (last >= 0xD800 && last <= 0xDBFF) end -= 1;
    parts.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining.length) parts.push(remaining);
  return parts;
}

function sessionInfo(session) {
  const participants = session.participants.map((user, index) =>
    (index + 1) + ". " + userLabel(user) + " · " + (user.age ?? "—") + " лет"
  ).join("\n");
  return "Сессия #" + session.id + " · " + (session.status === "active" ? "активна" : "завершена")
    + "\nНачало: " + dateLabel(session.started_at_ms)
    + "\nПоследняя активность: " + dateLabel(session.last_activity_at_ms)
    + "\nСообщений: " + Number(session.message_count || 0)
    + "\nМедиа: " + Number(session.media_count || 0)
    + "\nИзбранное: " + (Number(session.is_favorite) ? "да" : "нет")
    + "\n\nУчастники:\n" + participants;
}

export function installChatNetworkAdmin(bot, originalStore, options = {}) {
  const stores = new Map([["anon", originalStore]]);
  for (const brand of anonVariants) {
    stores.set(brand.id, new Store(anonVariantDbPath(brand.id), {
      sessionArchiveRoot: path.resolve("./data/anon-variants/session-archive/" + brand.id)
    }));
  }
  const brand = id => BRANDS.find(item => item.id === id);
  const store = id => stores.get(id);
  const privateChat = ctx => ctx.chat?.type === "private";
  const sources = BRANDS.map(item => ({ id: item.id, store: stores.get(item.id) }));
  const pendingArchiveClear = new Map();
  const pendingSessionDelete = new Map();
  const deletionKey = (ctx,id,sessionId) => `${ctx.from?.id}:${id}:${sessionId}`;
  const sourceKind = kind => kind.endsWith("a") ? "a" : "m";
  const globalKind = kind => kind.startsWith("g");
  const listCallback = (id, kind, page) => globalKind(kind)
    ? "multi_all:" + sourceKind(kind) + ":" + page
    : "multi_list:" + id + ":" + kind + ":" + page;
  function expireArchiveClearRequests() {
    for (const [key, request] of pendingArchiveClear) {
      if (Date.now() > request.expiresAt) pendingArchiveClear.delete(key);
    }
  }
  const replyKeyboard = id => new InlineKeyboard()
    .text("💬 Активные", "multi_list:" + id + ":a:0")
    .text("🗂 Архив", "multi_list:" + id + ":m:0").row()
    .text("← Все чаты", "multi_home");

  function allKeyboard() {
    const keyboard = new InlineKeyboard()
      .text("🟢 Все активные сессии", "multi_all:a:0")
      .text("🗂 Общий архив", "multi_all:m:0").row();
    BRANDS.forEach(b => keyboard.text(b.name, "multi_brand:" + b.id).row());
    return keyboard;
  }

  async function dashboard(ctx, edit = false) {
    if (!privateChat(ctx)) return ctx.reply("Раздел доступен в личном чате с админ-ботом.");
    const rows = BRANDS.map(b => {
      const stats = store(b.id).stats();
      const growth = store(b.id).growthStats();
      return b.name + "\n@" + b.username + " · пользователей " + stats.users
        + " · ищут " + stats.searching + " · активных пар " + stats.chatting
        + " · совпадений за 7 дней " + growth.matches7 + " · жалоб " + stats.reports;
    });
    const message = "💬 Все анонимные чаты (" + BRANDS.length + ")\n\n" + rows.join("\n\n");
    if (edit) return ctx.editMessageText(message, { reply_markup: allKeyboard() });
    return ctx.reply(message, { reply_markup: allKeyboard() });
  }

  async function viewBrand(ctx, id) {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const st = store(id);
    if (!st) return ctx.answerCallbackQuery({ text: "Бот не найден", show_alert: true });
    const stats = st.stats();
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(brand(id).name + "\n@" + brand(id).username + "\n\n"
      + "Всего пользователей: " + stats.users + "\nИщут: " + stats.searching
      + "\nАктивных пар: " + stats.chatting + "\nНовых жалоб: " + stats.reports,
      { reply_markup: replyKeyboard(id) });
  }

  function globalListKeyboard(result, kind, page) {
    const keyboard = new InlineKeyboard();
    for (const session of result.items) {
      const source = brand(session.brandId);
      const marker = kind === "a" ? "🟢" : Number(session.is_favorite) ? "⭐" : "🗂";
      const compact = source.name.replace(" — анонимный чат", "").replace(" — анонимно", "");
      keyboard.text(marker + " " + compact + " #" + session.id + " · " + (session.message_count || 0) + " сообщ.",
        "multi_session:" + session.brandId + ":" + session.id + ":g" + kind + ":" + page).row();
    }
    if (page > 0) keyboard.text("← Ранее", "multi_all:" + kind + ":" + (page - 1));
    if ((page + 1) * NETWORK_SESSION_PAGE_SIZE < result.total)
      keyboard.text("Далее →", "multi_all:" + kind + ":" + (page + 1));
    if (kind === "m" && result.total > 0) {
      keyboard.row().text("🧹 Очистить архив без избранного", "multi_clear_prepare");
    }
    keyboard.row().text("← Все боты", "multi_home");
    return keyboard;
  }

  async function viewAllSessions(ctx, kind, page = 0, edit = true) {
    if (!privateChat(ctx)) return ctx.reply("Журнал доступен только в личном чате.");
    page = validPage(page);
    // Clamp deep pages to avoid quadratic scans caused by stale or malicious callbacks.
    if (page * NETWORK_SESSION_PAGE_SIZE > 5000) {
      if (ctx.answerCallbackQuery) return ctx.answerCallbackQuery({ text: "Слишком глубокая страница", show_alert: true });
      return ctx.reply("Достигнут предел просмотра. Используйте список конкретного бота.");
    }
    for (const source of sources) source.store.purgeExpiredChatSessions();
    const result = aggregateNetworkSessions(sources, kind, {
      limit: NETWORK_SESSION_PAGE_SIZE, offset: page * NETWORK_SESSION_PAGE_SIZE
    });
    const heading = kind === "a" ? "🟢 Все активные сессии" : "🗂 Общий архив завершённых сессий";
    const lines = result.items.map(session => {
      const source = brand(session.brandId);
      const timestamp = kind === "a" ? session.last_activity_at_ms : (session.ended_at_ms || session.last_activity_at_ms);
      return source.name + " · #" + session.id + " · " + (session.message_count || 0)
        + " сообщ. · " + dateLabel(timestamp);
    });
    const message = heading + "\nБотов: " + BRANDS.length + " · всего сессий: " + result.total
      + "\nСтраница: " + (page + 1) + "\n\n" + (lines.join("\n") || "Сессий пока нет.");
    const keyboard = globalListKeyboard(result, kind, page);
    if (edit) return ctx.editMessageText(message, { reply_markup: keyboard });
    return ctx.reply(message, { reply_markup: keyboard });
  }

  function listKeyboard(id, kind, result, page) {
    const keyboard = new InlineKeyboard();
    for (const session of result.items) {
      keyboard.text((session.status === "active" ? "🟢" : Number(session.is_favorite) ? "⭐" : "🗂")
        + " #" + session.id + " · " + (session.message_count || 0) + " сообщ.",
      "multi_session:" + id + ":" + session.id + ":" + kind + ":" + page).row();
    }
    if (page > 0) keyboard.text("← Ранее", "multi_list:" + id + ":" + kind + ":" + (page - 1));
    if ((page + 1) * PAGE_SIZE < result.total) keyboard.text("Далее →", "multi_list:" + id + ":" + kind + ":" + (page + 1));
    keyboard.row().text("← Бот", "multi_brand:" + id);
    return keyboard;
  }

  async function viewList(ctx, id, kind, page = 0, edit = true) {
    if (!privateChat(ctx)) return ctx.reply("Архив доступен только в личном чате.");
    const st = store(id);
    if (!st) return ctx.answerCallbackQuery({ text: "Бот не найден", show_alert: true });
    page = validPage(page);
    st.purgeExpiredChatSessions();
    const result = kind === "a" ? st.listActiveChatSessions({ limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      : st.listRetainedChatSessions({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    const info = result.items.map(item => "#" + item.id + " · " + (item.message_count || 0)
      + " сообщ. · " + dateLabel(item.last_activity_at_ms)).join("\n") || "Сессий пока нет.";
    const message = brand(id).name + (kind === "a" ? " · активные сессии" : " · архивные сессии")
      + "\nВсего: " + result.total + "\n\n" + info;
    if (edit) return ctx.editMessageText(message, { reply_markup: listKeyboard(id, kind, result, page) });
    return ctx.reply(message, { reply_markup: listKeyboard(id, kind, result, page) });
  }

  function sessionKeyboard(id, session, kind, page) {
    const keyboard = new InlineKeyboard();
    if (Number(session.message_count || 0) > 0)
      keyboard.text("📖 Переписка по порядку", "multi_timeline:" + id + ":" + session.id + ":0:" + kind + ":" + page).row();
    if (Number(session.media_count || 0) > 0)
      keyboard.text(Number(session.is_favorite) ? "☆ Убрать избранное" : "⭐ В избранное",
        "multi_favorite:" + id + ":" + session.id + ":" + (Number(session.is_favorite) ? 0 : 1)
        + ":" + kind + ":" + page).row();
    keyboard.text(session.status === "active" ? "🗑 Удалить активную сессию" : "🗑 Удалить архив этой сессии",
      "multi_delete:" + id + ":" + session.id + ":" + kind + ":" + page).row();
    session.participants.forEach((user, index) => {
      keyboard.text("⛔ Бан участника " + (index + 1) + " · " + user.id,
        "multi_ban:" + id + ":" + session.id + ":" + index + ":" + kind + ":" + page).row();
    });
    return keyboard.text("← Список", listCallback(id, kind, page));
  }

  async function viewSession(ctx, id, sessionId, kind, page) {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const st = store(id);
    st.purgeExpiredChatSessions();
    const session = st.getChatSession(sessionId);
    if (!session) return ctx.answerCallbackQuery({ text: "Сессия недоступна", show_alert: true });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(brand(id).name + "\n@" + brand(id).username + "\n\n" + sessionInfo(session), {
      reply_markup: sessionKeyboard(id, session, kind, page)
    });
  }

  async function sendAttachment(ctx, msg, caption, id, localFile) {
    const common = { protect_content: true };
    if (caption) common.caption = caption.slice(0, 1000);
    const api = ctx.api, chatId = ctx.chat.id;
    if (localFile) {
      const input = new InputFile(localFile);
      if (msg.kind === "photo") return api.sendPhoto(chatId, input, common);
      if (msg.kind === "video") return api.sendVideo(chatId, input, common);
      if (msg.kind === "voice") return api.sendVoice(chatId, input, common);
      if (msg.kind === "video_note") return api.sendVideoNote(chatId, input, { protect_content: true });
      if (msg.kind === "document") return api.sendDocument(chatId, input, common);
      if (msg.kind === "sticker") return api.sendSticker(chatId, input, { protect_content: true });
      if (msg.kind === "animation") return api.sendAnimation(chatId, input, common);
    }
    if (!options.sourceArchiveSender) throw new Error("No source media sender");
    return options.sourceArchiveSender(chatId, msg, id, caption);
  }

  async function timeline(ctx, id, sessionId, offset = 0, returnKind = "m", returnPage = 0) {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const st = store(id), session = st.getChatSession(sessionId);
    offset = validPage(offset);
    if (!session) return ctx.answerCallbackQuery({ text: "Сессия недоступна", show_alert: true });
    const result = st.listChatSessionMessages(sessionId, { limit: TIMELINE_SIZE, offset });
    if (!result.items.length) return ctx.answerCallbackQuery({ text: "Сообщений нет", show_alert: true });
    await ctx.answerCallbackQuery();
    for (const [index, msg] of result.items.entries()) {
      const user = session.participants.find(person => person.id === msg.sender_id);
      const heading = brand(id).name + " · #" + sessionId + "\n" + (offset + index + 1)
        + "/" + result.total + " · " + userLabel(user) + " · " + dateLabel(msg.created_at_ms);
      const body = String(msg.text || msg.caption || (msg.kind === "sticker" ? msg.sticker_emoji : ""));
      const description = heading + "\n" + kindLabel(msg.kind) + (body ? "\n" + body : "");
      if (msg.kind === "text" || !msg.file_id) {
        for (const part of splitTelegramText(description)) await ctx.reply(part, { protect_content: true });
        continue;
      }
      const captionable = !["sticker", "video_note"].includes(msg.kind);
      const separateText = !captionable || description.length > 950;
      if (separateText) {
        for (const part of splitTelegramText(description)) await ctx.reply(part, { protect_content: true });
      }
      const mediaCaption = captionable ? (separateText ? heading + "\n" + kindLabel(msg.kind) : description) : null;
      const local = st.resolveChatSessionMessageAttachment(msg.id);
      let success = false;
      try {
        await sendAttachment(ctx, msg, mediaCaption, id, local?.absolutePath);
        success = true;
      } catch (error) {
        if (local?.absolutePath) {
          try { await sendAttachment(ctx, msg, mediaCaption, id, null); success = true; }
          catch (fallbackError) { console.error("Timeline media unavailable", String(fallbackError?.code || "unknown")); }
        }
      }
      if (!success) await ctx.reply(separateText ? "[Медиа недоступно]" : description + "\n[Медиа недоступно]", { protect_content: true });
    }
    const keyboard = new InlineKeyboard();
    if (offset > 0) keyboard.text("← Ранее", "multi_timeline:" + id + ":" + sessionId + ":" + Math.max(0, offset - TIMELINE_SIZE) + ":" + returnKind + ":" + returnPage);
    if (offset + result.items.length < result.total)
      keyboard.text("Далее →", "multi_timeline:" + id + ":" + sessionId + ":" + (offset + result.items.length) + ":" + returnKind + ":" + returnPage);
    keyboard.row().text("← К сессии", "multi_session:" + id + ":" + sessionId + ":" + returnKind + ":" + returnPage);
    await ctx.reply("Просмотр " + (offset + 1) + "–" + (offset + result.items.length) + " из " + result.total,
      { protect_content: true, reply_markup: keyboard });
  }


  async function askDeleteSession(ctx, id, sessionId, kind, page) {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const st = store(id);
    const session = st?.getChatSession(sessionId);
    if (!session) return ctx.answerCallbackQuery({ text: "Сессия уже удалена", show_alert: true });
    await ctx.answerCallbackQuery();
    const active = session.status === "active";
    const warning = active
      ? "Сейчас идёт разговор. Он будет завершён для обоих участников."
      : "Все сообщения и сохранённые локальные вложения будут удалены безвозвратно.";
    const favorite = Number(session.is_favorite) ? "\nВНИМАНИЕ: сессия добавлена в избранное." : "";
    const keyboard = new InlineKeyboard()
      .text("🗑 Да, удалить безвозвратно", "multi_delete_confirm:" + id + ":" + sessionId + ":" + kind + ":" + page).row()
      .text("Отмена", "multi_session:" + id + ":" + sessionId + ":" + kind + ":" + page);
    for (const [key,expiry] of pendingSessionDelete) if(expiry<=Date.now())pendingSessionDelete.delete(key);
    pendingSessionDelete.set(deletionKey(ctx,id,sessionId),Date.now()+120_000);
    return ctx.editMessageText("Удалить сессию #" + sessionId + " из " + brand(id).name
      + "?\n" + warning + favorite, { reply_markup: keyboard });
  }

  async function confirmDeleteSession(ctx, id, sessionId, kind, page) {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const key=deletionKey(ctx,id,sessionId);
    if((pendingSessionDelete.get(key)||0)<=Date.now())return ctx.answerCallbackQuery({text:'Подтверждение устарело. Снова откройте удаление в карточке сессии.',show_alert:true});
    pendingSessionDelete.delete(key);
    const st = store(id);
    if (!st || !st.getChatSession(sessionId)) {
      return ctx.answerCallbackQuery({ text: "Сессия уже удалена", show_alert: true });
    }
    await ctx.answerCallbackQuery("Удаляю сессию");
    const removed = st.deleteChatSession(sessionId);
    if (!removed) return ctx.editMessageText("Сессия уже удалена.");
    if (removed.status === "active" && options.sourceSessionNotifier) {
      for (const userId of removed.userIds || []) {
        try {
          await options.sourceSessionNotifier(userId, "Ваш чат завершён администрацией.", id);
        } catch (error) {
          console.error("Unable to notify session participant", String(error?.code || "unknown"));
        }
      }
    }
    return ctx.editMessageText(brand(id).name + " · сессия #" + sessionId
      + "\nПереписка и сохранённые локальные вложения удалены.", {
      reply_markup: new InlineKeyboard().text("← К списку", listCallback(id, kind, page))
    });
  }

  function archiveClearRequest(ctx, token, stage) {
    const request = pendingArchiveClear.get(token);
    if (!request || Date.now() > request.expiresAt
      || request.ownerId !== ctx.from?.id || request.stage !== stage) return null;
    return request;
  }

  async function requestArchiveClear(ctx) {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    await ctx.answerCallbackQuery();
    expireArchiveClearRequests();
    let items;
    try {
      items = collectClearableArchiveIds(sources);
    } catch (error) {
      return ctx.editMessageText("Массовая очистка недоступна: слишком много сессий. Удаляйте их по отдельности.", {
        reply_markup: new InlineKeyboard().text("← Общий архив", "multi_all:m:0")
      });
    }
    if (!items.length) return ctx.editMessageText("В архиве нет завершённых сессий для массового удаления. Избранное защищено.", {
      reply_markup: new InlineKeyboard().text("← Общий архив", "multi_all:m:0")
    });
    const token = crypto.randomBytes(8).toString("hex");
    pendingArchiveClear.set(token, {
      ownerId: ctx.from?.id, expiresAt: Date.now() + 120_000,
      stage: 1, items
    });
    return ctx.editMessageText("Очистить общий архив всех девяти чатов?\n\n"
      + "Будет удалено завершённых сессий: " + items.length + ".\n"
      + "Избранные и активные сессии сохранятся.\n"
      + "Удаление переписок и файлов необратимо.\n\n"
      + "Подтверждение действительно две минуты.", {
      reply_markup: new InlineKeyboard()
        .text("Продолжить к подтверждению", "multi_clear_stage2:" + token).row()
        .text("Отмена", "multi_all:m:0")
    });
  }

  async function confirmArchiveClearStage(ctx, token) {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const request = archiveClearRequest(ctx, token, 1);
    if (!request) return ctx.answerCallbackQuery({ text: "Подтверждение истекло", show_alert: true });
    request.stage = 2;
    await ctx.answerCallbackQuery();
    return ctx.editMessageText("Последнее подтверждение.\n"
      + "Удалить " + request.items.length + " завершённых не избранных сессий из всех чатов?\n"
      + "Вернуть переписки и файлы после удаления будет невозможно.", {
      reply_markup: new InlineKeyboard()
        .text("🗑 Удалить " + request.items.length + " сессий", "multi_clear_execute:" + token).row()
        .text("Отмена", "multi_all:m:0")
    });
  }

  async function executeArchiveClear(ctx, token) {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const request = archiveClearRequest(ctx, token, 2);
    if (!request) return ctx.answerCallbackQuery({ text: "Подтверждение истекло", show_alert: true });
    pendingArchiveClear.delete(token); // prevents accidental duplicate processing
    await ctx.answerCallbackQuery("Очищаю архив");
    let deleted = 0, skipped = 0;
    for (const [index, item] of request.items.entries()) {
      const st = store(item.brandId);
      const session = st?.getChatSession(item.sessionId);
      if (session?.status === "ended" && !Number(session.is_favorite)) {
        try {
          if (st.deleteChatSession(item.sessionId)) deleted += 1;
          else skipped += 1;
        } catch (error) {
          skipped += 1;
          console.error("Archive cleanup failed for one session", item.brandId, String(error?.code || "unknown"));
        }
      } else skipped += 1;
      if (index % 20 === 19) await new Promise(resolve => setImmediate(resolve));
    }
    return ctx.editMessageText("Общий архив очищен.\nУдалено сессий: " + deleted
      + "\nПропущено или защищено: " + skipped
      + "\nИзбранное и активные разговоры сохранены.", {
      reply_markup: new InlineKeyboard().text("← Общий архив", "multi_all:m:0")
    });
  }

  const REPORTS_PAGE_SIZE = 8;
  const reportText = (report) => {
    const reason = String(report.reason || "").trim();
    return !reason || reason === "user_report" ? "Причина не указана (старая жалоба)" : reason;
  };

  function pendingNetworkReports() {
    const rows = BRANDS.flatMap(item => store(item.id).recentReports(200)
      .map(report => ({ ...report, brandId: item.id })));
    return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))
      || Number(b.id) - Number(a.id));
  }

  async function showAllReports(ctx, page = 0, edit = false) {
    if (!privateChat(ctx)) return ctx.reply("Жалобы доступны только в личном чате с админ-ботом.");
    const rows = pendingNetworkReports();
    page = Math.min(validPage(page), Math.max(0, Math.ceil(rows.length / REPORTS_PAGE_SIZE) - 1));
    const selected = rows.slice(page * REPORTS_PAGE_SIZE, (page + 1) * REPORTS_PAGE_SIZE);
    const keyboard = new InlineKeyboard();
    for (const row of selected) keyboard.text(brand(row.brandId).name + " · #" + row.id + " · " + row.reported_id,
      "multi_report_card:" + row.brandId + ":" + row.id).row();
    if (page > 0) keyboard.text("← Назад", "multi_reports:" + (page - 1));
    if ((page + 1) * REPORTS_PAGE_SIZE < rows.length) keyboard.text("Далее →", "multi_reports:" + (page + 1));
    keyboard.row().text("← Все чаты", "multi_home");
    const preview = selected.map(row => brand(row.brandId).name + " #" + row.id + ": " + reportText(row).slice(0, 65));
    const message = "🚩 Жалобы на проверке\nВсего в очереди: " + rows.length
      + (rows.length === 1800 ? " (показаны последние 200 от каждого бота)" : "")
      + "\nСтраница " + (page + 1) + "\n\n"
      + (preview.join("\n") || "Новых жалоб нет.");
    const view = { protect_content: true, reply_markup: keyboard };
    return edit ? ctx.editMessageText(message, view) : ctx.reply(message, view);
  }

  async function reportCard(ctx, id, reportId) {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const st = store(id), report = st?.pendingReport(reportId);
    if (!report) return ctx.answerCallbackQuery({ text: "Жалоба уже рассмотрена или удалена", show_alert: true });
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard()
      .text("⛔ Заблокировать", "multi_report_ban_ask:" + id + ":" + report.id + ":" + report.reported_id)
      .text("✅ Закрыть", "multi_report_review:" + id + ":" + report.id).row()
      .text("🗂 Архив этого бота", "multi_list:" + id + ":m:0").row()
      .text("← К жалобам", "multi_reports:0");
    return ctx.editMessageText("🚩 " + brand(id).name + " · жалоба #" + report.id
      + "\nОт: ID " + report.reporter_id + "\nНа: ID " + report.reported_id
      + "\nДата: " + (report.created_at || "неизвестна")
      + "\n\nТекст жалобы:\n" + reportText(report)
      + "\n\nСтатус нарушителя в этом боте: " + (st.isBanned(report.reported_id) ? "заблокирован" : "не заблокирован"),
      { protect_content: true, reply_markup: keyboard });
  }

  async function askReportBan(ctx, id, reportId, userId) {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const report = store(id)?.pendingReport(reportId);
    if (!report || Number(report.reported_id) !== userId)
      return ctx.answerCallbackQuery({ text: "Жалоба уже рассмотрена или устарела", show_alert: true });
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard()
      .text("⛔ Подтвердить бан", "multi_report_ban_confirm:" + id + ":" + reportId + ":" + userId).row()
      .text("Отмена", "multi_report_card:" + id + ":" + reportId);
    return ctx.editMessageText("Заблокировать ID " + userId + " только в боте «" + brand(id).name
      + "»?\n\nТекст жалобы:\n" + reportText(report)
      + "\n\nБлокировка завершит текущую сессию пользователя.",
      { protect_content: true, reply_markup: keyboard });
  }

  bot.command("chats", ctx => dashboard(ctx));
  bot.hears("💬 Все чаты", ctx => dashboard(ctx));
  bot.callbackQuery("multi_home", async ctx => { await ctx.answerCallbackQuery(); await dashboard(ctx, true); });
  bot.callbackQuery(/^multi_all:(a|m):(\d+)$/, async ctx => {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    await ctx.answerCallbackQuery();
    await viewAllSessions(ctx, ctx.match[1], Number(ctx.match[2]), true);
  });
  bot.callbackQuery(new RegExp("^multi_brand:" + IDS + "$"), ctx => viewBrand(ctx, ctx.match[1]));
  bot.callbackQuery(new RegExp("^multi_list:" + IDS + ":(a|m):(\\d+)$"), async ctx => {
    await ctx.answerCallbackQuery();
    await viewList(ctx, ctx.match[1], ctx.match[2], Number(ctx.match[3]));
  });
  bot.callbackQuery(new RegExp("^multi_session:" + IDS + ":(\\d+):(a|m|ga|gm):(\\d+)$"),
    ctx => {
      pendingSessionDelete.delete(deletionKey(ctx,ctx.match[1],Number(ctx.match[2])));
      return viewSession(ctx, ctx.match[1], Number(ctx.match[2]), ctx.match[3], Number(ctx.match[4]));
    });
  bot.callbackQuery(new RegExp("^multi_timeline:" + IDS + ":(\\d+):(\\d+)(?::(a|m|ga|gm):(\\d+))?$"),
    ctx => timeline(ctx, ctx.match[1], Number(ctx.match[2]), Number(ctx.match[3]), ctx.match[4] || "m", Number(ctx.match[5] || 0)));
  bot.callbackQuery(new RegExp("^multi_favorite:" + IDS + ":(\\d+):(0|1):(a|m|ga|gm):(\\d+)$"), async ctx => {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const id=ctx.match[1], st=store(id), session=st.setChatSessionFavorite(Number(ctx.match[2]),ctx.match[3]==="1");
    if(!session)return ctx.answerCallbackQuery({text:"Сессия недоступна",show_alert:true});
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(brand(id).name + "\n@" + brand(id).username + "\n\n" + sessionInfo(session), {
      reply_markup: sessionKeyboard(id,session,ctx.match[4],Number(ctx.match[5]))
    });
  });
  bot.callbackQuery(new RegExp("^multi_ban:" + IDS + ":(\\d+):([01]):(a|m|ga|gm):(\\d+)$"), async ctx => {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const id=ctx.match[1], session=store(id).getChatSession(Number(ctx.match[2]));
    const person=session?.participants[Number(ctx.match[3])];
    if(!person)return ctx.answerCallbackQuery({text:"Сессия недоступна",show_alert:true});
    await ctx.answerCallbackQuery();
    const keyboard=new InlineKeyboard()
      .text("Подтвердить бан ID " + person.id,"multi_ban_confirm:" + id + ":" + session.id + ":" + ctx.match[3])
      .row().text("Отмена","multi_session:" + id + ":" + session.id + ":" + ctx.match[4] + ":" + ctx.match[5]);
    await ctx.editMessageText("Заблокировать " + userLabel(person) + " в боте " + brand(id).name
      + "?\nЕго текущий чат завершится. Остальные боты затронуты не будут.",{reply_markup:keyboard});
  });
  bot.callbackQuery(new RegExp("^multi_ban_confirm:" + IDS + ":(\\d+):([01])$"), async ctx => {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const id=ctx.match[1], st=store(id), session=st.getChatSession(Number(ctx.match[2]));
    const person=session?.participants[Number(ctx.match[3])];
    if(!person)return ctx.answerCallbackQuery({text:"Сессия недоступна",show_alert:true});
    st.banUser(person.id);
    if (session.status === "active" && options.sourceSessionNotifier) {
      const other = session.participants.find(user => user.id !== person.id);
      if (other) await options.sourceSessionNotifier(other.id, "Собеседник завершил чат.", id).catch(() => {});
    }
    await ctx.answerCallbackQuery("Участник заблокирован");
    await ctx.editMessageText(userLabel(person) + " заблокирован в " + brand(id).name
      + ".\nДругие боты не затронуты.\nРазблокировка: /unban_chat " + id + " " + person.id,
      {reply_markup:new InlineKeyboard().text("← Все чаты","multi_home")});
  });
  bot.callbackQuery(new RegExp("^multi_delete:" + IDS + ":(\\d+):(a|m|ga|gm):(\\d+)$"), ctx =>
    askDeleteSession(ctx, ctx.match[1], Number(ctx.match[2]), ctx.match[3], Number(ctx.match[4])));
  bot.callbackQuery(new RegExp("^multi_delete_confirm:" + IDS + ":(\\d+):(a|m|ga|gm):(\\d+)$"), ctx =>
    confirmDeleteSession(ctx, ctx.match[1], Number(ctx.match[2]), ctx.match[3], Number(ctx.match[4])));
  bot.callbackQuery("multi_clear_prepare", requestArchiveClear);
  bot.callbackQuery(/^multi_clear_stage2:([0-9a-f]{16})$/, ctx => confirmArchiveClearStage(ctx, ctx.match[1]));
  bot.callbackQuery(/^multi_clear_execute:([0-9a-f]{16})$/, ctx => executeArchiveClear(ctx, ctx.match[1]));

  bot.callbackQuery(/^multi_reports:(\d+)$/, async ctx => {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    await ctx.answerCallbackQuery();
    return showAllReports(ctx, Number(ctx.match[1]), true);
  });
  bot.callbackQuery(new RegExp("^multi_report_card:" + IDS + ":(\\d+)$"),
    ctx => reportCard(ctx, ctx.match[1], Number(ctx.match[2])));
  // Preserve buttons already sent by older admin bot versions.
  bot.callbackQuery(new RegExp("^multi_report_ban:" + IDS + ":(\\d+):(\\d+)$"),
    ctx => askReportBan(ctx, ctx.match[1], Number(ctx.match[2]), Number(ctx.match[3])));
  bot.callbackQuery(new RegExp("^multi_report_ban_ask:" + IDS + ":(\\d+):(\\d+)$"),
    ctx => askReportBan(ctx, ctx.match[1], Number(ctx.match[2]), Number(ctx.match[3])));
  bot.callbackQuery(new RegExp("^multi_report_ban_confirm:" + IDS + ":(\\d+):(\\d+)$"), async ctx => {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const id = ctx.match[1], reportId = Number(ctx.match[2]), userId = Number(ctx.match[3]), st = store(id);
    const report = st?.pendingReport(reportId);
    if (!report || Number(report.reported_id) !== userId)
      return ctx.answerCallbackQuery({ text: "Жалоба уже рассмотрена или устарела", show_alert: true });
    st.banUser(userId);
    st.reviewReport(reportId);
    await ctx.answerCallbackQuery("Пользователь заблокирован в этом боте");
    return ctx.editMessageText(brand(id).name + " · жалоба #" + reportId
      + "\nID " + userId + " заблокирован только в выбранном боте.",
      { reply_markup: new InlineKeyboard().text("♻️ Разблокировать", "multi_report_unban:" + id + ":" + userId)
        .row().text("← Жалобы", "multi_reports:0") });
  });
  bot.callbackQuery(new RegExp("^multi_report_review:" + IDS + ":(\\d+)$"), async ctx => {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const id = ctx.match[1], reportId = Number(ctx.match[2]);
    if (!store(id).reviewReport(reportId)) return ctx.answerCallbackQuery({ text: "Жалоба уже закрыта", show_alert: true });
    await ctx.answerCallbackQuery("Жалоба рассмотрена");
    return ctx.editMessageText(brand(id).name + " · жалоба #" + reportId + "\nЗакрыта без блокировки.",
      { reply_markup: new InlineKeyboard().text("← Жалобы", "multi_reports:0") });
  });
  bot.callbackQuery(new RegExp("^multi_report_unban:" + IDS + ":(\\d+)$"), async ctx => {
    if (!privateChat(ctx)) return ctx.answerCallbackQuery({ text: "Только в личном чате", show_alert: true });
    const id = ctx.match[1], userId = Number(ctx.match[2]);
    if (!Number.isSafeInteger(userId) || userId <= 0) return ctx.answerCallbackQuery({ text: "Некорректный ID", show_alert: true });
    store(id).unbanUser(userId);
    await ctx.answerCallbackQuery("Разблокирован");
    return ctx.editMessageText("ID " + userId + " разблокирован в " + brand(id).name + ".",
      { reply_markup: new InlineKeyboard().text("← Жалобы", "multi_reports:0") });
  });

  bot.command("unban_chat",async ctx => {
    if (!privateChat(ctx)) return ctx.reply("Только в личном чате.");
    const [id,rawId]=String(ctx.match||"").trim().split(/\s+/), st=store(id), userId=Number(rawId);
    if(!st||!Number.isSafeInteger(userId)||userId<=0)return ctx.reply("Формат: /unban_chat english 123456789");
    st.unbanUser(userId);
    await ctx.reply("Разблокирован ID " + userId + " в " + brand(id).name);
  });

  return { dashboard, viewList, viewAllSessions, timeline, showAllReports,
    products: () => BRANDS.map(item => [item.name, store(item.id)]),
    close() { for (const [id, st] of stores) if (id !== "anon") st.close(); }
  };
}
