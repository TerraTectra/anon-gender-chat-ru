export const products = [
  {
    id: "anon",
    category: "communication",
    name: "Анонимный чат 12+",
    username: "anon_gender_chat_ru_bot",
    icon: "💬",
    tagline: "Анонимное общение один на один",
    description: "Быстрый поиск собеседника, фильтры по возрасту и полу, жалобы и блокировки."
  },
  {
    id: "english",
    category: "communication",
    name: "English Talk Match",
    username: "EnglishTalkMatchBot",
    icon: "🇬🇧",
    tagline: "Разговорная практика английского",
    description: "Подбор собеседника близкого уровня для живой языковой практики."
  },
  {
    id: "focus",
    category: "productivity",
    name: "Focus Sprint",
    username: "FocusSprintTimerBot",
    icon: "🎯",
    tagline: "Фокус-сессии без лишних приложений",
    description: "Таймеры на 25, 50 и 90 минут, конкретная цель и личная статистика."
  },
  {
    id: "game",
    category: "communication",
    name: "Game Mate",
    username: "GameMateFinderRuBot",
    icon: "🎮",
    tagline: "Поиск тиммейтов для игр",
    description: "Подбор по игре, платформе, возрастной группе и стилю игры."
  },
  {
    id: "budget",
    category: "life",
    name: "Pocket Budget",
    username: "PocketBudgetRuBot",
    icon: "💰",
    tagline: "Простой учёт личных финансов",
    description: "Доходы, расходы, баланс, сводки и CSV-экспорт прямо в Telegram."
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
