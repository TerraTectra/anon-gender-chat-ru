import { InlineKeyboard } from "grammy";
import { productLink, products } from "./products.js";

export const catalogLabel = "🧭 Другие боты";

export function catalogKeyboard(originProductId = "family") {
  const keyboard = new InlineKeyboard();
  for (const product of products.filter(({ id }) => id !== originProductId)) {
    keyboard.url(`${product.icon} ${product.name}`, productLink(product, `src_catalog_${originProductId}`)).row();
  }
  return keyboard;
}

export function showCatalog(ctx, originProductId = "family") {
  return ctx.reply("Выберите полезный бот из сети TerraTectra.", { reply_markup: catalogKeyboard(originProductId) });
}

export function createCatalogHandler(originProductId) {
  return (ctx) => showCatalog(ctx, originProductId);
}
