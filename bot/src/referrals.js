import { InlineKeyboard } from "grammy";

export function inviteKeyboard(link, text) {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  return new InlineKeyboard().url("Поделиться", shareUrl);
}
