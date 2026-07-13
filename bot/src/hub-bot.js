import { Bot, InlineKeyboard, session } from "grammy";
import { HubStore } from "./hub-store.js";
import { categories, productLink, products, productsByCategory, recommendationIntents, searchProducts } from "./products.js";
import { parseStartSource } from "./tracking.js";

function homeKeyboard() {
  const keyboard = new InlineKeyboard();
  for (const category of categories) keyboard.text(category.label, `hub:category:${category.id}`).row();
  return keyboard
    .text("✨ Подобрать за меня", "hub:recommend")
    .text("📚 Все боты", "hub:category:all")
    .row()
    .text("🔥 Популярное", "hub:popular")
    .text("⭐ Мои боты", "hub:favorites")
    .row()
    .text("🔎 Найти по задаче", "hub:search")
    .row()
    .text("🛠 Заказать бота для бизнеса", "hub:lead:start")
    .row()
    .text("🎁 Поделиться хабом", "hub:invite")
    .row()
    .text("💡 Предложить нового бота", "hub:suggest");
}

const leadBudgetKeyboard = new InlineKeyboard()
  .text("До 30 000 ₽", "hub:lead:budget:30")
  .text("30–70 000 ₽", "hub:lead:budget:70")
  .row()
  .text("70–150 000 ₽", "hub:lead:budget:150")
  .text("Обсудить", "hub:lead:budget:talk")
  .row()
  .text("Отмена", "hub:home");

const leadDeadlineKeyboard = new InlineKeyboard()
  .text("1–2 недели", "hub:lead:deadline:fast")
  .text("До месяца", "hub:lead:deadline:month")
  .row()
  .text("Срок гибкий", "hub:lead:deadline:flexible")
  .row()
  .text("Отмена", "hub:home");

function productKeyboard(items) {
  const keyboard = new InlineKeyboard();
  for (const product of items) {
    keyboard
      .text(`${product.icon} ${product.name}`, `hub:product:${product.id}`)
      .url("Открыть ↗", productLink(product, "src_hub"))
      .row();
  }
  return keyboard.text("← В главное меню", "hub:home");
}

function recommendationKeyboard() {
  const keyboard = new InlineKeyboard();
  for (const intent of recommendationIntents) keyboard.text(intent.label, `hub:recommend:${intent.id}`).row();
  return keyboard.text("← В главное меню", "hub:home");
}

function categoryText(category) {
  const selected = productsByCategory(category);
  const heading = category === "all"
    ? "Все боты семейства"
    : categories.find((item) => item.id === category)?.label || "Боты";
  return `${heading}\n\n${selected.map((product) => `${product.icon} ${product.name}\n${product.tagline}`).join("\n\n")}`;
}

export function createHubBot(token, dbPath) {
  const store = new HubStore(dbPath);
  const bot = new Bot(token);
  bot.use(session({ initial: () => ({ waitingSuggestion: false, waitingSearch: false, leadStep: null, leadDraft: null, startSource: null }) }));

  async function startLead(ctx, edit = false) {
    ctx.session.waitingSuggestion = false;
    ctx.session.waitingSearch = false;
    ctx.session.leadStep = "request";
    ctx.session.leadDraft = {};
    const text = "Разработаем Telegram-бота или автоматизацию под вашу задачу.\n\nКоротко опишите бизнес, процесс и желаемый результат.";
    const options = { reply_markup: new InlineKeyboard().text("Отмена", "hub:home") };
    if (edit) return ctx.editMessageText(text, options);
    return ctx.reply(text, options);
  }

  function productCardKeyboard(userId, product, source = "src_hub_card") {
    const favorite = store.isFavorite(userId, product.id);
    return new InlineKeyboard()
      .url("Открыть бота ↗", productLink(product, source))
      .row()
      .text(favorite ? "★ Убрать из моих" : "☆ Добавить в мои", `hub:favorite:${product.id}`)
      .row()
      .text("← К списку", `hub:category:${product.category}`)
      .text("В меню", "hub:home");
  }

  async function showHome(ctx, edit = false) {
    const text = "TerraTectra Bots\n\nПолезные Telegram-боты в одном месте. Выберите, что пригодится прямо сейчас.";
    const options = { reply_markup: homeKeyboard() };
    if (edit) return ctx.editMessageText(text, options);
    return ctx.reply(text, options);
  }

  bot.command("start", async (ctx) => {
    const source = parseStartSource(ctx.match, ctx.from.id);
    store.upsertUser(ctx.from.id, ctx.from.username, source);
    ctx.session.startSource = source;
    ctx.session.waitingSuggestion = false;
    ctx.session.waitingSearch = false;
    if (source?.includes("lead")) await startLead(ctx);
    else await showHome(ctx);
  });
  bot.command("catalog", (ctx) => showHome(ctx));
  bot.command("favorites", async (ctx) => {
    const items = store.favoriteIds(ctx.from.id).map((id) => products.find((product) => product.id === id)).filter(Boolean);
    if (!items.length) return ctx.reply("В избранном пока пусто. Откройте карточку бота и нажмите «Добавить в мои».", { reply_markup: homeKeyboard() });
    return ctx.reply(`Мои боты\n\n${items.map((product) => `${product.icon} ${product.name}\n${product.tagline}`).join("\n\n")}`, { reply_markup: productKeyboard(items) });
  });
  bot.command("invite", async (ctx) => {
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.from.id}`;
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Полезные Telegram-боты для общения, задач, фокуса и финансов")}`;
    await ctx.reply(`Ваша ссылка:\n${link}\n\nПриглашено пользователей: ${store.invitedCount(ctx.from.id)}.`, {
      reply_markup: new InlineKeyboard().url("Поделиться ↗", share).row().text("← В главное меню", "hub:home")
    });
  });
  bot.command("help", (ctx) => ctx.reply("Выберите категорию или попросите подобрать бота. Каталог будет пополняться только проверенными полезными сервисами.", { reply_markup: homeKeyboard() }));

  bot.callbackQuery("hub:home", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.waitingSuggestion = false;
    ctx.session.waitingSearch = false;
    ctx.session.leadStep = null;
    ctx.session.leadDraft = null;
    await showHome(ctx, true);
  });

  bot.callbackQuery(/^hub:category:(\w+)$/, async (ctx) => {
    const category = ctx.match[1];
    const selected = productsByCategory(category);
    if (!selected.length) return ctx.answerCallbackQuery("Категория пока пуста");
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(categoryText(category), { reply_markup: productKeyboard(selected) });
  });

  bot.callbackQuery("hub:recommend", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Что хотите сделать прямо сейчас?", { reply_markup: recommendationKeyboard() });
  });

  bot.callbackQuery(/^hub:recommend:(\w+)$/, async (ctx) => {
    const intent = recommendationIntents.find((item) => item.id === ctx.match[1]);
    const selected = products.find((product) => product.id === intent?.productId);
    if (!selected) return ctx.answerCallbackQuery("Подходящий бот не найден");
    store.recordOpen(ctx.from.id, selected.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`Подойдёт лучше всего:\n\n${selected.icon} ${selected.name}\n${selected.tagline}\n\n${selected.description}`, {
      reply_markup: productCardKeyboard(ctx.from.id, selected, "src_hub_recommend")
    });
  });

  bot.callbackQuery("hub:popular", async (ctx) => {
    await ctx.answerCallbackQuery();
    const ranked = store.popularProducts();
    const selected = ranked
      .map((row) => products.find((product) => product.id === row.product_id))
      .filter(Boolean);
    const items = selected.length ? selected : products.slice(0, 3);
    await ctx.editMessageText(`Популярное в TerraTectra Bots\n\n${items.map((product, index) => `${index + 1}. ${product.icon} ${product.name}\n${product.tagline}`).join("\n\n")}`, {
      reply_markup: productKeyboard(items)
    });
  });

  bot.callbackQuery("hub:invite", async (ctx) => {
    await ctx.answerCallbackQuery();
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.from.id}`;
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Полезные Telegram-боты для общения, задач, фокуса и финансов")}`;
    await ctx.editMessageText(`Поделитесь семейным хабом.\n\nВаша ссылка:\n${link}\n\nПриглашено пользователей: ${store.invitedCount(ctx.from.id)}.`, {
      reply_markup: new InlineKeyboard().url("Поделиться ↗", share).row().text("← В главное меню", "hub:home")
    });
  });

  bot.callbackQuery("hub:favorites", async (ctx) => {
    await ctx.answerCallbackQuery();
    const items = store.favoriteIds(ctx.from.id).map((id) => products.find((product) => product.id === id)).filter(Boolean);
    if (!items.length) {
      return ctx.editMessageText("В избранном пока пусто. Откройте карточку бота и нажмите «Добавить в мои».", {
        reply_markup: new InlineKeyboard().text("← В главное меню", "hub:home")
      });
    }
    await ctx.editMessageText(`Мои боты\n\n${items.map((product) => `${product.icon} ${product.name}\n${product.tagline}`).join("\n\n")}`, {
      reply_markup: productKeyboard(items)
    });
  });

  bot.callbackQuery("hub:search", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.waitingSearch = true;
    ctx.session.waitingSuggestion = false;
    await ctx.editMessageText("Опишите, что вам нужно. Например: «напомнить о деле», «практика английского» или «найти тиммейта».", {
      reply_markup: new InlineKeyboard().text("Отмена", "hub:home")
    });
  });

  bot.callbackQuery("hub:lead:start", async (ctx) => {
    await ctx.answerCallbackQuery();
    await startLead(ctx, true);
  });

  bot.callbackQuery(/^hub:lead:budget:(30|70|150|talk)$/, async (ctx) => {
    if (ctx.session.leadStep !== "budget" || !ctx.session.leadDraft?.request) return ctx.answerCallbackQuery("Заявка уже закрыта");
    const budgets = { "30": "до 30 000 ₽", "70": "30–70 000 ₽", "150": "70–150 000 ₽", talk: "обсудить" };
    ctx.session.leadDraft.budget = budgets[ctx.match[1]];
    ctx.session.leadStep = "deadline";
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Какой срок запуска комфортен?", { reply_markup: leadDeadlineKeyboard });
  });

  bot.callbackQuery(/^hub:lead:deadline:(fast|month|flexible)$/, async (ctx) => {
    if (ctx.session.leadStep !== "deadline" || !ctx.session.leadDraft?.budget) return ctx.answerCallbackQuery("Заявка уже закрыта");
    const deadlines = { fast: "1–2 недели", month: "до месяца", flexible: "гибкий" };
    const lead = store.addLead(
      ctx.from.id,
      ctx.from.username,
      ctx.session.leadDraft.request,
      ctx.session.leadDraft.budget,
      deadlines[ctx.match[1]],
      ctx.session.startSource
    );
    ctx.session.leadStep = null;
    ctx.session.leadDraft = null;
    await ctx.answerCallbackQuery("Заявка отправлена");
    await ctx.editMessageText(`Заявка #${lead.id} принята.\n\nМы изучим задачу и свяжемся с вами в Telegram.`, {
      reply_markup: new InlineKeyboard().text("← В главное меню", "hub:home")
    });
  });

  bot.callbackQuery(/^hub:product:(\w+)$/, async (ctx) => {
    const product = products.find((item) => item.id === ctx.match[1]);
    if (!product) return ctx.answerCallbackQuery("Бот не найден");
    store.recordOpen(ctx.from.id, product.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`${product.icon} ${product.name}\n\n${product.tagline}\n\n${product.description}`, {
      reply_markup: productCardKeyboard(ctx.from.id, product)
    });
  });

  bot.callbackQuery(/^hub:favorite:(\w+)$/, async (ctx) => {
    const product = products.find((item) => item.id === ctx.match[1]);
    if (!product) return ctx.answerCallbackQuery("Бот не найден");
    const favorite = store.toggleFavorite(ctx.from.id, product.id);
    await ctx.answerCallbackQuery(favorite ? "Добавлено в мои боты" : "Убрано из моих ботов");
    await ctx.editMessageText(`${product.icon} ${product.name}\n\n${product.tagline}\n\n${product.description}`, {
      reply_markup: productCardKeyboard(ctx.from.id, product)
    });
  });

  bot.callbackQuery("hub:suggest", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.waitingSuggestion = true;
    ctx.session.waitingSearch = false;
    await ctx.editMessageText("Какого полезного бота вам не хватает? Опишите задачу одним сообщением.", {
      reply_markup: new InlineKeyboard().text("Отмена", "hub:home")
    });
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.session.leadStep === "request") {
      const request = ctx.message.text.trim().replace(/\s+/g, " ");
      if (request.length < 20 || request.length > 1000) return ctx.reply("Опишите задачу текстом от 20 до 1000 символов.");
      ctx.session.leadDraft = { request };
      ctx.session.leadStep = "budget";
      return ctx.reply("Какой ориентир по бюджету?", { reply_markup: leadBudgetKeyboard });
    }
    if (ctx.session.waitingSearch) {
      const query = ctx.message.text.trim().replace(/\s+/g, " ");
      if (query.length < 3 || query.length > 200) return ctx.reply("Опишите задачу текстом от 3 до 200 символов.");
      const items = searchProducts(query).slice(0, 4);
      ctx.session.waitingSearch = false;
      if (!items.length) {
        return ctx.reply("Подходящего бота пока нет. Можно предложить идею через кнопку в главном меню.", { reply_markup: homeKeyboard() });
      }
      return ctx.reply(`Подходящие боты\n\n${items.map((product) => `${product.icon} ${product.name}\n${product.tagline}`).join("\n\n")}`, {
        reply_markup: productKeyboard(items)
      });
    }
    if (!ctx.session.waitingSuggestion) return showHome(ctx);
    const suggestion = ctx.message.text.trim().replace(/\s+/g, " ");
    if (suggestion.length < 5 || suggestion.length > 500) {
      return ctx.reply("Опишите идею текстом от 5 до 500 символов.");
    }
    store.upsertUser(ctx.from.id, ctx.from.username);
    store.addSuggestion(ctx.from.id, suggestion);
    ctx.session.waitingSuggestion = false;
    await ctx.reply("Спасибо. Идея сохранена и попадёт в список кандидатов на следующий бот.", { reply_markup: homeKeyboard() });
  });

  bot.catch((error) => console.error("Hub bot error", error.error));
  return bot;
}
