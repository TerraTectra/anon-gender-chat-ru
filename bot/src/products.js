export const products = [
  {
    id: "anon",
    category: "social",
    name: "Анонимный чат 12+",
    username: "anon_gender_chat_ru_bot",
    icon: "💬",
    keywords: ["чат", "общение", "знакомства", "собеседник", "анонимно", "поговорить"],
    tagline: "Анонимное общение один на один",
    description: "Быстрый поиск собеседника, фильтры по возрасту и полу, жалобы и блокировки."
  },
  {
    id: "english",
    category: "learning",
    name: "Tectra Study Cards",
    username: "EnglishTalkMatchBot",
    icon: "📚",
    keywords: ["учёба", "карточки", "flashcards", "повторение", "экзамен", "запомнить", "слова"],
    tagline: "Карточки и повторение без отдельного приложения",
    description: "Создаёт личные flashcards и чаще возвращает карточки, которые пользователь знает хуже."
  },
  {
    id: "focus",
    category: "utility",
    name: "Tectra Random",
    username: "FocusSprintTimerBot",
    icon: "🎲",
    keywords: ["рандом", "случайно", "розыгрыш", "выбрать", "жребий", "кубик", "монетка", "random"],
    tagline: "Рандомайзер и быстрые жеребьёвки",
    description: "Случайные числа, выбор из списка, монетка, кубик и перемешивание вариантов."
  },
  {
    id: "game",
    category: "social",
    name: "Tectra Meet",
    username: "GameMateFinderRuBot",
    icon: "💞",
    keywords: ["знакомства", "дейтинг", "люди", "город", "интересы", "пара", "встреча", "18+"],
    tagline: "Знакомства по городу и интересам",
    description: "Короткие анкеты 18+, поиск людей в своём городе и контакт при взаимной симпатии."
  },
  {
    id: "budget",
    category: "utility",
    name: "Tectra Rates",
    username: "PocketBudgetRuBot",
    icon: "💱",
    keywords: ["валюта", "курс", "доллар", "евро", "злотый", "конвертер", "bitcoin", "crypto", "крипта"],
    tagline: "Конвертер валют и криптокурсы",
    description: "Быстрый пересчёт сумм между валютами и справочные цены популярных криптовалют."
  },
  {
    id: "tasks",
    category: "creator",
    name: "Tectra Post Studio",
    username: "DevTaks_bot",
    icon: "📝",
    keywords: ["пост", "канал", "публикация", "контент", "текст", "ссылка", "админ", "автор"],
    tagline: "Подготовка и публикация постов в Telegram",
    description: "Чистит текст, создаёт ссылки и публикует пост в каналы, где бот назначен администратором."
  },
  {
    id: "quiz",
    category: "utility",
    name: "Tectra Media Saver",
    username: "TectraQuizBot",
    icon: "📥",
    keywords: ["скачать", "download", "media", "видео", "файл", "сохранить", "ссылка", "аудио"],
    tagline: "Сохранение публичных файлов по прямой ссылке",
    description: "Забирает прямой публичный URL и возвращает файл в Telegram; без обхода DRM и приватного доступа."
  },
  {
    id: "party",
    category: "admin",
    name: "Tectra Join Guard",
    username: "TectraPartyBot",
    icon: "🛡",
    keywords: ["заявки", "вступление", "группа", "канал", "админ", "модерация", "approve", "join"],
    tagline: "Автоприём заявок в группы и каналы",
    description: "Автоматически принимает join requests там, где бот назначен администратором."
  }
];

export const contentChannels = [
  { id: "ai", name: "TerraTectra AI Практика", username: "TerraTectraAI", icon: "🧩", tagline: "Прикладной ИИ и автоматизация без новостного шума" },
  { id: "focus", name: "TerraTectra Фокус", username: "TerraTectraFocus", icon: "🎯", tagline: "Задачи, внимание и спокойная система работы" },
  { id: "money", name: "TerraTectra Деньги", username: "TerraTectraMoney", icon: "💰", tagline: "Бытовой учёт денег и устойчивые финансовые привычки" },
  { id: "fun", name: "Tectra Развлечения", username: "TectraFun", icon: "🎉", tagline: "Развлекательный канал сети" },
  { id: "quiz", name: "Tectra Квиз", username: "TectraQuiz", icon: "🧠", tagline: "Короткие вопросы и знания" }
];

export const categories = [
  { id: "social", label: "💬 Общение" },
  { id: "utility", label: "🧰 Утилиты" },
  { id: "creator", label: "📝 Для каналов" },
  { id: "admin", label: "🛡 Для админов" },
  { id: "learning", label: "📚 Учёба" }
];

export const recommendationIntents = [
  { id: "talk", label: "💬 Поговорить анонимно", productId: "anon" },
  { id: "meet", label: "💞 Познакомиться", productId: "game" },
  { id: "download", label: "📥 Сохранить файл", productId: "quiz" },
  { id: "random", label: "🎲 Выбрать случайно", productId: "focus" },
  { id: "rates", label: "💱 Узнать курс", productId: "budget" },
  { id: "post", label: "📝 Сделать пост", productId: "tasks" },
  { id: "join", label: "🛡 Принимать заявки", productId: "party" },
  { id: "study", label: "📚 Учить карточки", productId: "english" }
];

export function productLink(product, source = "src_family_catalog") {
  return `https://t.me/${product.username}?start=${source}_${product.id}`;
}

export function channelLink(channel) {
  return `https://t.me/${channel.username}`;
}

export function productsByCategory(category) {
  return category === "all" ? products : products.filter((product) => product.category === category);
}

export function searchProducts(query) {
  const stopWords = new Set(["мне", "нужно", "хочу", "для", "чтобы", "бот", "найти", "помоги"]);
  const words = (query.toLowerCase().replace(/ё/g, "е").match(/[a-zа-я0-9+]+/g) || [])
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
