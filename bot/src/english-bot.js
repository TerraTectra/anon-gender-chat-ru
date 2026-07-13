import { Bot, InlineKeyboard, Keyboard, session } from "grammy";
import { LanguageStore } from "./language-store.js";
import { catalogLabel, showCatalog } from "./catalog.js";
import { parseStartSource } from "./tracking.js";
import { inviteKeyboard } from "./referrals.js";

const labels = {
  search: "🗣 Find a partner",
  next: "⏭ Next partner",
  stop: "⛔ Stop chat",
  report: "🚩 Report",
  profile: "👤 Profile",
  stats: "📊 Statistics",
  invite: "🎁 Invite a friend",
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
  .text("12-17", "english_age:minor")
  .text("18+", "english_age:adult");

const levelKeyboard = new InlineKeyboard()
  .text("A1-A2", "english_level:beginner")
  .text("B1-B2", "english_level:intermediate")
  .text("C1-C2", "english_level:advanced");

const reportKeyboard = new InlineKeyboard()
  .text("Send report", "english_report:confirm")
  .text("Cancel", "english_report:cancel");

const levelName = {
  beginner: "A1-A2",
  intermediate: "B1-B2",
  advanced: "C1-C2"
};

const profileReady = (user) => Boolean(user?.age_group && user?.level);

export function createEnglishBot(token, dbPath) {
  const store = new LanguageStore(dbPath);
  const bot = new Bot(token);
  bot.use(session({ initial: () => ({ pendingReportId: null }) }));

  bot.use(async (ctx, next) => {
    if (ctx.from && store.isBanned(ctx.from.id)) {
      if (ctx.message?.text === "/start") await ctx.reply("Your access has been restricted by an administrator.");
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
      await ctx.reply("Choose your age group. Users under 18 are matched only with other users under 18.", { reply_markup: ageKeyboard });
      return;
    }
    await ctx.reply("Ready for English practice. Choose an action.", { reply_markup: menu });
  }

  async function startSearch(ctx) {
    const user = store.getUser(ctx.from.id);
    if (!profileReady(user)) return showMenu(ctx);
    store.recordEvent(ctx.from.id, "search");
    const result = store.enqueue(ctx.from.id);
    if (result.status === "matched") {
      store.recordEvent(ctx.from.id, "match");
      const message = "Partner found. Start speaking English. Be respectful and do not share private information.";
      await ctx.reply(message, { reply_markup: menu });
      await ctx.api.sendMessage(result.partnerId, message, { reply_markup: menu }).catch(() => {});
      return;
    }
    await ctx.reply("Looking for a partner near your level. I will notify you when someone joins.", { reply_markup: menu });
  }

  async function stopChat(ctx) {
    const user = store.getUser(ctx.from.id);
    const partnerId = store.disconnect(ctx.from.id);
    const message = partnerId ? "Chat ended." : user?.state === "searching" ? "Search stopped." : "You are not in a chat or search queue.";
    await ctx.reply(message, { reply_markup: menu });
    await notifyPartner(ctx, partnerId, "Your partner ended the chat.");
  }

  async function nextPartner(ctx) {
    const partnerId = store.disconnect(ctx.from.id);
    await notifyPartner(ctx, partnerId, "Your partner moved to the next chat.");
    await startSearch(ctx);
  }

  async function showProfile(ctx) {
    const user = store.getUser(ctx.from.id);
    if (!profileReady(user)) return showMenu(ctx);
    const group = user.age_group === "minor" ? "12-17" : "18+";
    await ctx.reply(`Your profile: ${group}, English ${levelName[user.level]}.\nUse /reset to change it.`, { reply_markup: menu });
  }

  async function showStats(ctx) {
    const stats = store.stats();
    await ctx.reply(`Searching now: ${stats.searching}.\nActive conversations: ${stats.chatting}.\nLearners: ${stats.users}.`, { reply_markup: menu });
  }

  async function showInvite(ctx) {
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.from.id}`;
    await ctx.reply(`Your invite link:\n${link}\n\nFriends invited: ${store.invitedCount(ctx.from.id)}. More learners means faster matching.`, { reply_markup: inviteKeyboard(link, "Find a speaking partner for English practice") });
  }

  async function beginReport(ctx) {
    const user = store.getUser(ctx.from.id);
    if (!user?.partner_id) {
      await ctx.reply("There is no active partner to report.", { reply_markup: menu });
      return;
    }
    ctx.session.pendingReportId = user.partner_id;
    await ctx.reply("The chat will end and this person will never be matched with you again.", { reply_markup: reportKeyboard });
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
  bot.command("rules", (ctx) => ctx.reply("Speak respectfully. No harassment, sexual content involving minors, spam, threats, or requests for private data. Use Report when needed.", { reply_markup: menu }));
  bot.command("catalog", showCatalog);

  bot.command("reset", async (ctx) => {
    store.upsertUser(ctx.from.id, ctx.from.username);
    const partnerId = store.disconnect(ctx.from.id);
    await notifyPartner(ctx, partnerId, "Your partner ended the chat.");
    store.setProfile(ctx.from.id, { age_group: null, level: null, state: "idle" });
    await ctx.reply("Profile reset. Choose your age group.", { reply_markup: ageKeyboard });
  });

  bot.callbackQuery(/^english_age:(minor|adult)$/, async (ctx) => {
    store.upsertUser(ctx.from.id, ctx.from.username);
    store.setProfile(ctx.from.id, { age_group: ctx.match[1] });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Choose your current English level.", { reply_markup: levelKeyboard });
  });

  bot.callbackQuery(/^english_level:(beginner|intermediate|advanced)$/, async (ctx) => {
    store.setProfile(ctx.from.id, { level: ctx.match[1], state: "idle" });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`Profile ready: English ${levelName[ctx.match[1]]}.`);
    await ctx.reply("Choose an action.", { reply_markup: menu });
  });

  bot.callbackQuery("english_report:cancel", async (ctx) => {
    ctx.session.pendingReportId = null;
    await ctx.answerCallbackQuery("Cancelled");
    await ctx.editMessageText("Report cancelled.");
  });

  bot.callbackQuery("english_report:confirm", async (ctx) => {
    const reportedId = ctx.session.pendingReportId;
    if (!reportedId) {
      await ctx.answerCallbackQuery("Partner already disconnected");
      return;
    }
    store.reportAndBlock(ctx.from.id, reportedId);
    store.recordEvent(ctx.from.id, "report");
    ctx.session.pendingReportId = null;
    await ctx.answerCallbackQuery("Report sent");
    await ctx.editMessageText("Report sent. This user will not be matched with you again.");
    await notifyPartner(ctx, reportedId, "Your partner ended the chat.");
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
    const user = store.getUser(ctx.from.id);
    if (!user?.partner_id) {
      await ctx.reply("Find a partner first.", { reply_markup: menu });
      return;
    }
    await ctx.api.copyMessage(user.partner_id, ctx.chat.id, ctx.message.message_id).catch(async () => {
      store.disconnect(ctx.from.id);
      await ctx.reply("The message could not be delivered. Your partner may have blocked the bot.", { reply_markup: menu });
    });
  });

  bot.on(["message:photo", "message:video", "message:voice", "message:video_note", "message:document", "message:sticker", "message:animation"], async (ctx) => {
    const user = store.getUser(ctx.from.id);
    if (!user?.partner_id) {
      await ctx.reply("There is no active partner.", { reply_markup: menu });
      return;
    }
    await ctx.api.copyMessage(user.partner_id, ctx.chat.id, ctx.message.message_id).catch(() => store.disconnect(ctx.from.id));
  });

  bot.catch((error) => console.error("English bot error", error.error));
  return bot;
}
