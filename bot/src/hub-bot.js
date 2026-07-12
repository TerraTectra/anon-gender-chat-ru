import { Bot, InlineKeyboard, session } from "grammy";
import { HubStore } from "./hub-store.js";
import { categories, productLink, products, productsByCategory } from "./products.js";
import { parseStartSource } from "./tracking.js";

function homeKeyboard() {
  const keyboard = new InlineKeyboard();
  for (const category of categories) keyboard.text(category.label, `hub:category:${category.id}`).row();
  return keyboard
    .text("✨ Подобрать за меня", "hub:recommend")
    .text("📚 Все боты", "hub:category:all")
    .row()
    .text("💡 Предложить нового бота", "hub:suggest");
}

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
  bot.use(session({ initial: () => ({ waitingSuggestion: false }) }));

  async function showHome(ctx, edit = false) {
    const text = "TerraTectra Bots\n\nПолезные Telegram-боты в одном месте. Выберите, что пригодится прямо сейчас.";
    const options = { reply_markup: homeKeyboard() };
    if (edit) return ctx.editMessageText(text, options);
    return ctx.reply(text, options);
  }

  bot.command("start", async (ctx) => {
    store.upsertUser(ctx.from.id, ctx.from.username, parseStartSource(ctx.match, ctx.from.id));
    ctx.session.waitingSuggestion = false;
    await showHome(ctx);
  });
  bot.command("catalog", (ctx) => showHome(ctx));
  bot.command("help", (ctx) => ctx.reply("Выберите категорию или попросите подобрать бота. Каталог будет пополняться только проверенными полезными сервисами.", { reply_markup: homeKeyboard() }));

  bot.callbackQuery("hub:home", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.waitingSuggestion = false;
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
    const selected = products[(ctx.from.id + Date.now()) % products.length];
    await ctx.editMessageText(`Сегодня попробуйте:\n\n${selected.icon} ${selected.name}\n${selected.tagline}\n\n${selected.description}`, {
      reply_markup: new InlineKeyboard()
        .url("Открыть бота ↗", productLink(selected, "src_hub_recommend"))
        .row()
        .text("Другой вариант", "hub:recommend")
        .text("← В меню", "hub:home")
    });
  });

  bot.callbackQuery(/^hub:product:(\w+)$/, async (ctx) => {
    const product = products.find((item) => item.id === ctx.match[1]);
    if (!product) return ctx.answerCallbackQuery("Бот не найден");
    store.recordOpen(ctx.from.id, product.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`${product.icon} ${product.name}\n\n${product.tagline}\n\n${product.description}`, {
      reply_markup: new InlineKeyboard()
        .url("Открыть бота ↗", productLink(product, "src_hub_card"))
        .row()
        .text("← К списку", `hub:category:${product.category}`)
        .text("В меню", "hub:home")
    });
  });

  bot.callbackQuery("hub:suggest", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.waitingSuggestion = true;
    await ctx.editMessageText("Какого полезного бота вам не хватает? Опишите задачу одним сообщением.", {
      reply_markup: new InlineKeyboard().text("Отмена", "hub:home")
    });
  });

  bot.on("message:text", async (ctx) => {
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
