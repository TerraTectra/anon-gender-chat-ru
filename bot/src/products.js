export const products = [
  {
    id: "anon",
    category: "communication",
    name: "Анонимный чат 12+",
    username: "anon_gender_chat_ru_bot",
    icon: "💬",
    keywords: ["чат", "общение", "знакомства", "собеседник", "анонимно", "поговорить"],
    tagline: "Анонимное общение один на один",
    description: "Быстрый поиск собеседника, фильтры по возрасту и полу, жалобы и блокировки."
  },
  {
    id: "english",
    category: "communication",
    name: "English Talk Match",
    username: "EnglishTalkMatchBot",
    icon: "🇬🇧",
    keywords: ["английский", "язык", "практика", "разговор", "english", "учёба"],
    tagline: "Разговорная практика английского",
    description: "Подбор собеседника близкого уровня для живой языковой практики."
  },
  {
    id: "focus",
    category: "productivity",
    name: "Focus Sprint",
    username: "FocusSprintTimerBot",
    icon: "🎯",
    keywords: ["фокус", "таймер", "работа", "учёба", "концентрация", "pomodoro"],
    tagline: "Фокус-сессии без лишних приложений",
    description: "Таймеры на 25, 50 и 90 минут, конкретная цель и личная статистика."
  },
  {
    id: "game",
    category: "communication",
    name: "Game Mate",
    username: "GameMateFinderRuBot",
    icon: "🎮",
    keywords: ["игры", "тиммейт", "напарник", "команда", "cs2", "dota", "minecraft"],
    tagline: "Поиск тиммейтов для игр",
    description: "Подбор по игре, платформе, возрастной группе и стилю игры."
  },
  {
    id: "budget",
    category: "life",
    name: "Pocket Budget",
    username: "PocketBudgetRuBot",
    icon: "💰",
    keywords: ["деньги", "финансы", "бюджет", "расходы", "доходы", "учёт"],
    tagline: "Простой учёт личных финансов",
    description: "Доходы, расходы, баланс, сводки и CSV-экспорт прямо в Telegram."
  },
  {
    id: "tasks",
    category: "productivity",
    name: "Task Pulse",
    username: "DevTaks_bot",
    icon: "✅",
    keywords: ["задачи", "дела", "напоминания", "напомнить", "список", "планы", "организация"],
    tagline: "Задачи и напоминания в Telegram",
    description: "Быстро создаёт задачу, напоминает в нужное время и считает выполненные дела."
  }
];

export const categories = [
  { id: "communication", label: "💬 Общение и люди" },
  { id: "productivity", label: "🎯 Работа и фокус" },
  { id: "life", label: "🏠 Для жизни" }
];

export function productLink(product, source = "src_family_catalog") {
  return `https://t.me/${product.username}?start=${source}_${product.id}`;
}

export function productsByCategory(category) {
  return category === "all" ? products : products.filter((product) => product.category === category);
}

export function searchProducts(query) {
  const stopWords = new Set(["мне", "нужно", "хочу", "для", "чтобы", "бот", "найти", "помоги"]);
  const words = (query.toLowerCase().replace(/ё/g, "е").match(/[a-zа-я0-9]+/g) || [])
    .filter((word) => word.length >= 3 && !stopWords.has(word));
  if (!words.length) return [];
  return products
    .map((product) => {
      const haystack = [product.name, product.tagline, product.description, ...product.keywords]
        .join(" ").toLowerCase().replace(/ё/g, "е");
      const score = words.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0);
      return { product, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, "ru"))
    .map((result) => result.product);
}
