import "dotenv/config";

const profiles = [
  ["BOT_TOKEN", "Анонимный чат один на один: случайный и фильтрованный поиск, возрастные группы 12-17 и 18+ разделены.", "Безопасное анонимное общение один на один 12+."],
  ["ADMIN_BOT_TOKEN", "Приватный центр управления TerraTectra: боты, активные и медиасессии анонимного чата, каналы, источники, лиды и состояние системы.", "Приватная аналитика и управление TerraTectra."],
  ["ENGLISH_BOT_TOKEN", "Находит музыку по запросу или публичной ссылке и возвращает аудиофайл в Telegram. Без DRM и приватного доступа.", "Поиск и загрузка музыки из публичных источников."],
  ["FOCUS_BOT_TOKEN", "Случайные числа, выбор из списка, монетка, кубик и перемешивание прямо в Telegram.", "Рандомайзер, жеребьёвки и выбор победителя."],
  ["GAME_BOT_TOKEN", "Анкеты, поиск людей по городу и интересам и раскрытие контакта только при взаимной симпатии. 18+.", "Знакомства по городу и интересам. Только 18+."],
  ["BUDGET_BOT_TOKEN", "Модератор для Telegram-групп: удаляет нежелательные ссылки и явный флуд, управляется командами администраторов.", "Антиспам, антифлуд и защита Telegram-групп."],
  ["HUB_BOT_TOKEN", "Отправьте геолокацию и находите кафе, рестораны, аптеки, банкоматы, АЗС и отели рядом через OpenStreetMap.", "Кафе, аптеки, банкоматы и места рядом с вами."],
  ["TASK_BOT_TOKEN", "Быстро форматирует текст и публикует посты в ваши Telegram-каналы, где бот назначен администратором.", "Подготовка и публикация постов в Telegram-каналы."],
  ["QUIZ_BOT_TOKEN", "Скачивает видео с поддерживаемых публичных платформ и возвращает файл в Telegram. Без DRM и приватного доступа.", "Скачивание видео из публичных ссылок прямо в Telegram."],
  ["PARTY_BOT_TOKEN", "Автоматически принимает join requests в ваших Telegram-группах и каналах после включения администратором.", "Автоматический приём заявок в Telegram-чаты и каналы."]
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
