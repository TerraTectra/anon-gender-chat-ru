import { Bot, InlineKeyboard, session } from "grammy";
import { catalogLabel, createCatalogHandler } from "./catalog.js";
import { EngagementStore } from "./engagement-store.js";
import { PARTY_PROMPTS } from "./party-bot.js";
import { parseStartSource } from "./tracking.js";
import { safeErrorSummary } from "./safe-error.js";

export const QUIZ_QUESTIONS = [
  { id: "venus", text: "Какая планета вращается вокруг своей оси в направлении, противоположном большинству планет?", options: ["Марс", "Венера", "Юпитер", "Меркурий"], correct: 1, explanation: "Венера вращается ретроградно: Солнце там восходит на западе." },
  { id: "octopus", text: "Сколько сердец у осьминога?", options: ["Одно", "Два", "Три", "Восемь"], correct: 2, explanation: "У осьминога три сердца: одно системное и два жаберных." },
  { id: "chess", text: "Сколько клеток на стандартной шахматной доске?", options: ["56", "64", "72", "81"], correct: 1, explanation: "Доска состоит из 8 x 8 клеток, всего 64." },
  { id: "sound", text: "Где звук распространяется быстрее всего?", options: ["В вакууме", "В воздухе", "В воде", "В стали"], correct: 3, explanation: "В твёрдых телах частицы связаны плотнее, поэтому в стали звук идёт быстрее." },
  { id: "largest_desert", text: "Какая пустыня самая большая на Земле?", options: ["Сахара", "Гоби", "Антарктическая", "Аравийская"], correct: 2, explanation: "Пустыня определяется осадками, поэтому Антарктическая пустыня крупнейшая." },
  { id: "dna", text: "Что хранит наследственную информацию большинства живых организмов?", options: ["АТФ", "ДНК", "Глюкоза", "Кальций"], correct: 1, explanation: "Основным носителем наследственной информации служит ДНК." },
  { id: "light", text: "Примерно за сколько времени свет от Солнца достигает Земли?", options: ["8 секунд", "8 минут", "80 минут", "8 часов"], correct: 1, explanation: "Среднее время пути солнечного света до Земли около 8 минут 20 секунд." },
  { id: "languages", text: "Какой язык имеет больше всего носителей как родной?", options: ["Английский", "Испанский", "Хинди", "Китайский мандарин"], correct: 3, explanation: "По числу носителей как родного лидирует китайский мандарин." },
  { id: "paper", text: "В какой стране впервые изобрели бумагу?", options: ["Египет", "Китай", "Греция", "Индия"], correct: 1, explanation: "Технологию изготовления бумаги связывают с древним Китаем." },
  { id: "binary", text: "Какое десятичное число записывается в двоичной системе как 1010?", options: ["8", "9", "10", "12"], correct: 2, explanation: "1010 = 8 + 2 = 10." },
  { id: "whale", text: "Какое животное считается крупнейшим из когда-либо живших на Земле?", options: ["Тираннозавр", "Синий кит", "Мегалодон", "Африканский слон"], correct: 1, explanation: "Синий кит превосходит по массе всех известных животных прошлого и настоящего." },
  { id: "temperature", text: "При какой температуре по Цельсию вода замерзает при нормальном давлении?", options: ["-10", "0", "10", "32"], correct: 1, explanation: "При нормальном атмосферном давлении точка замерзания воды равна 0 °C." }
];

function menuKeyboard() {
  return new InlineKeyboard()
    .text("📅 Вопрос дня", "quiz:daily")
    .row()
    .text("🧠 Новый вопрос", "quiz:next")
    .text("🏆 Мой счёт", "quiz:score")
    .row()
    .text("🎉 Игры для компании", "quiz:party:menu")
    .row()
    .text("🎁 Пригласить друга", "quiz:invite");
}

const PARTY_LABELS = {
  would: "🤔 Выбери одно",
  truth: "💬 Правда",
  dare: "⚡ Действие",
  mime: "🎭 Крокодил",
  icebreaker: "🧊 Разговор"
};

function partyKeyboard() {
  return new InlineKeyboard()
    .text(PARTY_LABELS.would, "quiz:party:would")
    .text(PARTY_LABELS.truth, "quiz:party:truth")
    .row()
    .text(PARTY_LABELS.dare, "quiz:party:dare")
    .text(PARTY_LABELS.mime, "quiz:party:mime")
    .row()
    .text(PARTY_LABELS.icebreaker, "quiz:party:icebreaker")
    .row()
    .text("К квизу", "quiz:home");
}

function questionKeyboard(question) {
  const keyboard = new InlineKeyboard();
  question.options.forEach((option, index) => keyboard.text(option, `quiz:answer:${question.id}:${index}`).row());
  return keyboard;
}

function moscowDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function dailyQuestionFor(date = new Date()) {
  const key = moscowDate(date).replaceAll("-", "");
  const index = [...key].reduce((sum, value) => sum + Number(value), 0) % QUIZ_QUESTIONS.length;
  return QUIZ_QUESTIONS[index];
}

export function createQuizBot(token, dbPath, random = Math.random) {
  const store = new EngagementStore(dbPath);
  const bot = new Bot(token);
  const showCatalog = createCatalogHandler("quiz");
  bot.use(session({ initial: () => ({ questionId: null, lastQuestionId: null }) }));

  function pickQuestion(lastQuestionId) {
    const available = QUIZ_QUESTIONS.filter((question) => question.id !== lastQuestionId);
    return available[Math.floor(random() * available.length)];
  }

  async function sendQuestion(ctx, edit = false) {
    const question = pickQuestion(ctx.session.lastQuestionId);
    ctx.session.questionId = question.id;
    ctx.session.lastQuestionId = question.id;
    const text = `Вопрос\n\n${question.text}`;
    const options = { reply_markup: questionKeyboard(question) };
    if (edit) return ctx.editMessageText(text, options);
    return ctx.reply(text, options);
  }

  async function sendDailyQuestion(ctx, edit = false) {
    const question = dailyQuestionFor();
    const text = `Вопрос дня\n\n${question.text}`;
    const options = { reply_markup: questionKeyboard({ ...question, id: `daily_${question.id}` }) };
    if (edit) return ctx.editMessageText(text, options);
    return ctx.reply(text, options);
  }

  async function sendScore(ctx, edit = false) {
    const stats = store.quizStats(ctx.from.id);
    const streak = store.activityStreak(ctx.from.id);
    const text = `Ваш результат\n\nОтветов: ${stats.actions}\nПравильных: ${stats.score}\nТекущая серия: ${streak.current} дн.\nЛучшая серия: ${streak.longest} дн.`;
    const options = { reply_markup: menuKeyboard() };
    if (edit) return ctx.editMessageText(text, options);
    return ctx.reply(text, options);
  }

  function resultKeyboard(ctx) {
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.from.id}`;
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Я прошёл вопрос в Tectra Quiz. Сможешь ответить лучше?")}`;
    return new InlineKeyboard()
      .text("Следующий вопрос", "quiz:next")
      .text("Мой счёт", "quiz:score")
      .row()
      .url("Поделиться ↗", share);
  }

  async function sendInvite(ctx, edit = false) {
    const link = `https://t.me/${ctx.me.username}?start=ref_${ctx.from.id}`;
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Сыграем в короткий квиз?")}`;
    const text = `Ваша ссылка:\n${link}\n\nПриглашено: ${store.invitedCount(ctx.from.id)}`;
    const options = { reply_markup: new InlineKeyboard().url("Поделиться ↗", share).row().text("К игре", "quiz:next") };
    if (edit) return ctx.editMessageText(text, options);
    return ctx.reply(text, options);
  }

  bot.command("start", async (ctx) => {
    const source = parseStartSource(ctx.match, ctx.from.id);
    store.upsertUser(ctx.from.id, ctx.from.username, source);
    if (source?.includes("daily")) await sendDailyQuestion(ctx);
    else await ctx.reply("Tectra Quiz\n\nКороткие вопросы на кругозор. За каждый правильный ответ начисляется один балл.", { reply_markup: menuKeyboard() });
  });
  bot.command("quiz", (ctx) => sendQuestion(ctx));
  bot.command("daily", async (ctx) => {
    store.upsertUser(ctx.from.id, ctx.from.username);
    await sendDailyQuestion(ctx);
  });
  bot.command("party", (ctx) => ctx.reply("Игры и вопросы для компании. Выберите режим.", { reply_markup: partyKeyboard() }));
  bot.command("score", (ctx) => sendScore(ctx));
  bot.command("invite", (ctx) => sendInvite(ctx));
  bot.command("help", (ctx) => ctx.reply("Нажмите «Новый вопрос», выберите ответ и сразу получите объяснение.", { reply_markup: menuKeyboard() }));
  bot.command("bots", showCatalog);
  bot.hears(catalogLabel, showCatalog);

  bot.callbackQuery("quiz:next", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendQuestion(ctx, true);
  });
  bot.callbackQuery("quiz:daily", async (ctx) => {
    const action = `daily_${moscowDate()}`;
    if (store.hasAction(ctx.from.id, action)) await ctx.answerCallbackQuery("Сегодня уже отвечали");
    else await ctx.answerCallbackQuery();
    await sendDailyQuestion(ctx, true);
  });
  bot.callbackQuery("quiz:home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Tectra Quiz\n\nКороткие вопросы на кругозор и игры для компании.", { reply_markup: menuKeyboard() });
  });
  bot.callbackQuery("quiz:party:menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Игры и вопросы для компании. Выберите режим.", { reply_markup: partyKeyboard() });
  });
  bot.callbackQuery(/^quiz:party:(would|truth|dare|mime|icebreaker)$/, async (ctx) => {
    const category = ctx.match[1];
    const prompts = PARTY_PROMPTS[category];
    const prompt = prompts[Math.floor(random() * prompts.length)];
    store.recordAction(ctx.from.id, `party_${category}`);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`${PARTY_LABELS[category]}\n\n${prompt}`, {
      reply_markup: new InlineKeyboard().text("Ещё", `quiz:party:${category}`).text("Режимы", "quiz:party:menu")
    });
  });
  bot.callbackQuery("quiz:score", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendScore(ctx, true);
  });
  bot.callbackQuery("quiz:invite", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendInvite(ctx, true);
  });
  bot.callbackQuery(/^quiz:answer:([a-z_]+):(\d+)$/, async (ctx) => {
    const daily = ctx.match[1].startsWith("daily_");
    const questionId = daily ? ctx.match[1].slice(6) : ctx.match[1];
    const question = QUIZ_QUESTIONS.find((item) => item.id === questionId
      && (daily ? dailyQuestionFor().id === item.id : item.id === ctx.session.questionId));
    if (!question) return ctx.answerCallbackQuery("Этот вопрос уже закрыт");
    const answer = Number(ctx.match[2]);
    const correct = answer === question.correct;
    if (daily) {
      const recorded = store.recordUniqueAction(ctx.from.id, `daily_${moscowDate()}`, correct ? 1 : 0);
      if (!recorded) return ctx.answerCallbackQuery("Сегодняшний результат уже сохранён");
    } else {
      store.recordAction(ctx.from.id, "answer", correct ? 1 : 0);
    }
    ctx.session.questionId = null;
    const streak = store.activityStreak(ctx.from.id);
    await ctx.answerCallbackQuery(correct ? "Верно!" : "Не совсем");
    await ctx.editMessageText(`${correct ? "✅ Верно" : `❌ Правильный ответ: ${question.options[question.correct]}`}\n\n${question.explanation}\n\nСерия активности: ${streak.current} дн.`, { reply_markup: resultKeyboard(ctx) });
  });

  bot.catch((error) => console.error("Quiz bot error", safeErrorSummary(error)));
  return bot;
}
