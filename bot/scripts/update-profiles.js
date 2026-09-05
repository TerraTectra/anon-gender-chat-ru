import "dotenv/config";

const profiles = [
  ["BOT_TOKEN", "Анонимный чат один на один: случайный и фильтрованный поиск, возрастные группы 12-17 и 18+ разделены.", "Безопасное анонимное общение один на один 12+."],
  ["ADMIN_BOT_TOKEN", "Приватный центр управления TerraTectra: боты, активные и медиасессии анонимного чата, каналы, источники, лиды и состояние системы.", "Приватная аналитика и управление TerraTectra."],
  ["ENGLISH_BOT_TOKEN", "Разговорная практика английского с собеседником близкого уровня. Возрастные группы несовершеннолетних и взрослых разделены.", "Найдите партнёра для практики английского."],
  ["FOCUS_BOT_TOKEN", "Фокус-сессии на 25, 50 или 90 минут с одной конкретной целью, уведомлением и личной статистикой.", "Фокус-сессии и статистика прямо в Telegram."],
  ["GAME_BOT_TOKEN", "Поиск напарника по игре, платформе, возрастной группе и стилю игры: обычная игра или рейтинг.", "Найдите подходящего тиммейта для игры."],
  ["BUDGET_BOT_TOKEN", "Учёт доходов и расходов, категории, месячный лимит, предупреждения, сводки и CSV-экспорт прямо в Telegram.", "Простой личный бюджет внутри Telegram."],
  ["HUB_BOT_TOKEN", "Семейный хаб бесплатных Telegram-ботов и полезных каналов: задачи, фокус, деньги, английский, игры и общение 12+.", "Полезные Telegram-боты и каналы в одном месте."],
  ["TASK_BOT_TOKEN", "Быстрые задачи и напоминания, перенос на 10 минут и статистика выполненных дел прямо в Telegram.", "Задачи и напоминания прямо в Telegram."],
  ["QUIZ_BOT_TOKEN", "Короткие вопросы на кругозор, ежедневное испытание, серии активности, объяснения ответов и личный счёт.", "Ежедневный квиз, серии и понятные объяснения."],
  ["PARTY_BOT_TOKEN", "Игры и вопросы для компании, созвона или знакомства: семь режимов, игра дня, серии активности и приглашения друзей.", "Игры для компании и новое задание каждый день."]
];

async function telegram(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`${method}: ${result.description}`);
  return result.result;
}

for (const [envName, description, shortDescription] of profiles) {
  const token = process.env[envName]?.trim();
  if (!token) continue;
  await telegram(token, "setMyDescription", { description });
  await telegram(token, "setMyShortDescription", { short_description: shortDescription });
  const saved = await telegram(token, "getMyShortDescription", {});
  if (saved.short_description !== shortDescription) throw new Error(`${envName}: profile verification failed`);
  console.log(`${envName}: updated`);
}

const commandSets = [
  ["ADMIN_BOT_TOKEN", [
    { command: "start", description: "Открыть центр управления" },
    { command: "overview", description: "Обзор всей сети" },
    { command: "daily", description: "Ежедневный отчёт" },
    { command: "products", description: "Статистика по ботам" },
    { command: "sessions", description: "Активные сессии анонимного чата" },
    { command: "media_sessions", description: "Медиасессии за 7 дней" },
    { command: "growth", description: "Рост за 7 дней" },
    { command: "sources", description: "Источники пользователей" },
    { command: "campaigns", description: "Кампании по всей сети" },
    { command: "funnel", description: "Воронка семейного хаба" },
    { command: "channels", description: "Состояние контентных каналов" },
    { command: "leads", description: "Новые лиды" },
    { command: "ideas", description: "Идеи пользователей" },
    { command: "reports", description: "Жалобы" },
    { command: "health", description: "Состояние системы" },
    { command: "ban", description: "Заблокировать пользователя" },
    { command: "unban", description: "Разблокировать пользователя" }
  ]],
  ["HUB_BOT_TOKEN", [
    { command: "start", description: "Открыть семейный хаб" },
    { command: "catalog", description: "Каталог ботов" },
    { command: "channels", description: "Полезные каналы TerraTectra" },
    { command: "favorites", description: "Мои боты" },
    { command: "recent", description: "Недавно открытые боты" },
    { command: "invite", description: "Пригласить друзей" },
    { command: "help", description: "Помощь" }
  ]],
  ["QUIZ_BOT_TOKEN", [
    { command: "start", description: "Открыть Tectra Quiz" },
    { command: "quiz", description: "Новый случайный вопрос" },
    { command: "daily", description: "Вопрос дня" },
    { command: "party", description: "Игры для компании" },
    { command: "score", description: "Счёт и серия активности" },
    { command: "invite", description: "Пригласить друга" },
    { command: "bots", description: "Другие боты TerraTectra" },
    { command: "help", description: "Помощь" }
  ]],
  ["PARTY_BOT_TOKEN", [
    { command: "start", description: "Открыть Tectra Party" },
    { command: "play", description: "Выбрать игру" },
    { command: "daily", description: "Игра дня" },
    { command: "story", description: "Совместная история" },
    { command: "stats", description: "Статистика и серия" },
    { command: "invite", description: "Пригласить друзей" },
    { command: "bots", description: "Другие боты TerraTectra" },
    { command: "help", description: "Помощь" }
  ]]
];

for (const [envName, commands] of commandSets) {
  const token = process.env[envName]?.trim();
  if (!token) continue;
  await telegram(token, "setMyCommands", { commands });
  const saved = await telegram(token, "getMyCommands", {});
  if (saved.length !== commands.length) throw new Error(`${envName}: command verification failed`);
  console.log(`${envName}: commands updated`);
}
