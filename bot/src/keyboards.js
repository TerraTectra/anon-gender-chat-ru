import { InlineKeyboard, Keyboard } from "grammy";
import { catalogLabel } from "./catalog.js";

export const labels = {
  random: "🎲 Найти случайного",
  filtered: "🔎 Поиск с фильтром",
  next: "⏭ Следующий",
  stop: "⛔ Завершить",
  report: "🚩 Пожаловаться",
  profile: "👤 Профиль",
  stats: "📊 Статистика",
  invite: "🎁 Пригласить",
  catalog: catalogLabel
};

export const menuKeyboard = new Keyboard()
  .text(labels.random)
  .text(labels.filtered)
  .row()
  .text(labels.next)
  .text(labels.stop)
  .row()
  .text(labels.report)
  .text(labels.profile)
  .row()
  .text(labels.stats)
  .text(labels.invite)
  .row()
  .text(labels.catalog)
  .resized();

export const genderKeyboard = new InlineKeyboard()
  .text("Парень", "profile_gender:male")
  .text("Девушка", "profile_gender:female");

export const filterGenderKeyboard = new InlineKeyboard()
  .text("Парень", "filter_gender:male")
  .text("Девушка", "filter_gender:female")
  .row()
  .text("Не важно", "filter_gender:any");

export const confirmReportKeyboard = new InlineKeyboard()
  .text("Отправить жалобу", "report:confirm")
  .text("Отмена", "report:cancel");

export const adminKeyboard = new Keyboard()
  .text("📊 Статистика")
  .text("🚩 Жалобы")
  .row()
  .text("📈 Рост")
  .text("🔄 Обновить")
  .resized();
