import { InlineKeyboard } from "grammy";
import { productLink, products } from "./products.js";

export const catalogLabel = "🧭 Другие боты";

export function catalogKeyboard() {
  const keyboard = new InlineKeyboard();
  for (const product of products) keyboard.url(`${product.icon} ${product.name}`, productLink(product)).row();
  return keyboard.url("🏠 Открыть семейный хаб", "https://t.me/TerraTectraBotsBot");
}

export function showCatalog(ctx) {
  return ctx.reply("Выберите полезный бот из нашей сети.", { reply_markup: catalogKeyboard() });
}
