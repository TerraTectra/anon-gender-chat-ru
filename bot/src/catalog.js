import { InlineKeyboard } from "grammy";

export const catalogLabel = "🧭 Другие боты";

export function catalogKeyboard() {
  return new InlineKeyboard()
    .url("Анонимный чат", "https://t.me/anon_gender_chat_ru_bot")
    .row()
    .url("English Talk Match", "https://t.me/EnglishTalkMatchBot")
    .row()
    .url("Focus Sprint", "https://t.me/FocusSprintTimerBot")
    .row()
    .url("Game Mate", "https://t.me/GameMateFinderRuBot")
    .row()
    .url("Карманный бюджет", "https://t.me/PocketBudgetRuBot");
}

export function showCatalog(ctx) {
  return ctx.reply("Выберите полезный бот из нашей сети.", { reply_markup: catalogKeyboard() });
}
