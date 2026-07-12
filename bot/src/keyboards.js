import { Keyboard, InlineKeyboard } from "grammy";

export const menuKeyboard = new Keyboard()
  .text("🎲 Найти случайного")
  .text("🔎 Поиск с фильтром")
  .row()
  .text("⏭ Следующий")
  .text("⛔ Завершить")
  .row()
  .text("🚩 Пожаловаться")
  .text("👤 Профиль")
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

