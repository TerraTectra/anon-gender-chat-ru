import { Bot, InlineKeyboard } from "grammy";
import { catalogLabel, createCatalogHandler } from "./catalog.js";
import { EngagementStore } from "./engagement-store.js";
import { parseStartSource } from "./tracking.js";
import { safeErrorSummary } from "./safe-error.js";

export const PARTY_PROMPTS = {
  would: [
    "Всегда говорить только правду или никогда не уметь объяснять свои решения?",
    "Получить возможность перематывать время на минуту назад или останавливать его на десять секунд?",
    "Отказаться на месяц от музыки или от коротких видео?",
    "Жить у моря без интернета или в центре мегаполиса без личного транспорта?",
    "Уметь идеально готовить любое блюдо или свободно говорить на пяти языках?"
  ],
  truth: [
    "Какое ваше маленькое достижение незаслуженно осталось незамеченным?",
    "Какой фильм или песню вы любите, хотя обычно стесняетесь это признавать?",
    "Какое первое впечатление о человеке оказалось у вас полностью ошибочным?",
    "Что вы давно хотите попробовать, но постоянно откладываете?",
    "Какой самый странный комплимент вы получали?"
  ],
  dare: [
    "За 20 секунд придумайте рекламный слоган для ближайшего предмета.",
    "Изобразите эмоцию без слов, а остальные пусть угадают её.",
    "Расскажите короткую историю, используя слова «лифт», «арбуз» и «детектив».",
    "Сделайте серьёзный прогноз погоды для комнаты, в которой находитесь.",
    "Назовите пять фильмов или игр на одну выбранную букву за 30 секунд."
  ],
  mime: [
    "Покажите человека, который впервые надел ролики.",
    "Покажите кота, который пытается открыть холодильник.",
    "Покажите опаздывающего волшебника.",
    "Покажите робота на первом свидании.",
    "Покажите ведущего новостей во время нашествия комаров."
  ],
  icebreaker: [
    "Какой навык вы бы загрузили в голову за одну секунду?",
    "Как выглядел бы ваш идеальный свободный день без ограничений?",
    "Какую вещь из детства стоило бы вернуть во взрослую жизнь?",
    "В какой вымышленной вселенной вы прожили бы неделю?",
    "Какой бесполезный факт вы почему-то отлично помните?"
  ],
  story: [
    "Начните историю словами: «Лифт остановился на этаже, которого не было на панели». Каждый добавляет ровно одно предложение.",
    "В истории обязательно должны появиться старый ключ, голосовое сообщение из будущего и человек, который всё время путает имена.",
    "Придумайте детектив за пять предложений. В последнем предложении должно выясниться, что главный подозреваемый всё это время помогал расследованию.",
    "Расскажите историю от лица кофейной кружки, которую случайно взяли на очень важную встречу.",
    "Соберите сказку по кругу: герой хочет вернуть потерянную тень, но каждый новый участник добавляет одно неожиданное правило мира."
  ],
  mostlikely: [
    "Кто скорее всех сможет договориться с роботом, который отказывается работать?",
    "Кто скорее всех случайно станет героем местных новостей?",
    "Кто скорее всех выживет неделю без телефона и даже получит удовольствие?",
    "Кто скорее всех придумает убедительную биографию вымышленному человеку за минуту?",
    "Кто скорее всех соберёт компанию на спонтанную поездку в тот же вечер?"
  ]
};

const LABELS = {
  would: "🤔 Выбери одно",
  truth: "💬 Правда",
  dare: "⚡ Действие",
  mime: "🎭 Крокодил",
  icebreaker: "🧊 Разговор",
  story: "📖 История",
  mostlikely: "👀 Кто скорее"
};

function menuKeyboard() {
  return new InlineKeyboard()
    .text("📅 Игра дня", "party:daily")
    .row()
    .text(LABELS.would, "party:pick:would")
    .text(LABELS.truth, "party:pick:truth")
    .row()
    .text(LABELS.dare, "party:pick:dare")
    .text(LABELS.mime, "party:pick:mime")
    .row()
    .text(LABELS.icebreaker, "party:pick:icebreaker")
    .text(LABELS.story, "party:pick:story")
    .row()
    .text(LABELS.mostlikely, "party:pick:mostlikely")
    .row()
    .text("📊 Моя статистика", "party:stats");
}

function moscowDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function dailyPartyPrompt(date = new Date()) {
  const entries = Object.entries(PARTY_PROMPTS).flatMap(([category, prompts]) =>
    prompts.map((prompt) => ({ category, prompt })));
  const key = moscowDate(date).replaceAll("-", "");
  const index = [...key].reduce((sum, value) => sum + Number(value), 0) % entries.length;
  return entries[index];
}

export function createPartyBot(token, dbPath, random = Math.random) {
  const store = new EngagementStore(dbPath);
  const bot = new Bot(token);
  const showCatalog = createCatalogHandler("party");

  function pick(category) {
    const prompts = PARTY_PROMPTS[category];
    return prompts[Math.floor(random() * prompts.length)];
  }

  async function showMenu(ctx, edit = false) {
    const text = "Tectra Party\n\nИгры и вопросы для компании, созвона или знакомства. Выберите режим.";
    const options = { reply_markup: menuKeyboard() };
    if (edit) return ctx.editMessageText(text, options);
    return ctx.reply(text, options);
  }

  async function showStats(ctx, edit = false) {
    const stats = store.userStats(ctx.from.id);
    const streak = store.activityStreak(ctx.from.id);
    const text = `Ваша статистика\n\nКарточек открыто: ${stats.actions}\nТекущая серия: ${streak.current} дн.\nЛучшая серия: ${streak.longest} дн.`;
    const options = { reply_markup: menuKeyboard() };
    if (edit) return ctx.editMessageText(text, options);
    return ctx.reply(text, options);
  }

  function promptKeyboard(ctx, category) {
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.from.id}`;
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Нашёл игру для компании в Tectra Party. Присоединяйся!")}`;
    return new InlineKeyboard()
      .text("Ещё", `party:pick:${category}`)
      .text("Режимы", "party:menu")
      .row()
      .url("Поделиться ↗", share);
  }

  async function showDaily(ctx, edit = false) {
    store.upsertUser(ctx.from.id, ctx.from.username);
    const daily = dailyPartyPrompt();
    store.recordUniqueAction(ctx.from.id, `daily_${moscowDate()}`);
    const streak = store.activityStreak(ctx.from.id);
    const text = `📅 Игра дня · ${LABELS[daily.category]}\n\n${daily.prompt}\n\nСерия активности: ${streak.current} дн.`;
    const options = { reply_markup: promptKeyboard(ctx, daily.category) };
    if (edit) return ctx.editMessageText(text, options);
    return ctx.reply(text, options);
  }

  bot.command("start", async (ctx) => {
    const source = parseStartSource(ctx.match, ctx.from.id);
    store.upsertUser(ctx.from.id, ctx.from.username, source);
    if (source?.includes("daily")) await showDaily(ctx);
    else await showMenu(ctx);
  });
  bot.command("play", (ctx) => showMenu(ctx));
  bot.command("daily", (ctx) => showDaily(ctx));
  bot.command("story", async (ctx) => {
    store.upsertUser(ctx.from.id, ctx.from.username);
    store.recordAction(ctx.from.id, "story");
    await ctx.reply(`${LABELS.story}\n\n${pick("story")}`, {
      reply_markup: new InlineKeyboard().text("Ещё сюжет", "party:pick:story").text("Режимы", "party:menu")
    });
  });
  bot.command("stats", (ctx) => showStats(ctx));
  bot.command("invite", async (ctx) => {
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.from.id}`;
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Игры и вопросы для компании")}`;
    await ctx.reply(`Ваша ссылка:\n${link}\n\nПриглашено: ${store.invitedCount(ctx.from.id)}`, { reply_markup: new InlineKeyboard().url("Поделиться ↗", share).row().text("К играм", "party:menu") });
  });
  bot.command("help", (ctx) => showMenu(ctx));
  bot.command("bots", showCatalog);
  bot.hears(catalogLabel, showCatalog);

  bot.callbackQuery("party:menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMenu(ctx, true);
  });
  bot.callbackQuery("party:stats", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showStats(ctx, true);
  });
  bot.callbackQuery("party:daily", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showDaily(ctx, true);
  });
  bot.callbackQuery(/^party:pick:(would|truth|dare|mime|icebreaker|story|mostlikely)$/, async (ctx) => {
    const category = ctx.match[1];
    store.recordAction(ctx.from.id, category);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`${LABELS[category]}\n\n${pick(category)}`, {
      reply_markup: promptKeyboard(ctx, category)
    });
  });

  bot.catch((error) => console.error("Party bot error", safeErrorSummary(error)));
  return bot;
}
